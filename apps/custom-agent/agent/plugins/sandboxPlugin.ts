// plugins/sandboxPlugin.ts - 安全沙箱插件 (SandboxPlugin)

import { Plugin, PluginHooks, PluginMetadata } from "./types";
import { Agent } from "../agent";
import { AgentConfig, AgentMessage, AgentResult } from "../types";
import { AgentLoop } from "agent/agent-loop";

export interface SandboxConfig {
  allowedDomains: string[];
  allowedPaths: string[];
  blockedCommands: string[];
  maxFileSize: number;
  enableNetwork: boolean;
  enableFileSystem: boolean;
}

/**
 * 安全沙箱插件
 * 限制工具的执行权限，防止恶意操作
 */
export class SandboxPlugin implements Plugin {
  public metadata: PluginMetadata = {
    name: "sandbox",
    version: "1.0.0",
    description: "安全沙箱，限制工具执行权限",
    author: "Agent Core Team",
    license: "MIT",
    permissions: ["network", "fs"],
  };

  private config: SandboxConfig;

  constructor(config: Partial<SandboxConfig> = {}) {
    this.config = {
      allowedDomains: ["api.openai.com", "api.deepseek.com", "localhost"],
      allowedPaths: ["./workspace", "./data"],
      blockedCommands: ["rm", "delete", "exec", "eval", "sudo"],
      maxFileSize: 10 * 1024 * 1024, // 10MB
      enableNetwork: true,
      enableFileSystem: true,
      ...config,
    };
  }
  name: string;
  version: string;
  description?: string;
  onBeforeLoop?(loop: AgentLoop, input: string): Promise<void> {
    throw new Error("Method not implemented.");
  }
  onAfterLoop?(loop: AgentLoop, result: AgentResult): Promise<void> {
    throw new Error("Method not implemented.");
  }
  onAfterToolCall?(toolName: string, result: any): Promise<void> {
    throw new Error("Method not implemented.");
  }
  onMessage?(message: AgentMessage): Promise<AgentMessage> {
    throw new Error("Method not implemented.");
  }
  onError?(error: Error): Promise<void> {
    throw new Error("Method not implemented.");
  }

  async onInit(agent: Agent, config: any): Promise<void> {
    console.log("Sandbox plugin initialized");
  }

  async onBeforeToolCall(toolName: string, params: any): Promise<any> {
    // 检查工具权限
    this.checkToolPermissions(toolName, params);

    // 包装工具执行，添加沙箱限制
    return this.sandboxParams(params);
  }

  /**
   * 检查工具权限
   */
  private checkToolPermissions(toolName: string, params: any): void {
    // 检查网络请求
    if (toolName.includes("fetch") || toolName.includes("http")) {
      if (!this.config.enableNetwork) {
        throw new Error(`Network tool ${toolName} is disabled`);
      }

      const url = params.url || params.endpoint;
      if (url && !this.isDomainAllowed(url)) {
        throw new Error(`Domain not allowed: ${url}`);
      }
    }

    // 检查文件操作
    if (
      toolName.includes("file") ||
      toolName.includes("read") ||
      toolName.includes("write")
    ) {
      if (!this.config.enableFileSystem) {
        throw new Error(`File tool ${toolName} is disabled`);
      }

      const filePath = params.path || params.filePath;
      if (filePath && !this.isPathAllowed(filePath)) {
        throw new Error(`Path not allowed: ${filePath}`);
      }

      // 检查文件大小
      if (params.size && params.size > this.config.maxFileSize) {
        throw new Error(
          `File too large: ${params.size} > ${this.config.maxFileSize}`,
        );
      }
    }

    // 检查危险命令
    if (toolName.includes("exec") || toolName.includes("run")) {
      const command = params.command || params.cmd;
      if (command && this.isBlockedCommand(command)) {
        throw new Error(`Blocked command: ${command}`);
      }
    }
  }

  /**
   * 沙箱参数处理
   */
  private sandboxParams(params: any): any {
    // 深度拷贝，防止原始参数被修改
    const sandboxed = JSON.parse(JSON.stringify(params));

    // 对路径进行规范化
    if (sandboxed.path) {
      sandboxed.path = this.normalizePath(sandboxed.path);
    }

    if (sandboxed.filePath) {
      sandboxed.filePath = this.normalizePath(sandboxed.filePath);
    }

    return sandboxed;
  }

  /**
   * 检查域名是否允许
   */
  private isDomainAllowed(url: string): boolean {
    try {
      const parsed = new URL(url);
      return this.config.allowedDomains.some(
        (domain) =>
          parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`),
      );
    } catch {
      return false;
    }
  }

  /**
   * 检查路径是否允许
   */
  private isPathAllowed(filePath: string): boolean {
    const normalizedPath = this.normalizePath(filePath);
    return this.config.allowedPaths.some((allowed) =>
      normalizedPath.startsWith(allowed),
    );
  }

  /**
   * 检查命令是否被阻止
   */
  private isBlockedCommand(command: string): boolean {
    const lowerCommand = command.toLowerCase();
    return this.config.blockedCommands.some((blocked) =>
      lowerCommand.includes(blocked),
    );
  }

  /**
   * 规范化路径
   */
  private normalizePath(filePath: string): string {
    // 移除相对路径
    const normalized = filePath.replace(/\.\.\//g, "");
    return normalized;
  }

  async onDestroy(): Promise<void> {
    console.log("Sandbox plugin destroyed");
  }
}
