// core/plugins/manager.ts

import { EventEmitter } from "events";
import { Plugin, PluginMetadata, PluginHooks, PluginConfig } from "./types";
import { Agent } from "../agent.js";
import {
  AgentConfig,
  AgentEvent,
  AgentMessage,
  ToolDefinition,
} from "../types";

/**
 * 插件管理器（增强版）
 * 管理插件的生命周期，提供钩子调用
 */
export class PluginManager extends EventEmitter {
  private plugins: Map<
    string,
    {
      instance: Plugin;
      config: PluginConfig;
      hooks: Set<keyof PluginHooks>;
      metadata: PluginMetadata;
    }
  > = new Map();

  private agent: Agent | null = null;
  private hookHandlers: Map<keyof PluginHooks, Set<Function>> = new Map();
  private initialized: boolean = false;

  constructor(agent?: Agent) {
    super();
    if (agent) {
      this.agent = agent;
    }
    this.initHookHandlers();
  }

  /**
   * 设置 Agent 引用
   */
  setAgent(agent: Agent): void {
    this.agent = agent;
  }

  /**
   * 初始化钩子处理器映射
   */
  private initHookHandlers(): void {
    const hooks: (keyof PluginHooks)[] = [
      "onInit",
      "onDestroy",
      "onBeforeLoop",
      "onAfterLoop",
      "onBeforeToolCall",
      "onAfterToolCall",
      "onBeforeMessage",
      "onAfterMessage",
      "onError",
      "onUserInput",
      "onModelResponse",
      "onAgentEvent",
      "onToolConfirmation",
    ];

    for (const hook of hooks) {
      this.hookHandlers.set(hook, new Set());
    }
  }

  /**
   * 注册插件
   */
  register(plugin: Plugin, config?: Partial<PluginConfig>): void {
    const pluginConfig: PluginConfig = {
      enabled: true,
      options: {},
      ...config,
    };

    const hooks = this.getPluginHooks(plugin);

    this.plugins.set(plugin.metadata.name, {
      instance: plugin,
      config: pluginConfig,
      hooks,
      metadata: plugin.metadata,
    });

    // 注册钩子处理器
    for (const hook of hooks) {
      const handler = (plugin[hook] as Function).bind(plugin);
      this.hookHandlers.get(hook)?.add(handler);
    }

    console.log(
      `[PluginManager] Plugin registered: ${plugin.metadata.name} v${plugin.metadata.version}`,
    );
    this.emit("plugin_registered", { name: plugin.metadata.name, plugin });
  }

  /**
   * 批量注册插件
   */
  registerAll(plugins: Plugin[]): void {
    for (const plugin of plugins) {
      this.register(plugin);
    }
  }

  /**
   * 初始化所有插件
   */
  async init(agentConfig: AgentConfig): Promise<void> {
    if (this.initialized) {
      console.log("[PluginManager] Already initialized");
      return;
    }

    console.log(`[PluginManager] Initializing ${this.plugins.size} plugins...`);

    for (const [name, { instance, config: pluginConfig }] of this.plugins) {
      if (!pluginConfig.enabled) {
        console.log(`[PluginManager] Plugin ${name} is disabled, skipping`);
        continue;
      }

      try {
        if (instance.onInit) {
          await instance.onInit(this.agent!, agentConfig);
        }
        console.log(`[PluginManager] Plugin initialized: ${name}`);
        this.emit("plugin_initialized", { name, plugin: instance });
      } catch (error) {
        console.error(
          `[PluginManager] Failed to initialize plugin ${name}:`,
          error,
        );
        this.emit("plugin_error", { name, error });
      }
    }

    this.initialized = true;
    console.log(`[PluginManager] All plugins initialized`);
  }

  /**
   * 获取插件
   */
  getPlugin(name: string): Plugin | undefined {
    return this.plugins.get(name)?.instance;
  }

  /**
   * 获取所有插件
   */
  getAllPlugins(): Plugin[] {
    return Array.from(this.plugins.values()).map((p) => p.instance);
  }

  /**
   * 获取插件元数据
   */
  getPluginMetadata(name: string): PluginMetadata | undefined {
    return this.plugins.get(name)?.metadata;
  }

