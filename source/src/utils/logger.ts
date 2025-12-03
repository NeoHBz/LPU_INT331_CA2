import * as dotenv from "dotenv";
dotenv.config();

type LogLevel = "debug" | "info" | "error";
type Colors = "green" | "red" | "yellow" | "magenta" | "reset";

class Logger {
    private static envLevel: LogLevel = process.env.LOG_LEVEL as LogLevel || "info";

    private static levels: Record<LogLevel, number> = {
        debug: 0,
        info: 1,
        error: 2,
    };

    private static colorCodes: Record<Colors | LogLevel, string> = {
        magenta: `\x1b[35m`,
        green: `\x1b[32m`,
        info: `\x1b[32m`,
        red: `\x1b[31m`,
        error: `\x1b[31m`,
        yellow: `\x1b[33m`,
        debug: `\x1b[33m`,
        reset: `\x1b[0m`,
    };

    private static colorLog(color: Colors | LogLevel, message: string | number): string {
        return `${this.colorCodes[color]}${message}${this.colorCodes["reset"]}`;
    }

    private static currentLevel: number = Logger.getLogLevel();

    private static getLogLevel(): number {
        return Logger.levels[this.envLevel as LogLevel] ?? Logger.levels.info;
    }

    static log(level: LogLevel, message: string, ...args: unknown[]): void {
        if (Logger.levels[level] >= Logger.currentLevel) {
            console[level](
                `${
                    this.envLevel == "debug"
                        ? `${this.colorLog("magenta", Date.now())} `
                        : ""
                }[${this.colorLog(level, level.toUpperCase())}]`,
                message,
                ...args,
            );
        }
    }

    static debug(message: string, ...args: unknown[]) {
        Logger.log("debug", message, ...args);
    }

    static info(message: string, ...args: unknown[]) {
        Logger.log("info", message, ...args);
    }

    static error(message: string, ...args: unknown[]) {
        Logger.log("error", message, ...args);
    }
}

export default Logger;
