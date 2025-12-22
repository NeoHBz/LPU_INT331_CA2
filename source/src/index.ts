import express, { Request, Response, NextFunction, RequestHandler } from "express";
import cors from "cors";
import jwt, { JwtPayload } from "jsonwebtoken";
import Logger from "./utils/logger";
import * as dotenv from "dotenv";
import * as path from "path";
import { createHash, randomUUID } from "crypto";
import { createServer } from "net";
import { Mutex } from "async-mutex";
import puppeteer, { Browser, Page } from "puppeteer";

const envFile = process.env.ENV_FILE || ".env";
dotenv.config({
    path: path.resolve(process.cwd(), envFile),
    override: true,
});
console.log("Loaded ENV file:", envFile);

const app = express();
app.use(cors());
app.use(express.json());

const DESIRED_PORT = Number(process.env.PORT || 8080);
const MONITORING_INTERVAL = 5000; // 10 seconds
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const TOKEN_TTL_MS = Number(process.env.JWT_TTL_MS || 1000 * 60 * 60 * 2); // default 2 hours

// Execution stages for workflow tracking
enum ExecutionStage {
    INITIAL = "initial",
    INITIALIZED = "initialized",
    OPENED_TARGET_URL = "opened_target_url",
    LOGGED_IN = "logged_in",
    JOINED_CLASS = "joined_class",
    FAILED = "failed",
}

type TConfig = {
    username: string;
    password: string;
    homeUrl: string;
    emailPrefix: string;
    targetUrl: string;
    logLevel?: string;
    headless?: string;
};

type RetryConfig = {
    maxRetries: number;
    currentRetries: number;
    lastAttempt: string | null;
    lastError: string | null;
    success: boolean;
    lastSuccessTime: string | null;
};

type StageStatus = {
    [key: string]: RetryConfig;
};

type SessionRecord = {
    sessionId: string;
    username: string;
    clientId: string;
    issuedAt: string;
    expiresAt: string;
    userAgent: string;
    token: string;
};

type AuthContext = {
    username: string;
    clientId: string;
    sessionId: string;
    tokenExpiresAt: string;
};

type AuthenticatedRequest = Request & { auth?: AuthContext };

const configInit: TConfig = {
    username: process.env.USERNAME as string,
    password: process.env.PASSWORD as string,
    homeUrl: process.env.HOME_URL as string,
    emailPrefix: process.env.EMAIL_PREFIX as string,
    targetUrl: process.env.TARGET_URL as string,
    logLevel: process.env.LOG_LEVEL,
    headless: process.env.HEADLESS,
};

Logger.debug("Config loaded:", {
    username: configInit.username,
    homeUrl: configInit.homeUrl,
    targetUrl: configInit.targetUrl,
    password: "***REDACTED***",
});

// In-memory session store; pod-per-user keeps isolation simple
const activeSessions: Map<string, SessionRecord> = new Map();

const normalizeUsername = (username: string) => username.trim().toLowerCase();

const buildUserProfile = (username: string) => {
    const cleaned = normalizeUsername(username);
    const initials = cleaned
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase() || "US";

    return {
        username: cleaned,
        fullName: cleaned,
        avatar: initials,
    };
};

const resolveClientId = (req: Request, provided?: string) => {
    if (provided && typeof provided === "string" && provided.trim()) {
        return provided.trim();
    }
    const raw = `${req.ip}-${req.get("user-agent") || "unknown"}`;
    return createHash("sha256").update(raw).digest("hex").slice(0, 16);
};

const issueSession = (
    username: string,
    clientId: string,
    userAgent: string,
): SessionRecord => {
    const sessionId = randomUUID();
    const issuedAtMs = Date.now();
    const expiresAtMs = issuedAtMs + TOKEN_TTL_MS;

    const token = jwt.sign(
        {
            sub: normalizeUsername(username),
            clientId,
            sessionId,
        },
        JWT_SECRET,
        { expiresIn: Math.floor(TOKEN_TTL_MS / 1000) },
    );

    return {
        sessionId,
        username: normalizeUsername(username),
        clientId,
        issuedAt: new Date(issuedAtMs).toISOString(),
        expiresAt: new Date(expiresAtMs).toISOString(),
        userAgent,
        token,
    };
};