  /**
   * 启用插件
   */
  enablePlugin(name: string): void {
    const plugin = this.plugins.get(name);
    if (plugin) {
      plugin.config.enabled = true;
      console.log(`[PluginManager] Plugin enabled: ${name}`);
      this.emit("plugin_enabled", { name });
    }
  }

  /**
   * 禁用插件
   */
  disablePlugin(name: string): void {
    const plugin = this.plugins.get(name);
    if (plugin) {
      plugin.config.enabled = false;
      console.log(`[PluginManager] Plugin disabled: ${name}`);
      this.emit("plugin_disabled", { name });
    }
  }

  /**
   * 调用钩子（无返回值）
   */
  async callHook<T extends keyof PluginHooks>(
    hook: T,
    ...args: Parameters<NonNullable<PluginHooks[T]>>
  ): Promise<void> {
    const handlers = this.hookHandlers.get(hook);
    if (!handlers || handlers.size === 0) return;

    for (const handler of handlers) {
      try {
        await (handler as any)(...args);
      } catch (error) {
        console.error(`[PluginManager] Error in hook ${hook}:`, error);
        this.emit("hook_error", { hook, error });
      }
    }
  }

  /**
   * 调用拦截钩子（有返回值，支持链式修改）
   */
  async callInterceptHook<
    T extends keyof Pick<
      PluginHooks,
      | "onBeforeToolCall"
      | "onBeforeMessage"
      | "onUserInput"
      | "onModelResponse"
      | "onToolConfirmation"
    >,
  >(hook: T, value: any, ...args: any[]): Promise<any> {
    const handlers = this.hookHandlers.get(hook);
    if (!handlers || handlers.size === 0) return value;

    let result = value;

    for (const handler of handlers) {
      try {
        result = await (handler as any)(result, ...args);
      } catch (error) {
        console.error(
          `[PluginManager] Error in intercept hook ${hook}:`,
          error,
        );
        this.emit("hook_error", { hook, error });
      }
    }

    return result;
  }

  /**
   * 获取插件的钩子列表
   */
  private getPluginHooks(plugin: Plugin): Set<keyof PluginHooks> {
    const hooks = new Set<keyof PluginHooks>();

    // 检查实例方法
    const prototype = Object.getPrototypeOf(plugin);
    const methods = Object.getOwnPropertyNames(prototype);

    for (const method of methods) {
      if (
        method.startsWith("on") &&
        typeof (plugin as any)[method] === "function"
      ) {
        hooks.add(method as keyof PluginHooks);
      }
    }

    // 也检查实例自身的方法
    const ownMethods = Object.getOwnPropertyNames(plugin);
    for (const method of ownMethods) {
      if (
        method.startsWith("on") &&
        typeof (plugin as any)[method] === "function"
      ) {
        hooks.add(method as keyof PluginHooks);
      }
    }

    return hooks;
  }

  /**
   * 获取插件统计
   */
  getStats(): {
    total: number;
    enabled: number;
    disabled: number;
    initialized: boolean;
    plugins: Array<{
      name: string;
      version: string;
      enabled: boolean;
      hooks: string[];
    }>;
  } {
    const plugins = Array.from(this.plugins.values()).map((p) => ({
      name: p.metadata.name,
      version: p.metadata.version,
      enabled: p.config.enabled,
      hooks: Array.from(p.hooks),
    }));

    return {
      total: this.plugins.size,
      enabled: plugins.filter((p) => p.enabled).length,
      disabled: plugins.filter((p) => !p.enabled).length,
      initialized: this.initialized,
      plugins,
    };
  }

  /**
   * 销毁所有插件
   */
  async destroy(): Promise<void> {
    console.log("[PluginManager] Destroying all plugins...");

    for (const [name, { instance, config }] of this.plugins) {
      if (!config.enabled) continue;

      try {
        if (instance.onDestroy) {
          await instance.onDestroy();
        }
        console.log(`[PluginManager] Plugin destroyed: ${name}`);
      } catch (error) {
        console.error(
          `[PluginManager] Failed to destroy plugin ${name}:`,
          error,
        );
      }
    }

    this.plugins.clear();
    this.hookHandlers.clear();
    this.initialized = false;

    console.log("[PluginManager] All plugins destroyed");
    this.emit("destroyed");
  }
}
