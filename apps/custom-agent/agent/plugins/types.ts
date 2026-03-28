// core/plugins/types.ts

import { Agent } from "../agent.js";
import { AgentLoop } from "../agent-loop.js";
import {
  AgentConfig,
  AgentResult,
  AgentMessage,
  ToolCall,
  ToolDefinition,
} from "../types";

/**
 * Plugin 生命周期钩子
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
   * 工具调用前
   */
  onBeforeToolCall?(toolName: string, params: any): Promise<any>;

  /**
   * 工具调用后
   */
  onAfterToolCall?(toolName: string, result: any): Promise<void>;

  /**
   * 消息处理前
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
   * 用户输入预处理
   */
  onUserInput?(input: string): Promise<string>;

  /**
   * 模型响应后处理
   */
  onModelResponse?(response: any): Promise<any>;
}

/**
 * Plugin 配置
 */
export interface PluginConfig {
  enabled: boolean;
  options?: Record<string, any>;
}

/**
 * Plugin 元数据
 */
export interface PluginMetadata {
  name: string;
  version: string;
  description: string;
  author: string;
  license?: string;
  dependencies?: string[];
  permissions?: string[];
}

/**
 * 插件接口
 */
export interface Plugin {
  name: string;
  version: string;
  description?: string;

  onInit?(agent: Agent, config: AgentConfig): Promise<void>;
  onBeforeLoop?(loop: AgentLoop, input: string): Promise<void>;
  onAfterLoop?(loop: AgentLoop, result: AgentResult): Promise<void>;
  onBeforeToolCall?(toolName: string, params: any): Promise<any>;
  onAfterToolCall?(toolName: string, result: any): Promise<void>;
  onMessage?(message: AgentMessage): Promise<AgentMessage>;
  onError?(error: Error): Promise<void>;
  onDestroy?(): Promise<void>;
}
