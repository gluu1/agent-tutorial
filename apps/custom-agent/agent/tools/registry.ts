// core/tools/registry.ts

import { EventEmitter } from "events";
import {
  ToolDefinition,
  ToolCall,
  ExecutionContext,
  ToolConfig,
} from "../types";

/**
 * 工具执行器
 */
export class ToolExecutor {
  private registry: Map<string, ToolDefinition> = new Map();
  private config: ToolConfig;
  private confirmationHandler?: (
    tool: ToolDefinition,
    params: any,
  ) => Promise<boolean>;

  constructor(config: ToolConfig) {
    this.config = config;
  }

  /**
   * 注册工具
   */
  register(tool: ToolDefinition): void {
    if (this.config.blockedTools.includes(tool.name)) {
      console.warn(`Tool ${tool.name} is blocked`);
      return;
    }

    this.registry.set(tool.name, tool);
  }

  /**
   * 批量注册
   */
  registerAll(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * 获取工具定义
   */
  getDefinitions(): any[] {
    return Array.from(this.registry.values()).map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  /**
   * 执行工具调用
   */
  async execute(toolCall: ToolCall, context: ExecutionContext): Promise<any> {
    const tool = this.registry.get(toolCall.function.name);
    if (!tool) {
      throw new Error(`Tool not found: ${toolCall.function.name}`);
    }

    // 解析参数
    let params: any;
    try {
      params = JSON.parse(toolCall.function.arguments);
    } catch (error) {
      throw new Error(`Invalid tool arguments: ${error}`);
    }

    // 检查是否需要确认
    const needsConfirmation = this.needsConfirmation(tool);
    if (needsConfirmation && this.confirmationHandler) {
      const confirmed = await this.confirmationHandler(tool, params);
      if (!confirmed) {
        throw new Error(`Tool execution cancelled: ${tool.name}`);
      }
    }

    // 执行工具
    const timeout = tool.metadata?.timeout || this.config.toolTimeoutMs;

    return this.withTimeout(tool.execute(params, context), timeout);
  }

  /**
   * 判断是否需要确认
   */
  private needsConfirmation(tool: ToolDefinition): boolean {
    if (this.config.requireConfirmation === "always") {
      return true;
    }

    if (this.config.requireConfirmation === "dangerous") {
      return tool.metadata?.dangerous === true;
    }

    return false;
  }

  /**
   * 设置确认处理器
   */
  setConfirmationHandler(
    handler: (tool: ToolDefinition, params: any) => Promise<boolean>,
  ): void {
    this.confirmationHandler = handler;
  }

  /**
   * 带超时执行
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        setTimeout(
          () => reject(new Error(`Tool timeout after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  }

  /**
   * 获取工具列表
   */
  listTools(): string[] {
    return Array.from(this.registry.keys());
  }

  /**
   * 获取工具
   */
  getTool(name: string): ToolDefinition | undefined {
    return this.registry.get(name);
  }
}

/**
 * 工具加载器
 */
export class ToolLoader {
  private config: ToolConfig;

  constructor(config: ToolConfig) {
    this.config = config;
  }

  /**
   * 从工作区加载工具
   */
  async loadFromWorkspace(workspaceDir: string): Promise<ToolDefinition[]> {
    if (!this.config.autoLoadWorkspaceTools) {
      return [];
    }

    const tools: ToolDefinition[] = [];

    for (const toolPath of this.config.toolPaths) {
      const fullPath = `${workspaceDir}/${toolPath}`;
      try {
        const modules = await this.loadModules(fullPath);
        tools.push(...modules);
      } catch (error) {
        console.warn(`Failed to load tools from ${fullPath}:`, error);
      }
    }

    return tools;
  }

  /**
   * 加载内置工具
   */
  loadBuiltinTools(): ToolDefinition[] {
    return [
      this.createEchoTool(),
      this.createDelayTool(),
      this.createErrorTool(),
      this.createKnowledgeTool(),
    ];
  }

  private createKnowledgeTool(): ToolDefinition {
    return {
      name: "retrieveKnowledge",
      description: "检索知识库中与问题相关的文档片段，用于回答关于项目文档、技术细节等问题",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "搜索query，用中文描述你要查找的内容",
          },
          topK: {
            type: "number",
            description: "返回数量",
            default: 5,
          },
        },
        required: ["query"],
      },
      execute: async () => {
        return { error: "KnowledgeBase not initialized" };
      },
    };
  }

  private createEchoTool(): ToolDefinition {
    return {
      name: "echo",
      description: "回显输入的消息",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "要回显的消息" },
        },
        required: ["message"],
      },
      execute: async (params) => ({ echoed: params.message }),
    };
  }

  private createDelayTool(): ToolDefinition {
    return {
      name: "delay",
      description: "延迟指定时间",
      parameters: {
        type: "object",
        properties: {
          ms: { type: "number", description: "延迟毫秒数" },
        },
        required: ["ms"],
      },
      execute: async (params) => {
        await new Promise((resolve) => setTimeout(resolve, params.ms));
        return { delayed: params.ms };
      },
    };
  }

  private createErrorTool(): ToolDefinition {
    return {
      name: "error",
      description: "抛出错误（测试用）",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "错误消息" },
        },
      },
      execute: async (params) => {
        throw new Error(params.message || "Test error");
      },
    };
  }

  private async loadModules(path: string): Promise<any[]> {
    // 简化实现
    return [];
  }
}
