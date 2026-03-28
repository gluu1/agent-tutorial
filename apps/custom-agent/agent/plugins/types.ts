// core/plugins/types.ts

import { Agent } from "../agent";
import { AgentLoop } from "../agent-loop";
import {
  AgentConfig,
  AgentResult,
  AgentMessage,
  AgentEvent,
  ToolDefinition,
} from "../types";

/**
 * 插件生命周期钩子（完整版）
 */
export interface PluginHooks {
  /**
   * 插件初始化
   */
  onInit?(agent: Agent, config: AgentConfig): Promise<void>;

  /**
   * 插件销毁
   */
  onDestroy?(): Promise<void>;

  /**
   * Agent 循环开始前
   */
  onBeforeLoop?(loop: AgentLoop, input: string): Promise<void>;

  /**
   * Agent 循环结束后
   */
  onAfterLoop?(loop: AgentLoop, result: AgentResult): Promise<void>;

  /**
   * 工具调用前（可修改参数）
   */
  onBeforeToolCall?(
    params: any,
    toolName: string,
    originalParams: string,
  ): Promise<any>;

  /**
   * 工具调用后
   */
  onAfterToolCall?(toolName: string, result: any): Promise<void>;

  /**
   * 消息处理前（可修改消息）
   */
  onBeforeMessage?(message: AgentMessage): Promise<AgentMessage>;

  /**
   * 消息处理后
   */
  onAfterMessage?(message: AgentMessage): Promise<AgentMessage>;

  /**
   * 错误处理
   */
  onError?(error: Error): Promise<void>;

  /**
   * 用户输入预处理（可修改输入）
   */
  onUserInput?(input: string): Promise<string>;

  /**
   * 模型响应后处理（可修改响应）
   */
  onModelResponse?(response: any): Promise<any>;

  /**
   * Agent 事件
   */
  onAgentEvent?(event: AgentEvent): Promise<void>;

  /**
   * 工具确认请求（返回 true 表示确认执行）
   */
  onToolConfirmation?(
    confirmed: boolean,
    tool: ToolDefinition,
    params: any,
  ): Promise<boolean>;
}

/**
 * 插件配置
 */
export interface PluginConfig {
  enabled: boolean;
  options?: Record<string, any>;
}

/**
 * 插件元数据
 */
export interface PluginMetadata {
  name: string;
  version: string;
  description: string;
  author: string;
  license?: string;
  dependencies?: string[];
  permissions?: string[];
  requires?: string[]; // 依赖的其他插件
}

/**
 * 插件基础类（可选，提供空实现）
 */
export abstract class BasePlugin implements Plugin {
  abstract metadata: PluginMetadata;

  async onInit(agent: Agent, config: AgentConfig): Promise<void> {}
  async onDestroy(): Promise<void> {}
  async onBeforeLoop(loop: AgentLoop, input: string): Promise<void> {}
  async onAfterLoop(loop: AgentLoop, result: AgentResult): Promise<void> {}
  async onBeforeToolCall(
    params: any,
    toolName: string,
    originalParams: string,
  ): Promise<any> {
    return params;
  }
  async onAfterToolCall(toolName: string, result: any): Promise<void> {}
  async onBeforeMessage(message: AgentMessage): Promise<AgentMessage> {
    return message;
  }
  async onAfterMessage(message: AgentMessage): Promise<AgentMessage> {
    return message;
  }
  async onError(error: Error): Promise<void> {}
  async onUserInput(input: string): Promise<string> {
    return input;
  }
  async onModelResponse(response: any): Promise<any> {
    return response;
  }
  async onAgentEvent(event: AgentEvent): Promise<void> {}
  async onToolConfirmation(
    confirmed: boolean,
    tool: ToolDefinition,
    params: any,
  ): Promise<boolean> {
    return confirmed;
  }
}

/**
 * 插件接口
 */
export interface Plugin extends PluginHooks {
  metadata: PluginMetadata;
}