const authenticate: RequestHandler = (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) {
        res.status(401).json({ message: "Missing token" });
        return;
    }

    try {
        const payload = jwt.verify(token, JWT_SECRET) as JwtPayload & {
            sessionId?: string;
            clientId?: string;
            sub?: string;
        };

        const username = normalizeUsername(String(payload.sub || ""));
        const session = activeSessions.get(username);
        if (!session) {
            res.status(401).json({ message: "Session expired" });
            return;
        }

        const now = Date.now();
        if (now > new Date(session.expiresAt).getTime()) {
            activeSessions.delete(username);
            res.status(401).json({ message: "Session expired" });
            return;
        }

        if (
            session.sessionId !== payload.sessionId ||
            session.clientId !== payload.clientId
        ) {
            res.status(401).json({ message: "Session no longer valid" });
            return;
        }

        req.auth = {
            username,
            clientId: session.clientId,
            sessionId: session.sessionId,
            tokenExpiresAt: session.expiresAt,
        };

        next();
    } catch (error: any) {
        Logger.error(`JWT verification failed: ${error.message || error}`);
        res.status(401).json({ message: "Invalid token" });
        return;
    }
};

type LoginBody = { username: string; password: string; clientId?: string };

const findAvailablePort = (startPort: number): Promise<number> => {
    return new Promise((resolve) => {
        const tester = createServer()
            .once("error", async (err: any) => {
                if (err?.code === "EADDRINUSE") {
                    tester.close();
                    const nextPort = await findAvailablePort(startPort + 1);
                    resolve(nextPort);
                } else {
                    resolve(startPort);
                }
            })
            .once("listening", () => {
                tester.close(() => resolve(startPort));
            })
            .listen(startPort, "0.0.0.0");
    });
};

class Automation {
    config: TConfig;
    browser: Browser | null;
    page: Page | null;
    startTime: string;
    systemStatus: "healthy" | "degraded" | "failed";
    currentStage: ExecutionStage;
    stageStatus: StageStatus;
    monitoringInterval: NodeJS.Timeout | null;
    executionCount: number;
    private monitoringMutex: Mutex;
    private workflowMutex: Mutex;

    constructor(config: TConfig) {
        Logger.info("Platform Automation initialized");
        this.config = config;
        this.validateConfig();
        this.browser = null;
        this.page = null;
        this.startTime = new Date().toISOString();
        this.systemStatus = "healthy";
        this.currentStage = ExecutionStage.INITIAL;
        this.monitoringInterval = null;
        this.monitoringMutex = new Mutex();
        this.workflowMutex = new Mutex();
        this.executionCount = 0;

        // Initialize retry configuration for workflow stages
        this.stageStatus = {
            initialization: {
                maxRetries: 3,
                currentRetries: 0,
                lastAttempt: null,
                lastError: null,
                success: false,
                lastSuccessTime: null,
            },
            openTarget: {
                maxRetries: 5,
                currentRetries: 0,
                lastAttempt: null,
                lastError: null,
                success: false,
                lastSuccessTime: null,
            },
            login: {
                maxRetries: 5,
                currentRetries: 0,
                lastAttempt: null,
                lastError: null,
                success: false,
                lastSuccessTime: null,
            },
            joinClass: {
                maxRetries: 5,
                currentRetries: 0,
                lastAttempt: null,
                lastError: null,
                success: false,
                lastSuccessTime: null,
            },
            healthCheck: {
                maxRetries: 3,
                currentRetries: 0,
                lastAttempt: null,
                lastError: null,
                success: false,
                lastSuccessTime: null,
            },
        };
    }

