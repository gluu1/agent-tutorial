// plugins/loggerPlugin.ts - 日志插件 (LoggerPlugin)

import { Plugin, PluginMetadata, PluginHooks } from "./types";
import { Agent } from "../agent";
import { AgentLoop } from "../agent-loop";
import { AgentConfig, AgentResult, AgentMessage } from "../types";
import * as fs from "fs";
import * as path from "path";

export interface LoggerPluginConfig {
  logLevel: "debug" | "info" | "warn" | "error";
  logToFile: boolean;
  logFilePath?: string;
  logToConsole: boolean;
  includeTimestamps: boolean;
  includeSessionId: boolean;
}

/**
 * 日志插件
 * 记录 Agent 运行的所有事件和状态变化
 */
export class LoggerPlugin implements PluginHooks {
  public metadata: PluginMetadata = {
    name: "logger",
    version: "1.0.0",
    description: "记录 Agent 运行日志",
    author: "Agent Core Team",
    license: "MIT",
    permissions: ["fs.write"],
  };

  private config: LoggerPluginConfig;
  private logStream?: fs.WriteStream;
  private sessionId?: string;

  constructor(config: Partial<LoggerPluginConfig> = {}) {
    this.config = {
      logLevel: "info",
      logToFile: false,
      logToConsole: true,
      includeTimestamps: true,
      includeSessionId: true,
      ...config,
    };
  }

  async onInit(agent: Agent, config: AgentConfig): Promise<void> {
    this.sessionId = config.sessionId;

    // 初始化日志文件
    if (this.config.logToFile) {
      const logDir = this.config.logFilePath || "./logs";
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      const logFile = path.join(logDir, `agent_${this.sessionId}.log`);
      this.logStream = fs.createWriteStream(logFile, { flags: "a" });
      this.log(
        "info",
        `Logger plugin initialized for session ${this.sessionId}`,
      );
    }

    this.log("info", "Logger plugin started");
  }

  async onBeforeLoop(loop: AgentLoop, input: string): Promise<void> {
    this.log(
      "info",
      `Starting agent loop with input: ${input.substring(0, 100)}...`,
    );
  }

  async onAfterLoop(loop: AgentLoop, result: AgentResult): Promise<void> {
    this.log(
      "info",
      `Agent loop completed. Success: ${result.success}, Iterations: ${result.iterations}, Duration: ${result.duration}ms`,
    );
  }

  async onBeforeToolCall(toolName: string, params: any): Promise<any> {
    this.log("debug", `Tool call started: ${toolName}`, { params });
    return params;
  }

  async onAfterToolCall(toolName: string, result: any): Promise<void> {
    this.log("debug", `Tool call completed: ${toolName}`, {
      resultPreview: JSON.stringify(result).substring(0, 200),
    });
  }

  async onBeforeMessage(message: AgentMessage): Promise<AgentMessage> {
    this.log("debug", `Message received: ${message.role}`, {
      contentLength: message.content.length,
    });
    return message;
  }

  async onError(error: Error): Promise<void> {
    this.log("error", `Error occurred: ${error.message}`, {
      stack: error.stack,
    });
  }

  async onUserInput(input: string): Promise<string> {
    this.log("info", `User input: ${input.substring(0, 100)}...`);
    return input;
  }

  async onDestroy(): Promise<void> {
    this.log("info", "Logger plugin shutting down");

    if (this.logStream) {
      this.logStream.end();
      this.logStream = undefined;
    }
  }

  private log(
    level: string,
    message: string,
    extra?: Record<string, any>,
  ): void {
    const shouldLog = this.shouldLog(level);
    if (!shouldLog) return;

    const timestamp = this.config.includeTimestamps
      ? `[${new Date().toISOString()}]`
      : "";
    const session =
      this.config.includeSessionId && this.sessionId
        ? `[${this.sessionId}]`
        : "";
    const logMessage = `${timestamp}${session}[${level.toUpperCase()}] ${message}`;

    if (this.config.logToConsole) {
      const consoleMethod =
        level === "error"
          ? console.error
          : level === "warn"
            ? console.warn
            : console.log;
      consoleMethod(logMessage, extra || "");
    }

    if (this.config.logToFile && this.logStream) {
      this.logStream.write(
        `${logMessage} ${extra ? JSON.stringify(extra) : ""}\n`,
      );
    }
  }

  private shouldLog(level: string): boolean {
    const levels = ["debug", "info", "warn", "error"];
    const currentIndex = levels.indexOf(this.config.logLevel);
    const levelIndex = levels.indexOf(level);
    return levelIndex >= currentIndex;
  }
}
