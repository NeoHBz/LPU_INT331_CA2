import express, { Request, Response } from "express";
import puppeteer, { Browser, Cookie, Page } from "puppeteer";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import isBetween from "dayjs/plugin/isBetween";
import customParseFormat from "dayjs/plugin/customParseFormat";
import Logger from "./utils/logger";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { Mutex } from "async-mutex";

const envFile = process.env.ENV_FILE || ".env";
dotenv.config({
    path: path.resolve(process.cwd(), envFile),
    override: true,
});
console.log("Loaded ENV file:", envFile);

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isBetween);
dayjs.extend(customParseFormat);
const app = express();
const PORT = process.env.PORT || 3000;
const tzLocation = "Asia/Kolkata";
const monitorExecutionInterval = 30000;
const MAX_SCREENSHOTS_PER_USER = 50;

// Define execution stages
enum ExecutionStage {
    INITIAL = "initial",
    BROWSER_LAUNCHED = "browser_launched",
    USER_LOGGED_IN = "user_logged_in",
    LOGIN_VERIFIED = "login_verified",
    GOT_TODAY_CLASSES = "got_today_classes",
    CLASS_JOINED = "class_joined",
    FAILED = "failed",
}

type TConfig = {
    username: string;
    password: string;
    classHomeUrl: string;
    studentEmailPostfix: string;
    codeTantraURL: string;
};

type LectureData = {
    title: string;
    href: string;
    time: string; // '7:01 - 7:59'
    lectureName: string;
};

// Define retry configuration for each function
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

const configInit: TConfig = {
    username: process.env.USERNAME as string,
    password: process.env.PASSWORD as string,
    classHomeUrl: process.env.HOME_URL as string,
    studentEmailPostfix: process.env.EMAIL_PREFIX as string,
    codeTantraURL: process.env.CLASS_URL as string,
};

Logger.debug("Config:", {
    ...configInit,
    password: configInit.password.replace(/./g, "*"),
});

class Automation {
    config: TConfig;
    browser: Browser | null;
    pages: Page[] | null;
    startTime: string;
    lectures!: LectureData[] | null;
    currentStage: ExecutionStage;
    stageStatus: StageStatus;
    activeClassLink: string | null;
    systemStatus: "healthy" | "degraded" | "failed";
    monitoringInterval: NodeJS.Timeout | null;
    private monitoringMutex: Mutex;
    private userDetectionFaultTolerance: number = 1 / 3; // At least 1 out of 3 methods must succeed

    constructor(config: TConfig) {
        Logger.debug("Class Automation constructor called");
        this.config = config;
        this.validateConfig();
        this.browser = null;
        this.pages = null;
        this.startTime = dayjs().tz(tzLocation).format("YYYY-MM-DD HH:mm:ss");
        this.currentStage = ExecutionStage.INITIAL;
        this.activeClassLink = null;
        this.systemStatus = "healthy";
        this.monitoringInterval = null;
        this.monitoringMutex = new Mutex();

        // Initialize retry configuration for each stage/function
        this.stageStatus = {
            launchBrowser: {
                maxRetries: 5,
                currentRetries: 0,
                lastAttempt: null,
                lastError: null,
                success: false,
                lastSuccessTime: null,
            },
            userLogin: {
                maxRetries: 3,
                currentRetries: 0,
                lastAttempt: null,
                lastError: null,
                success: false,
                lastSuccessTime: null,
            },
            verifyUserLogin: {
                maxRetries: 3,
                currentRetries: 0,
                lastAttempt: null,
                lastError: null,
                success: false,
                lastSuccessTime: null,
            },
            getTodaysClass: {
                maxRetries: 3,
                currentRetries: 0,
                lastAttempt: null,
                lastError: null,
                success: false,
                lastSuccessTime: null,
            },
            getClassLinkFromLectures: {
                maxRetries: 2,
                currentRetries: 0,
                lastAttempt: null,
                lastError: null,
                success: false,
                lastSuccessTime: null,
            },
            joinClass: {
                maxRetries: 4,
                currentRetries: 0,
                lastAttempt: null,
                lastError: null,
                success: false,
                lastSuccessTime: null,
            },
        };
    }