    async validateConfig() {
        Logger.debug("Validating configuration...");
        const requiredFields: Array<keyof TConfig> = [
            "username",
            "password",
            "homeUrl",
            "emailPrefix",
            "targetUrl",
        ];

        const missingVars = requiredFields.filter((key) => !this.config[key]);

        if (missingVars.length > 0) {
            Logger.error(`Missing environment variables: ${missingVars.join(", ")}`);
            this.systemStatus = "failed";
            this.currentStage = ExecutionStage.FAILED;
            return;
        }
        Logger.info("Configuration validated successfully");
    }

    private isHeadlessEnabled() {
        const flag = String(this.config.headless || "").toLowerCase();
        return flag === "1" || flag === "true" || flag === "yes";
    }

    private async ensureBrowser(): Promise<Browser> {
        if (this.browser && this.browser.connected) {
            return this.browser;
        }

        this.browser = await puppeteer.launch({
            headless: this.isHeadlessEnabled(),
            defaultViewport: null,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--ignore-certificate-errors",
            ],
        });

        return this.browser;
    }

    private async getOrCreatePage(): Promise<Page> {
        const browser = await this.ensureBrowser();
        const pages = await browser.pages();
        this.page = pages[0] || (await browser.newPage());
        this.page.setDefaultNavigationTimeout(20000);
        return this.page;
    }

    private async closeBrowser() {
        if (this.browser) {
            await this.browser.close().catch(() => undefined);
        }
        this.browser = null;
        this.page = null;
    }

    /**
     * Start monitoring loop for automated health checks and workflow management
     */
    startMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
        }

        this.monitoringInterval = setInterval(
            () => this.monitorExecution(),
            MONITORING_INTERVAL,
        );
        Logger.info(`Started monitoring execution (interval: ${MONITORING_INTERVAL}ms)`);
    }

    /**
     * Stop monitoring loop
     */
    stopMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
            Logger.info("Stopped monitoring execution");
        }
    }

    /**
     * Monitoring execution loop with mutex protection
     * Prevents concurrent execution cycles
     */
    async monitorExecution() {
        // Use mutex to prevent cycle starvation
        if (this.monitoringMutex.isLocked()) {
            Logger.debug("Previous monitoring cycle still running, skipping");
            return;
        }

        const release = await this.monitoringMutex.acquire().catch(() => null);
        if (!release) {
            Logger.error("Failed to acquire monitoring mutex, skipping cycle");
            return;
        }

        try {
            Logger.debug(`Monitoring execution. Current stage: ${this.currentStage}`);

            // Based on current stage, determine what needs to be executed
            switch (this.currentStage) {
                case ExecutionStage.INITIAL:
                    await this.attemptStage("initialization");
                    break;

                case ExecutionStage.INITIALIZED:
                    await this.attemptStage("openTarget");
                    break;

                case ExecutionStage.OPENED_TARGET_URL:
                    await this.attemptStage("login");
                    break;

                case ExecutionStage.LOGGED_IN:
                    await this.attemptStage("joinClass");
                    break;

                case ExecutionStage.JOINED_CLASS:
                    Logger.info("Automation joined class; running health checks");
                    await this.attemptStage("healthCheck");
                    break;

                case ExecutionStage.FAILED:
                    Logger.error("System in failed state, attempting recovery");
                    const failedStage = this.findFailedStage();
                    if (
                        failedStage &&
                        this.stageStatus[failedStage].currentRetries <
                            this.stageStatus[failedStage].maxRetries
                    ) {
                        Logger.info(`Attempting to recover from failed stage: ${failedStage}`);
                        this.resetStageBeforeFailure(failedStage);
                        this.systemStatus = "degraded";
                    } else {
                        Logger.error("Maximum retries exceeded, system remains failed");
                        this.systemStatus = "failed";
                    }
                    break;
            }
        } catch (error: any) {
            Logger.error(`Error in monitoring execution: ${error.message || error}`);
            this.systemStatus = "degraded";
        } finally {
            release();
        }

        this.updateSystemStatus();
    }

    /**
     * Expose active session count for status endpoint
     */
    getActiveSessionCount() {
        return activeSessions.size;
    }

    /**
     * Reset system to stage before failure for retry
     */
    resetStageBeforeFailure(failedStage: string) {
        switch (failedStage) {
            case "initialization":
                this.currentStage = ExecutionStage.INITIAL;
                break;
            case "openTarget":
                this.currentStage = ExecutionStage.INITIALIZED;
                break;
            case "login":
                this.currentStage = ExecutionStage.OPENED_TARGET_URL;
                break;
            case "joinClass":
                this.currentStage = ExecutionStage.LOGGED_IN;
                break;
            case "healthCheck":
                this.currentStage = ExecutionStage.JOINED_CLASS;
                break;
            default:
                this.currentStage = ExecutionStage.INITIAL;
        }
    }

    /**
     * Find which stage failed
     */
    findFailedStage(): string | null {
        const stages = Object.keys(this.stageStatus);
        for (const stage of stages) {
            if (!this.stageStatus[stage].success) {
                return stage;
            }
        }
        return null;
    }

    /**
     * Update overall system status based on stage progress
     */
    updateSystemStatus() {
        if (this.currentStage === ExecutionStage.FAILED) {
            if (
                Object.values(this.stageStatus).some(
                    (status) => status.currentRetries < status.maxRetries && !status.success,
                )
            ) {
                this.systemStatus = "degraded";
            } else {
                this.systemStatus = "failed";
            }
        } else if (this.currentStage === ExecutionStage.JOINED_CLASS) {
            this.systemStatus = "healthy";
        } else {
            const totalStages = Object.keys(this.stageStatus).length;
            const completedStages = Object.values(this.stageStatus).filter(
                (s) => s.success,
            ).length;

            if (completedStages === totalStages) {
                this.systemStatus = "healthy";
            } else if (completedStages > 0) {
                this.systemStatus = "degraded";
            } else {
                this.systemStatus = "failed";
            }
        }
    }

    /**
     * Attempt to execute a specific stage with retry logic
     */
    async attemptStage(stageName: string): Promise<boolean> {
        try {
            if (
                this.stageStatus[stageName].currentRetries >=
                this.stageStatus[stageName].maxRetries
            ) {
                Logger.error(
                    `Maximum retries (${this.stageStatus[stageName].maxRetries}) reached for ${stageName}`,
                );
                this.currentStage = ExecutionStage.FAILED;
                return false;
            }

            // Update lastAttempt timestamp
            this.stageStatus[stageName].lastAttempt = new Date().toISOString();

            let result: boolean = false;
            switch (stageName) {
                case "initialization":
                    result = await this.initialize();
                    break;
                case "openTarget":
                    result = await this.openTarget();
                    break;
                case "login":
                    result = await this.loginToPlatform();
                    break;
                case "joinClass":
                    result = await this.joinClassroom();
                    break;
                case "healthCheck":
                    result = await this.performHealthCheck();
                    break;
                default:
                    Logger.error(`Unknown stage: ${stageName}`);
                    result = false;
            }

            // Update status
            if (result) {
                this.stageStatus[stageName].success = true;
                this.stageStatus[stageName].lastSuccessTime = new Date().toISOString();
                this.stageStatus[stageName].lastError = null;
            } else {
                this.stageStatus[stageName].success = false;
                this.stageStatus[stageName].currentRetries++;
            }

            return result;
        } catch (error: any) {
            this.stageStatus[stageName].success = false;
            this.stageStatus[stageName].currentRetries++;
            this.stageStatus[stageName].lastError = `Error in ${stageName}: ${
                error.message || error
            }`;
            Logger.error(this.stageStatus[stageName].lastError);
            return false;
        }
    }

    /**
     * Initialization stage - prepare system resources
     */
    async initialize(): Promise<boolean> {
        try {
            Logger.info("Initializing automation system...");
            
            // TODO: Add your initialization logic
            // Examples:
            // - Connect to databases
            // - Initialize external clients
            // - Load configuration files
            // - Set up resources
            
            this.currentStage = ExecutionStage.INITIALIZED;
            Logger.info("System initialized successfully");
            return true;
        } catch (error: any) {
            Logger.error(`Initialization failed: ${error.message || error}`);
            return false;
        }
    }

    /**
     * Navigate to target URL
     */
    async openTarget(): Promise<boolean> {
        try {
            const page = await this.getOrCreatePage();
            Logger.info(`Opening home URL ${this.config.homeUrl}...`);

            await page.goto(this.config.homeUrl, { waitUntil: "domcontentloaded" });
            await page.waitForSelector("body", { timeout: 5000 });

            this.currentStage = ExecutionStage.OPENED_TARGET_URL;
            Logger.info("Home page loaded");
            return true;
        } catch (error: any) {
            Logger.error(`Failed to open target URL: ${error.message || error}`);
            await this.closeBrowser();
            return false;
        }
    }

    /**
     * Log into the platform
     */
    async loginToPlatform(): Promise<boolean> {
        try {
            const page = await this.getOrCreatePage();
            Logger.info("Logging into platform...");

            const findFirst = async (selectors: string[]) => {
                for (const selector of selectors) {
                    const handle = await page.$(selector);
                    if (handle) return handle;
                }
                return null;
            };

            // Ensure we're on the login page
            if (!page.url().startsWith(this.config.homeUrl)) {
                await page.goto(this.config.homeUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);
            }

            const usernameInput = await findFirst([
                "input[name='username']",
                "input#username",
                "input[placeholder='Username']",
                "input[type='email']",
                "input[type='text']",
            ]);
            const passwordInput = await findFirst([
                "input[name='password']",
                "input#password",
                "input[placeholder='Password']",
                "input[type='password']",
            ]);

            if (!usernameInput || !passwordInput) {
                const pageTitle = await page.title().catch(() => "unknown");
                const currentUrl = page.url();
                Logger.error(`Login form inputs not found (url=${currentUrl}, title=${pageTitle})`);
                return false;
            }

            await usernameInput.click({ clickCount: 3 });
            await usernameInput.type(this.config.username);
            await passwordInput.click({ clickCount: 3 });
            await passwordInput.type(this.config.password);

            const submitButton = await findFirst([
                "button[type='submit']",
                "button#login",
                "button.loginBtn",
            ]);

            if (submitButton) {
                await submitButton.click();
            } else {
                await page.keyboard.press("Enter");
            }

            await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => undefined);
            this.currentStage = ExecutionStage.LOGGED_IN;
            Logger.info("Login successful");
            return true;
        } catch (error: any) {
            Logger.error(`Login failed: ${error.message || error}`);
            return false;
        }
    }

    /**
     * Join the class session
     */
    async joinClassroom(): Promise<boolean> {
        // Use mutex to prevent overlapping joins
        if (this.workflowMutex.isLocked()) {
            Logger.debug("Join already in progress, skipping");
            return true;
        }

        const release = await this.workflowMutex.acquire().catch(() => null);
        if (!release) {
            Logger.error("Failed to acquire join mutex");
            return false;
        }

        try {
            this.executionCount++;
            Logger.info(`Joining class (attempt #${this.executionCount})...`);
            const page = await this.getOrCreatePage();

            Logger.debug(`Navigating to targetUrl: ${this.config.targetUrl}`);
            await page.goto(this.config.targetUrl, { waitUntil: "domcontentloaded" });
            
            // Give a small buffer for client-side routing/rendering
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const currentUrl = page.url();
            Logger.debug(`Page loaded at: ${currentUrl}`);

            // Wait for classroom header as join confirmation
            const headerFound = await page
                .waitForSelector("h1", { timeout: 5000 })
                .then(async (handle) => {
                    if (!handle) return false;
                    const text = await handle.evaluate((el) => el.textContent || "");
                    Logger.debug(`Found h1 with text: "${text}"`);
                    return /platform automation/i.test(text);
                })
                .catch((error) => {
                    Logger.error(`Failed to find h1 element: ${error.message || error}`);
                    return false;
                });

            if (!headerFound) {
                Logger.error("Classroom view did not load");
                return false;
            }

            this.currentStage = ExecutionStage.JOINED_CLASS;
            Logger.info("Joined class successfully");
            return true;
        } catch (error: any) {
            Logger.error(`Failed to join class: ${error.message || error}`);
            return false;
        } finally {
            release();
        }
    }

    /**
     * Health check stage - verify system is operating correctly
     */
    async performHealthCheck(): Promise<boolean> {
        try {
            Logger.debug("Performing health check...");

            if (!this.browser || !this.browser.connected) {
                Logger.error("Browser not connected");
                return false;
            }

            if (!this.page || this.page.isClosed()) {
                Logger.error("Page not available for health check");
                return false;
            }

            const currentUrl = this.page.url();
            const looksLikeClass = currentUrl.includes("class") || currentUrl.includes(this.config.targetUrl);

            if (this.currentStage !== ExecutionStage.JOINED_CLASS || !looksLikeClass) {
                Logger.error(`Health check failed: not in class (stage=${this.currentStage}, url=${currentUrl})`);
                
                // If we thought we were in class but we're not, reset to LOGGED_IN to retry joining
                if (this.currentStage === ExecutionStage.JOINED_CLASS && !looksLikeClass) {
                    Logger.info("Resetting to LOGGED_IN stage to rejoin class");
                    this.currentStage = ExecutionStage.LOGGED_IN;
                    this.stageStatus["joinClass"].success = false;
                    this.stageStatus["joinClass"].currentRetries++;
                    this.stageStatus["joinClass"].lastError = `Not on class page (url=${currentUrl})`;
                }
                
                return false;
            }

            Logger.debug("Health check passed");
            return true;
        } catch (error: any) {
            Logger.error(`Health check failed: ${error.message || error}`);
            return false;
        }
    }

    async run() {
        try {
            Logger.info("Starting automation workflow...");
            
            // Start the monitoring loop
            this.startMonitoring();
            
        } catch (error: any) {
            Logger.error(`Error in automation workflow: ${error.message || error}`);
            this.systemStatus = "failed";
            this.currentStage = ExecutionStage.FAILED;
        }
    }

    async shutdown() {
        Logger.info("Shutting down automation system...");
        this.stopMonitoring();
        await this.closeBrowser();

        Logger.info("Shutdown complete");
    }

    async apiStatus() {
        return {
            username: this.config.username,
            status: this.systemStatus,
            timestamp: new Date().toISOString(),
            startTime: this.startTime,
            currentStage: this.currentStage,
            executionCount: this.executionCount,
            stageStatus: this.stageStatus,
            message: "Automation service running",
        };
    }
}

