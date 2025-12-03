import express, { Request, Response } from "express";
import Logger from "./utils/logger";
import * as dotenv from "dotenv";
import * as path from "path";
import { Mutex } from "async-mutex";

const envFile = process.env.ENV_FILE || ".env";
dotenv.config({
    path: path.resolve(process.cwd(), envFile),
    override: true,
});
console.log("Loaded ENV file:", envFile);

const app = express();
const PORT = process.env.PORT || 3000;
const MONITORING_INTERVAL = 30000; // 30 seconds

// Execution stages for workflow tracking
enum ExecutionStage {
    INITIAL = "initial",
    INITIALIZED = "initialized",
    WORKFLOW_RUNNING = "workflow_running",
    WORKFLOW_COMPLETED = "workflow_completed",
    FAILED = "failed",
}

type TConfig = {
    username: string;
    password: string;
    platformHomeUrl: string;
    emailPrefix: string;
    targetPlatformURL: string;
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

const configInit: TConfig = {
    username: process.env.USERNAME as string,
    password: process.env.PASSWORD as string,
    platformHomeUrl: process.env.HOME_URL as string,
    emailPrefix: process.env.EMAIL_PREFIX as string,
    targetPlatformURL: process.env.TARGET_URL as string,
};

Logger.debug("Config loaded:", {
    username: configInit.username,
    platformHomeUrl: configInit.platformHomeUrl,
    password: "***REDACTED***",
});

class Automation {
    config: TConfig;
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
            workflowExecution: {
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
        const missingVars = Object.entries(this.config)
            .filter(([_, value]) => !value)
            .map(([key]) => key);

        if (missingVars.length > 0) {
            Logger.error(`Missing environment variables: ${missingVars.join(", ")}`);
            this.systemStatus = "failed";
            this.currentStage = ExecutionStage.FAILED;
            return;
        }
        Logger.info("Configuration validated successfully");
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
                    await this.attemptStage("workflowExecution");
                    break;

                case ExecutionStage.WORKFLOW_RUNNING:
                    Logger.debug("Workflow currently running...");
                    await this.attemptStage("healthCheck");
                    break;

                case ExecutionStage.WORKFLOW_COMPLETED:
                    Logger.info("Workflow completed successfully");
                    // Could restart or wait for external trigger
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
     * Reset system to stage before failure for retry
     */
    resetStageBeforeFailure(failedStage: string) {
        switch (failedStage) {
            case "initialization":
                this.currentStage = ExecutionStage.INITIAL;
                break;
            case "workflowExecution":
                this.currentStage = ExecutionStage.INITIALIZED;
                break;
            case "healthCheck":
                this.currentStage = ExecutionStage.WORKFLOW_RUNNING;
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
        } else if (this.currentStage === ExecutionStage.WORKFLOW_COMPLETED) {
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
                case "workflowExecution":
                    result = await this.executeWorkflow();
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
     * Main workflow execution with mutex protection
     */
    async executeWorkflow(): Promise<boolean> {
        // Use mutex to prevent concurrent workflow execution
        if (this.workflowMutex.isLocked()) {
            Logger.debug("Workflow already running, skipping execution");
            return true;
        }

        const release = await this.workflowMutex.acquire().catch(() => null);
        if (!release) {
            Logger.error("Failed to acquire workflow mutex");
            return false;
        }

        try {
            this.currentStage = ExecutionStage.WORKFLOW_RUNNING;
            this.executionCount++;
            
            Logger.info(`Starting workflow execution #${this.executionCount}...`);
            
            // TODO: Implement your automation workflow here
            // Examples:
            // - Web scraping tasks
            // - API integrations
            // - Data processing pipelines
            // - Scheduled operations
            // - Resource monitoring
            
            Logger.info("Workflow execution completed successfully");
            this.currentStage = ExecutionStage.WORKFLOW_COMPLETED;
            return true;
        } catch (error: any) {
            Logger.error(`Workflow execution failed: ${error.message || error}`);
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
            
            // TODO: Add your health check logic
            // Examples:
            // - Verify external service connections
            // - Check resource availability
            // - Validate data integrity
            // - Monitor performance metrics
            
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
        
        // TODO: Add cleanup logic
        // Examples:
        // - Close database connections
        // - Release resources
        // - Save state
        // - Graceful termination of background tasks
        
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

app.listen(PORT, async () => {
    Logger.info(`Server running on port ${PORT}`);
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
        res.json(status);
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
        });
    });

    // Metrics endpoint for Prometheus scraping
    app.get("/metrics", async (_req: Request, res: Response) => {
        const uptime = Date.now() - new Date(automation.startTime).getTime();
        const status = await automation.apiStatus();
        
        // Prometheus format metrics
        const metrics = `
# HELP automation_uptime_seconds Total uptime in seconds
# TYPE automation_uptime_seconds gauge
automation_uptime_seconds ${Math.floor(uptime / 1000)}

# HELP automation_execution_count Total number of workflow executions
# TYPE automation_execution_count counter
automation_execution_count ${automation.executionCount}

# HELP automation_status Current system status (0=failed, 1=degraded, 2=healthy)
# TYPE automation_status gauge
automation_status ${automation.systemStatus === "healthy" ? 2 : automation.systemStatus === "degraded" ? 1 : 0}

# HELP automation_stage_success Stage completion status (0=failed, 1=success)
# TYPE automation_stage_success gauge
${Object.entries(status.stageStatus)
    .map(([stage, config]) => `automation_stage_success{stage="${stage}"} ${config.success ? 1 : 0}`)
    .join("\n")}

# HELP automation_stage_retries Current retry count per stage
# TYPE automation_stage_retries gauge
${Object.entries(status.stageStatus)
    .map(([stage, config]) => `automation_stage_retries{stage="${stage}"} ${config.currentRetries}`)
    .join("\n")}
`.trim();
        
        res.setHeader("Content-Type", "text/plain");
        res.send(metrics);
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
});

["unhandledRejection", "uncaughtException"].forEach((event) => {
    process.on(event, async (error: any) => {
        Logger.error(`${event} occurred: ${error}`);
    });
});