    private async cleanupOldScreenshots(userId: string) {
        try {
            const dirPath = path.join("screenshots", userId.toString());
            if (!fs.existsSync(dirPath)) return;

            const files = await fs.promises.readdir(dirPath);
            if (files.length <= MAX_SCREENSHOTS_PER_USER) return;

            // Sort files by creation time (oldest first)
            const fileStats = await Promise.all(
                files.map(async (file) => {
                    const filePath = path.join(dirPath, file);
                    const stats = await fs.promises.stat(filePath);
                    return { file, path: filePath, ctime: stats.ctime };
                }),
            );

            fileStats.sort((a, b) => a.ctime.getTime() - b.ctime.getTime());

            // Delete oldest files
            const filesToDelete = fileStats.slice(
                0,
                fileStats.length - MAX_SCREENSHOTS_PER_USER,
            );

            for (const fileInfo of filesToDelete) {
                await fs.promises.unlink(fileInfo.path);
                Logger.debug(`Deleted old screenshot: ${fileInfo.path}`);
            }

            Logger.info(
                `Cleaned up ${filesToDelete.length} old screenshots for user ${userId}`,
            );
        } catch (error) {
            Logger.error(`Failed to clean up old screenshots: ${error}`);
        }
    }

    public async captureScreenshot(
        page: any,
        saveToFile: boolean = true,
    ): Promise<Buffer | null> {
        try {
            Logger.debug("Capturing screenshot...");
            const screenshot = await page.screenshot({ 
                fullPage: true,
                type: 'png',
                encoding: 'binary'
            });

            if (saveToFile) {
                const userId = this.config.username || "default";
                const timestamp = Date.now();
                const dirPath = path.join("screenshots", userId.toString());
                fs.mkdirSync(dirPath, { recursive: true });
                Logger.debug(`Screenshot directory created: ${dirPath}`);
                const screenshotPath = path.join(dirPath, `${timestamp}.png`);
                Logger.debug(`Screenshot path: ${screenshotPath}`);
                await fs.promises.writeFile(screenshotPath, screenshot);
                Logger.info(`Screenshot saved: ${screenshotPath}`);

                // Clean up old screenshots
                await this.cleanupOldScreenshots(userId);
            }

            return screenshot;
        } catch (err) {
            Logger.error(`Failed to capture screenshot: ${err}`);
            return null; // Return null explicitly on error
        }
    }

    startMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
        }

        // Set up monitoring loop to run every minute
        this.monitoringInterval = setInterval(
            () => this.monitorExecution(),
            monitorExecutionInterval,
        );
        Logger.info("Started monitoring execution");
    }

    stopMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
            Logger.info("Stopped monitoring execution");
        }
    }

    async monitorExecution() {
        // Use mutex with timeout to prevent cycle starvation
        if (this.monitoringMutex.isLocked()) {
            Logger.debug("Previous monitoring cycle still running, skipping");
            return;
        }

        // Add a timeout to the mutex acquisition
        const release = await this.monitoringMutex.acquire().catch(() => null);
        if (!release) {
            Logger.error("Failed to acquire monitoring mutex, skipping cycle");
            return;
        }
        
        try {
            Logger.debug(`Monitoring execution. Current stage: ${this.currentStage}`);

            // Check browser connectivity first
            if (
                this.browser &&
                !this.browser.connected &&
                this.currentStage !== ExecutionStage.INITIAL
            ) {
                Logger.error("Browser connection lost, attempting to relaunch");
                this.currentStage = ExecutionStage.INITIAL;
                this.stageStatus.launchBrowser.success = false;
                this.updateSystemStatus();
            }

            // Based on current stage, determine what needs to be executed
            switch (this.currentStage) {
                case ExecutionStage.INITIAL:
                    if (!this.stageStatus.launchBrowser.success) {
                        await this.attemptStage("launchBrowser");
                    }
                    break;

                case ExecutionStage.BROWSER_LAUNCHED:
                    if (!this.stageStatus.userLogin.success) {
                        await this.attemptStage("userLogin");
                    }
                    break;

                case ExecutionStage.USER_LOGGED_IN:
                    if (!this.stageStatus.verifyUserLogin.success) {
                        await this.attemptStage("verifyUserLogin");
                    }
                    break;

                case ExecutionStage.LOGIN_VERIFIED:
                    if (!this.stageStatus.getTodaysClass.success) {
                        await this.attemptStage("getTodaysClass");
                    }
                    break;

                case ExecutionStage.GOT_TODAY_CLASSES:
                    if (this.lectures && this.lectures.length > 0) {
                        const classLinkPath = await this.getClassLinkFromLectures(
                            this.lectures,
                        );
                        if (classLinkPath) {
                            this.activeClassLink = `${this.config.codeTantraURL}${classLinkPath}`;
                            await this.attemptStage("joinClass");
                        } else {
                            // No active class, check again after some time
                            Logger.info(
                                "No active class found, will check again in the next monitoring cycle",
                            );
                        }
                    }
                    break;

                case ExecutionStage.CLASS_JOINED:
                    // Check if class is still in session
                    if (this.lectures && this.lectures.length > 0) {
                        const isStillActive = await this.checkIfClassIsStillActive();
                        if (!isStillActive) {
                            Logger.info("Current class session has ended");
                            this.currentStage = ExecutionStage.GOT_TODAY_CLASSES;
                            this.stageStatus.joinClass.success = false;
                        }
                        Logger.info("Class is still active");
                    }
                    break;

                case ExecutionStage.FAILED:
                    // Check what stage failed and try to recover
                    const failedStage = this.findFailedStage();
                    if (
                        failedStage &&
                        this.stageStatus[failedStage].currentRetries <
                            this.stageStatus[failedStage].maxRetries
                    ) {
                        Logger.info(
                            `Attempting to recover from failed stage: ${failedStage}`,
                        );
                        // Reset current stage to before the failed stage
                        this.setStageBeforeFailedStage(failedStage);
                        this.systemStatus = "degraded";
                    } else {
                        Logger.error("Maximum retries exceeded, system in failed state");
                        this.systemStatus = "failed";
                    }
                    break;
            }
        } catch (error: any) {
            Logger.error(`Error in monitoring execution: ${error}`);
            this.systemStatus = "degraded";
        } finally {
            release();
        }

        this.updateSystemStatus();
    }

    setStageBeforeFailedStage(failedStage: string) {
        switch (failedStage) {
            case "launchBrowser":
                this.currentStage = ExecutionStage.INITIAL;
                break;
            case "userLogin":
                this.currentStage = ExecutionStage.BROWSER_LAUNCHED;
                break;
            case "verifyUserLogin":
                this.currentStage = ExecutionStage.USER_LOGGED_IN;
                break;
            case "getTodaysClass":
                this.currentStage = ExecutionStage.LOGIN_VERIFIED;
                break;
            case "getClassLinkFromLectures":
            case "joinClass":
                this.currentStage = ExecutionStage.GOT_TODAY_CLASSES;
                break;
            default:
                this.currentStage = ExecutionStage.INITIAL;
        }
    }

    findFailedStage(): string | null {
        const stages = [
            "launchBrowser",
            "userLogin",
            "verifyUserLogin",
            "getTodaysClass",
            "getClassLinkFromLectures",
            "joinClass",
        ];

        for (const stage of stages) {
            if (!this.stageStatus[stage].success) {
                return stage;
            }
        }

        return null;
    }

    updateSystemStatus() {
        if (this.currentStage === ExecutionStage.FAILED) {
            if (
                Object.values(this.stageStatus).some(
                    (status) =>
                        status.currentRetries < status.maxRetries && !status.success,
                )
            ) {
                this.systemStatus = "degraded";
            } else {
                this.systemStatus = "failed";
            }
        } else if (this.currentStage === ExecutionStage.CLASS_JOINED) {
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

    async checkIfClassIsStillActive(): Promise<boolean> {
        Logger.debug(`Starting class activity check`);
        if (!this.lectures || this.lectures.length === 0) {
            Logger.debug(`No lectures found, class cannot be active`);
            return false;
        }

        try {
            const page = this.pages?.[0];
            if (!page) {
                await this.handleError(
                    "Page allocation failed while checking if class is still active",
                    "checkIfClassIsStillActive",
                );
                return false;
            }

            Logger.debug(`Waiting for selector: iframe#frame`);
            await page.waitForSelector("iframe#frame", { timeout: 20000 });
            Logger.debug(`Accessing class iframe`);
            const iframe = page
                .frames()
                .find((f) => f.name() === "frame" || f.url().includes("frame"));
            if (!iframe) {
                await this.handleError("Could not access class iframe!", "joinClass");
                await this.captureScreenshot(page);
                return false;
            }
            Logger.debug(`Successfully acquired iframe reference`);

            // Try to detect user presence without opening the users panel first
            try {
                // Method 1: Check for user presence via direct page content
                Logger.debug(`Attempting direct page content detection method`);
                const pageContent = await iframe.content();
                const hasUserInContent = pageContent.includes(this.config.username);
                const hasYouText = pageContent.includes("(You)");
                Logger.debug(`Direct content check - Username found: ${hasUserInContent}, (You) text found: ${hasYouText}`);

                if (hasUserInContent || hasYouText) {
                    Logger.info(`User detected directly in page content`);
                    return true;
                }
            } catch (error) {
                Logger.debug(`Direct page content check failed: ${error}`);
                // Continue to more detailed checks
            }

            // Only open the users panel if necessary
            try {
                Logger.debug(`Looking for users button`);
                const usersButtonSelectors = [
                    'button[aria-label="Users and messages toggle"]',
                    'button[aria-label="Users and messages toggle with new message notification"]',
                ];

                let usersButton = null;
                for (const selector of usersButtonSelectors) {
                    try {
                        Logger.debug(`Trying selector: ${selector}`);
                        usersButton = await iframe.waitForSelector(selector, {
                            timeout: 10000,
                        });
                        if (usersButton) {
                            Logger.debug(`Found users button with selector: ${selector}`);
                            break;
                        }
                    } catch (error) {
                        Logger.debug(`Selector ${selector} not found, trying next`);
                        // Try next selector
                    }
                }

                if (!usersButton) {
                    Logger.debug(
                        "Unable to find users button, but assuming user is still in class",
                    );
                    return true; // User is likely still in class if we can access the iframe
                }

                Logger.debug(`Clicking on users button`);
                await usersButton.click();
                Logger.info(`Clicked on: Users button`);

                Logger.debug(`Waiting for selector: div[aria-label="grid"]`);
                const grid = await iframe.waitForSelector('div[aria-label="grid"]', {
                    timeout: 10000,
                });
                if (!grid) {
                    await this.captureScreenshot(page);
                    Logger.debug(
                        "Grid not found, but continuing as user may still be in class",
                    );
                    return true;
                }

                Logger.info(`Grid found!`);

                // Use all methods with fault tolerance
                Logger.debug(`Checking for user presence with fault tolerance`);
                const userId = this.config.username;
                Logger.debug(`Checking for user ID: ${userId}`);

                // Track successful methods
                let successfulMethods = 0;
                let totalMethods = 0; // Increment this only for methods that run without error

                // Method 1: Check by aria-label Content
                try {
                    totalMethods++;
                    Logger.debug(
                        `Method 1: Checking if user ${userId} exists by aria-label`,
                    );
                    const userByAriaLabel = await iframe.$(
                        `div[aria-label*="${userId}"]`,
                    );
                    if (userByAriaLabel) {
                        Logger.debug(`Method 1 result: User found!`);
                        successfulMethods++;
                    } else {
                        Logger.debug(`Method 1 result: User not found by aria-label`);
                    }
                } catch (error) {
                    Logger.error(`Method 1 error: ${error}`);
                }

                // Method 2: Check by Text Content in userNameMain element
                try {
                    totalMethods++;
                    Logger.debug(
                        `Method 2: Checking if user ${userId} exists in userNameMain element`,
                    );
                    const userNameElements = await iframe.$$(".userNameMain--2fo2zM");
                    Logger.debug(`Found ${userNameElements.length} userNameMain elements to check`);

                    let found = false;
                    for (const element of userNameElements) {
                        try {
                            const textContent = await element.evaluate(
                                (el) => el.textContent,
                            );
                            Logger.debug(`Element text content: "${textContent}"`);
                            if (textContent && textContent.includes(userId)) {
                                Logger.debug(`Method 2 result: User found!`);
                                successfulMethods++;
                                found = true;
                                break;
                            }
                        } catch (detachedError) {
                            Logger.debug(`Element detached during evaluation: ${detachedError}`);
                            // Element might have been detached, continue with other elements
                        }
                    }
                    if (!found) {
                        Logger.debug(`Method 2 result: User not found in any userNameMain element`);
                    }
                } catch (error) {
                    Logger.error(`Method 2 error: ${error}`);
                }

                // Method 3: Check for (You) text or username in grid
                try {
                    totalMethods++;
                    Logger.debug(`Method 3: Checking for (You) text or username`);

                    try {
                        const gridContent = await grid.evaluate((el) => el.textContent);
                        Logger.debug(`Grid content (truncated): ${gridContent?.substring(0, 100)}...`);
                        const hasUser = gridContent && gridContent.includes(userId);
                        const hasYouText = gridContent && gridContent.includes("(You)");
                        Logger.debug(`Grid check - Username found: ${hasUser}, (You) text found: ${hasYouText}`);

                        if (hasUser || hasYouText) {
                            Logger.debug(
                                `Method 3 result: ${
                                    hasUser ? "Username found!" : "(You) text found!"
                                }`,
                            );
                            successfulMethods++;
                        } else {
                            Logger.debug(`Method 3 result: Neither username nor (You) text found in grid`);
                        }
                    } catch (detachedError) {
                        Logger.debug(`Grid element detached during evaluation: ${detachedError}`);
                    }
                } catch (error) {
                    Logger.error(`Method 3 error: ${error}`);
                }

                // Take a screenshot for verification
                Logger.debug(`Taking verification screenshot`);
                await this.captureScreenshot(page);

                // Try to close the users panel gracefully
                try {
                    if (usersButton) {
                        Logger.debug(`Attempting to close users panel`);
                        await usersButton.click();
                        Logger.debug(`Users panel closed`);
                    }
                } catch (error) {
                    Logger.debug(`Failed to close users panel: ${error}`);
                }

                // Calculate success rate (only if we had methods that ran)
                if (totalMethods > 0) {
                    const successRate = successfulMethods / totalMethods;
                    Logger.info(
                        `User detection success rate: ${successRate} (${successfulMethods}/${totalMethods})`,
                    );

                    const isUserPresent = successRate >= this.userDetectionFaultTolerance;
                    Logger.info(
                        isUserPresent
                            ? `User detected in class with sufficient confidence`
                            : `User may not be in class anymore, detection confidence: ${successRate}`,
                    );
                    return isUserPresent;
                }

                Logger.info(
                    `No detection methods succeeded, something went wrong, assuming user has left class`,
                );
                return false;
            } catch (error) {
                // If we fail here but we already accessed the iframe, assume user is still in class
                Logger.error(`Error in user panel operations: ${error}`);
                Logger.debug(`We could access iframe, so assuming user is still in class despite error`);
                return true;
            }
        } catch (error: any) {
            Logger.error(`Error checking if class is still active: ${error}`);
            Logger.debug(`Major error in class activity check, returning false to be safe`);
            // If we can't verify, assume the class is not active as a safer default
            return false;
        }
    }

    async attemptStage(stageName: string) {
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
            this.stageStatus[stageName].lastAttempt = dayjs()
                .tz(tzLocation)
                .format("YYYY-MM-DD HH:mm:ss");

            let result: boolean = false;
            switch (stageName) {
                case "launchBrowser":
                    result = await this.launchBrowser();
                    break;
                case "userLogin":
                    result = await this.userLogin();
                    break;
                case "verifyUserLogin":
                    result = await this.verifyUserLogin();
                    break;
                case "getTodaysClass":
                    result = await this.getTodaysClass();
                    break;
                case "joinClass":
                    if (this.activeClassLink) {
                        result = await this.joinClass(this.activeClassLink);
                    } else {
                        Logger.error("No active class link available");
                        result = false;
                    }
                    break;
                default:
                    Logger.error(`Unknown stage: ${stageName}`);
                    result = false;
            }

            // Update status
            if (result) {
                this.stageStatus[stageName].success = true;
                this.stageStatus[stageName].lastSuccessTime = dayjs()
                    .tz(tzLocation)
                    .format("YYYY-MM-DD HH:mm:ss");
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

    private async handleError(message: string, functionName?: string) {
        Logger.error(message, functionName);
        if (this.pages) {
            for (const page of this.pages) {
                await this.captureScreenshot(page);
            }
        }
        if (functionName && this.stageStatus[functionName]) {
            this.stageStatus[functionName].lastError = message;
            this.stageStatus[functionName].success = false;
        }
    }

    async validateConfig() {
        Logger.debug("Validating config...");
        const missingVars = Object.entries(this.config)
            .filter(([_, value]) => !value)
            .map(([key]) => key);

        if (missingVars.length > 0) {
            await this.handleError(
                `Missing environment variables: ${missingVars.join(", ")}`,
            );
            return;
        }
    }

    async launchBrowser(): Promise<boolean> {
        try {
            Logger.debug("Launching browser...");
            this.browser = await puppeteer.launch({
                // devtools: true,
                headless: process.env.HEADLESS?.toLowerCase() === "1",
                defaultViewport: null,
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
                args: [
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                    "--ignore-certificate-errors",
                    "--ignore-certificate-errors-spki-list",
                    "--single-process",
                    "--no-zygote",
                    "--no-first-run",
                    "--disable-extensions",
                    "--user-data-dir=/tmp/chromium-user-data"
                ],
            });
            const browserVer = await this.browser.version();
            if (!browserVer) {
                await this.handleError(
                    "Failed to launch browser instance",
                    "launchBrowser",
                );
                return false;
            }
            Logger.info(`Browser launched: ${browserVer}`);

            if (!(await this.browser.pages()).length) {
                Logger.info(`No browser pages found, opening new page.`);
                await this.browser.newPage();
            }
            Logger.debug("Assigning browser pages to class variables");
            this.pages = await this.browser.pages();
            this.pages.forEach((page) => page.setDefaultNavigationTimeout(60000));
            await this.disablePageImages();
            // await this.openDevTools();
            this.currentStage = ExecutionStage.BROWSER_LAUNCHED;
            return true;
        } catch (error: any) {
            await this.handleError(
                `Error launching browser: ${error.message || error}`,
                "launchBrowser",
            );
            return false;
        }
    }

    async disablePageImages() {
        this.pages?.forEach(async (page) => {
            await page.setRequestInterception(true);
            page.on("request", (request) => {
                if (request.resourceType() === "image") {
                    request.abort();
                } else {
                    request.continue();
                }
            });
        });
    }

    async openDevTools() {
        const targets = await this.browser?.targets();
        const devtoolsTarget = targets?.find((t) => {
            return t.type() === "other" && t.url().startsWith("devtools://");
        });

        const client = await devtoolsTarget?.createCDPSession();
        await client?.send("Runtime.enable");

        await client?.send("Runtime.evaluate", {
            expression: `
                window.UI.viewManager.showView('network');
                window.UI.dockController.setDockSide('bottom');
            `,
        });

        await client?.send("Network.enable");
    }

    async userLogin(): Promise<boolean> {
        try {
            Logger.info(`Logging in as user: ${this.config.username}`);
            const page = this.pages?.[0];
            if (!page) {
                await this.handleError(
                    "Page allocation failed while logging in as user",
                    "userLogin",
                );
                return false;
            }
            Logger.debug(`Redirecting page to url: ${this.config.classHomeUrl}`);
            await page.goto(this.config.classHomeUrl);
            Logger.debug(`Waiting for selector: Login Form Submit Button`);
            await page.waitForSelector('button[type="submit"]');
            Logger.debug(`Filling in username: ${this.config.username}`);
            await page.type('input[placeholder="Username"]', this.config.username);
            Logger.debug(
                `Filling in password: ${this.config.password.replace(/./g, "*")}`,
            );
            await page.type('input[placeholder="Password"]', this.config.password);
            Logger.debug(`Clicking on: Login Form Submit Button`);
            await page.click('button[type="submit"]');
            Logger.debug(`Waiting for navigation to complete`);
            const normalizeUrl = (url: string) => url.replace(/\/+$/, "");

            // wait until currentUrl changes
            while (normalizeUrl(page.url()) === normalizeUrl(this.config.classHomeUrl)) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
            Logger.debug(`Class Home URL: ${this.config.classHomeUrl}`);
            Logger.debug(`Current page URL: ${page.url()}`);
            // await page.waitForNavigation({
            //     waitUntil: "networkidle2",
            // });
            Logger.info(`User logged in successfully!`);
            this.currentStage = ExecutionStage.USER_LOGGED_IN;
            return true;
        } catch (error: any) {
            await this.handleError(
                `Error during user login: ${error.message || error}`,
                "userLogin",
            );
            return false;
        }
    }

    async verifyUserLogin(): Promise<boolean> {
        try {
            Logger.info(`Verifying user loging`);
            const page = this.pages?.[0];
            if (!page) {
                await this.handleError(
                    "Page allocation failed while verifying user login",
                    "verifyUserLogin",
                );
                return false;
            }
            const homeUrl = this.config.codeTantraURL + "/secure/home.jsp";
            Logger.debug(`Redirecting to ${homeUrl} URL to verify user login`);
            await page.goto(homeUrl, {
                waitUntil: "networkidle2",
            });
            const loginXPath = `xpath=//a[contains(text(), "${this.config.username}.${this.config.studentEmailPostfix}")]`;
            Logger.debug(`Waiting for login XPath selector: ${loginXPath}`);
            const loginElements = await page.$$(loginXPath);
            Logger.debug(`Login elements found: ${loginElements.length}`);
            if (!loginElements.length) {
                await this.handleError("Login verification failed!", "verifyUserLogin");
                return false;
            }
            this.currentStage = ExecutionStage.LOGIN_VERIFIED;
            return true;
        } catch (error: any) {
            await this.handleError(
                `Error verifying user login: ${error.message || error}`,
                "verifyUserLogin",
            );
            return false;
        }
    }

    async getTodaysClass(): Promise<boolean> {
        try {
            Logger.info(`Getting today's class`);
            const page = this.pages?.[0];
            if (!page) {
                await this.handleError(
                    "Page allocation failed while getting today's class",
                    "getTodaysClass",
                );
                return false;
            }
            const pageUrl = `${this.config.codeTantraURL}/secure/tla/m.jsp`;
            Logger.debug(`Redirecting page to url: ${pageUrl}`);
            await page.goto(pageUrl);

            Logger.debug(`Waiting for selector: #calendar`);
            await page.waitForSelector("#calendar");
            const today = dayjs().tz("Asia/Kolkata").format("MMMM D, YYYY");
            let calendarText = await page.$eval(
                "#calendar > :first-child > :nth-child(2)",
                (el) => el.textContent,
            );
            calendarText = calendarText.split(" (")[0];
            Logger.info(
                `Today's date: ${today} | Webpage Calendar date: ${calendarText}`,
            );
            // Get all lecture elements from the calendar
            await page.waitForSelector(".fc-time-grid-event.fc-event.fc-start.fc-end", {
                timeout: 60000,
            });
            await this.captureScreenshot(page);
            const lectures = await page.$$eval(
                ".fc-time-grid-event.fc-event.fc-start.fc-end",
                (elements) => {
                    console.log(elements);
                    return elements.map((el) => {
                        const titleEl = el.querySelector(".fc-title");
                        const timeEl = el.querySelector(".fc-time");
                        return {
                            title: titleEl ? titleEl.textContent?.trim() || "" : "",
                            href: el.getAttribute("href") || "",
                            time: timeEl ? timeEl.getAttribute("data-full") || "" : "",
                            lectureName: el.textContent?.trim() || "",
                        };
                    });
                },
            );
            Logger.info(`Found ${lectures.length} lectures for today`);
            this.lectures = lectures;
            this.currentStage = ExecutionStage.GOT_TODAY_CLASSES;
            return true;
        } catch (error: any) {
            await this.handleError(
                `Error getting today's class: ${error.message || error}`,
                "getTodaysClass",
            );
            return false;
        }
    }

    async joinClass(classLink: string): Promise<boolean> {
        try {
            if (!this.pages) {
                await this.handleError(
                    "Page allocation failed while joining class",
                    "joinClass",
                );
                return false;
            }
            const page = this.pages[0];
            Logger.debug(`Redirecting page to class link: ${classLink}`);
            await page.goto(classLink);
            // await page.waitForNavigation(); // commenting this out cuz for some reason it's not working as expected
            Logger.debug(`Waiting for selector: .joinBtn`);
            const joinButton = await page.$(".joinBtn");
            if (!joinButton) {
                await this.handleError("Join button not found!", "joinClass");
                return false;
            }
            Logger.debug(`Clicking on: .joinBtn`);
            // const relHref = await page.$eval(".joinBtn", el => el.getAttribute("href"));
            const relHref = await joinButton.evaluate((el) => el.getAttribute("href"));
            if (!relHref) {
                await this.handleError("Join link not found!", "joinClass");
                return false;
            }
            const joinLink = `${this.config.codeTantraURL}${relHref}`;
            Logger.info(`Join link: ${joinLink}`);
            await page.goto(joinLink);

            Logger.debug(`Waiting for selector: iframe#frame`);
            await page.waitForSelector("iframe#frame");
            Logger.debug(`Accessing class iframe`);
            const iframe = page
                .frames()
                .find((f) => f.name() === "frame" || f.url().includes("frame"));
            if (!iframe) {
                await this.handleError("Could not access class iframe!", "joinClass");
                await this.captureScreenshot(page);
                return false;
            }

            Logger.debug(`Waiting for selector: button[aria-label="Listen only"]`);
            const listenOnlyButton = await iframe.waitForSelector(
                'button[aria-label="Listen only"]',
            );
            if (!listenOnlyButton) {
                await this.captureScreenshot(page);
                await this.handleError("Listen only button not found!", "joinClass");
                return false;
            }
            Logger.debug(`Clicking on: button[aria-label="Listen only"]`);
            await listenOnlyButton.click();
            Logger.info(`Clicked on: Listen only button`);
            this.currentStage = ExecutionStage.CLASS_JOINED;
            await this.captureScreenshot(page);
            return true;
        } catch (error: any) {
            await this.handleError(
                `Error joining class: ${error.message || error}`,
                "joinClass",
            );
            for (const page of this.pages || []) {
                await this.captureScreenshot(page);
            }
            return false;
        }
    }

    async getClassLinkFromLectures(lectures: LectureData[]) {
        try {
            Logger.info(`Getting active lecture`);
            let activeLecture = null;
            for (const lecture of lectures) {
                Logger.debug(`Checking lecture: ${JSON.stringify(lecture)}`);
                let [startTime, endTime] = lecture.time.split(" - ");
                if (!startTime) {
                    await this.handleError(
                        `Start time not found for lecture: ${lecture.lectureName}`,
                        "getClassLinkFromLectures",
                    );
                    continue;
                }
                if (!endTime) {
                    // For testing, default startTime
                    startTime = "07:00";
                    // Assume startTime is PM and add 2 hours
                    endTime = dayjs(`${startTime} PM`, "hh:mm A")
                        .add(2, "hour")
                        .format("HH:mm");
                }
                const [startHour, startMinute] = startTime.split(":");
                const [endHour, endMinute] = endTime.split(":");

                // Convert to 24-hour format by adding 12 if hour is less than 12 (assumed PM)
                const startHourNum =
                    Number(startHour) < 12 ? Number(startHour) + 12 : Number(startHour);
                const endHourNum =
                    Number(endHour) < 12 ? Number(endHour) + 12 : Number(endHour);

                const startDate = dayjs()
                    .tz(tzLocation)
                    .set("hour", startHourNum)
                    .set("minute", Number(startMinute));
                const endDate = dayjs()
                    .tz(tzLocation)
                    .set("hour", endHourNum)
                    .set("minute", Number(endMinute));

                if (dayjs().isBetween(startDate, endDate)) {
                    activeLecture = lecture;
                    break; // Exit loop once we find an active lecture
                }
            }

            if (!activeLecture) {
                await this.handleError(
                    `No active lecture found, next class at ${
                        lectures[0]?.time || "unknown"
                    }`,
                    "getClassLinkFromLectures",
                );
                // reset stage status to previous stage to trigger retry
                this.setStageBeforeFailedStage("getClassLinkFromLectures");
                return null;
            }

            // Mark this function as successful
            this.stageStatus.getClassLinkFromLectures.success = true;
            this.stageStatus.getClassLinkFromLectures.lastSuccessTime = dayjs()
                .tz(tzLocation)
                .format("YYYY-MM-DD HH:mm:ss");

            return activeLecture.href;
        } catch (error: any) {
            await this.handleError(
                `Error getting class link: ${error.message || error}`,
                "getClassLinkFromLectures",
            );
            this.stageStatus.getClassLinkFromLectures.success = false;
            this.stageStatus.getClassLinkFromLectures.currentRetries++;
            return null;
        }
    }

    async closeBrowser() {
        if (this.browser) {
            await this.browser.close();
            Logger.info("Browser closed!");
        }
    }

    async apiStatus() {
        return {
            username: this.config.username,
            status: this.systemStatus,
            timestamp: new Date().toISOString(),
            startTime: this.startTime,
            currentStage: this.currentStage,
            stageStatus: this.stageStatus,
            browser: {
                version: (await this.browser?.version()) || "N/A",
                pages: this.pages?.length || 0,
                open: this.browser?.connected || false,
            },
            lectures: this.lectures,
            activeClassLink: this.activeClassLink,
        };
    }
}

const initiateAutomationSequence = async (automation: Automation) => {
    try {
        // Start the monitoring process
        automation.startMonitoring();
    } catch (error: any) {
        Logger.error(`Error initiating automation sequence: ${error}`);
        automation.currentStage = ExecutionStage.FAILED;
        automation.systemStatus = "failed";
    }
};

app.listen(PORT, async () => {
    Logger.info(`Server running on port ${PORT}`);
    Logger.debug(`Creating automation instance...`);
    const automation = new Automation(configInit);
    Logger.debug(`Automation instance created!`);

    try {
        await initiateAutomationSequence(automation);
    } catch (error: any) {
        Logger.error(`Error occurred: ${error}`);
        automation.currentStage = ExecutionStage.FAILED;
        automation.systemStatus = "failed";
    }

    app.get("/status", (_req: Request, res: Response) => {
        Logger.debug("GET /status");
        automation.apiStatus().then((status) => {
            res.json(status);
        });
    });

    app.get("/screenshot", async (_req: Request, res: Response) => {
        Logger.debug("GET /screenshot");
        try {
            if (!automation.browser || !automation.browser.connected) {
                res.status(503).json({
                    error: "Browser not connected",
                    stage: automation.currentStage,
                    status: automation.systemStatus,
                });
                return;
            }

            if (!automation.pages || automation.pages.length === 0) {
                res.status(503).json({
                    error: "No browser pages available",
                    stage: automation.currentStage,
                    status: automation.systemStatus,
                });
                return;
            }

            const screenshot = await automation.captureScreenshot(
                automation.pages[0],
                false,
            );

            if (!screenshot) {
                res.status(500).json({
                    error: "Failed to capture screenshot",
                    stage: automation.currentStage,
                    status: automation.systemStatus,
                });
                return;
            }

            res.setHeader("Content-Type", "image/png");
            res.setHeader("Content-Disposition", "inline; filename=screenshot.png");
            res.setHeader("Cache-Control", "no-cache");
            res.end(screenshot);
            
        } catch (error: any) {
            Logger.error(`Error in /screenshot endpoint: ${error.message || error}`);
            res.status(500).json({
                error: "Internal server error",
                details: error.message || error,
                stage: automation.currentStage,
                status: automation.systemStatus,
            });
        }
    });

    process.on("SIGINT", async () => {
        Logger.info("Received SIGINT signal, closing browser...");
        automation.stopMonitoring();
        await automation.closeBrowser();
        process.exit(0);
    });
});

["unhandledRejection", "uncaughtException"].forEach((event) => {
    process.on(event, async (error: any) => {
        Logger.error(`${event} occurred: ${error}`);
    });
});