/**
 * Authentication & session routes (JWT + per-browser uniqueness)
 */
const loginHandler: RequestHandler<any, any, LoginBody> = (req, res) => {
    const { username, password, clientId } = req.body || {};

    if (!username || !password) {
        res.status(400).json({ message: "username and password are required" });
        return;
    }

    const normalizedUsername = normalizeUsername(String(username));
    const expectedUsername = normalizeUsername(String(configInit.username || ""));

    if (normalizedUsername !== expectedUsername || password !== configInit.password) {
        Logger.info(`Failed login for ${normalizedUsername}`);
        res.status(401).json({ message: "Invalid credentials" });
        return;
    }

    const resolvedClientId = resolveClientId(req, clientId);
    const existingSession = activeSessions.get(normalizedUsername);

    // Enforce one active browser session per username
    if (existingSession && existingSession.clientId !== resolvedClientId) {
        res.status(409).json({
            message: "User already active in another browser session. Please logout first.",
            activeClientId: existingSession.clientId,
        });
        return;
    }

    const session = issueSession(
        normalizedUsername,
        resolvedClientId,
        req.get("user-agent") || "unknown",
    );

    activeSessions.set(normalizedUsername, session);
    Logger.info(`Login success for ${normalizedUsername} (client ${session.clientId})`);

    res.json({
        token: session.token,
        clientId: session.clientId,
        user: buildUserProfile(normalizedUsername),
        expiresAt: session.expiresAt,
    });
};

const logoutHandler: RequestHandler = (req: AuthenticatedRequest, res: Response) => {
    const username = req.auth!.username;
    activeSessions.delete(username);
    Logger.info(`User ${username} logged out`);
    res.json({ message: "Logged out" });
};

const sessionHandler: RequestHandler = (req: AuthenticatedRequest, res: Response) => {
    const username = req.auth!.username;
    const session = activeSessions.get(username);
    if (!session) {
        res.status(404).json({ message: "Session not found" });
        return;
    }
    res.json({
        user: buildUserProfile(username),
        session: {
            clientId: session.clientId,
            issuedAt: session.issuedAt,
            expiresAt: session.expiresAt,
        },
    });
};

const classroomHandler: RequestHandler = (req: AuthenticatedRequest, res: Response) => {
    res.json({
        message: "Classroom access granted",
        user: buildUserProfile(req.auth!.username),
        session: {
            clientId: req.auth!.clientId,
            expiresAt: req.auth!.tokenExpiresAt,
        },
    });
};

app.post("/login", loginHandler);
app.post("/logout", authenticate, logoutHandler);
app.get("/session", authenticate, sessionHandler);
// Example protected endpoint the frontend can poll to ensure session stays valid
app.get("/classroom", authenticate, classroomHandler);

const startServer = async () => {
    const availablePort = await findAvailablePort(DESIRED_PORT);

    Logger.debug("Creating automation instance...");
    const automation = new Automation(configInit);
    Logger.debug("Automation instance created!");

    // Start automation workflow
    try {
        await automation.run();
    } catch (error: any) {
        Logger.error(`Error occurred: ${error}`);
        automation.systemStatus = "failed";
    }

    // Health check endpoint
    app.get("/status", async (_req: Request, res: Response) => {
        Logger.debug("GET /status");
        const status = await automation.apiStatus();
        res.json({
            ...status,
            activeSessions: activeSessions.size,
            tokenTtlMs: TOKEN_TTL_MS,
        });
    });

    // Health endpoint for Kubernetes
    app.get("/health", (_req: Request, res: Response) => {
        res.json({ status: "ok", timestamp: new Date().toISOString() });
    });

    // Readiness probe - more detailed health check
    app.get("/ready", async (_req: Request, res: Response) => {
        const isReady = automation.systemStatus !== "failed";
        const statusCode = isReady ? 200 : 503;
        
        res.status(statusCode).json({
            ready: isReady,
            status: automation.systemStatus,
            currentStage: automation.currentStage,
            timestamp: new Date().toISOString(),
            activeSessions: activeSessions.size,
        });
    });

    process.on("SIGINT", async () => {
        Logger.info("Received SIGINT signal, shutting down gracefully...");
        await automation.shutdown();
        process.exit(0);
    });

    process.on("SIGTERM", async () => {
        Logger.info("Received SIGTERM signal, shutting down gracefully...");
        await automation.shutdown();
        process.exit(0);
    });

    app.listen(availablePort, () => {
        Logger.info(`Server running on port ${availablePort}`);
        if (availablePort !== DESIRED_PORT) {
            Logger.info(`Desired port ${DESIRED_PORT} was in use; using ${availablePort} instead`);
        }
    });
};

startServer().catch((error: any) => {
    Logger.error(`Failed to start server: ${error?.message || error}`);
    process.exit(1);
});

["unhandledRejection", "uncaughtException"].forEach((event) => {
    process.on(event, async (error: any) => {
        Logger.error(`${event} occurred: ${error}`);
    });
});
