// core/plugins/manager.ts

import { EventEmitter } from "events";
import { Plugin, PluginMetadata, PluginHooks, PluginConfig } from "./types.js";
import { Agent } from "../agent.js";
import { AgentConfig } from "../types.js";

/**
 * 插件管理器
 */
export class PluginManager extends EventEmitter {
  private plugins: Map<
    string,
    { instance: Plugin; config: PluginConfig; hooks: Set<keyof PluginHooks> }
  > = new Map();
  private agent: Agent | null = null;
  private hookHandlers: Map<keyof PluginHooks, Set<Function>> = new Map();

  constructor() {
    super();
    this.initHookHandlers();
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
    });

    // 注册钩子处理器
    for (const hook of hooks) {
      const handler = (plugin[hook] as Function).bind(plugin);
      this.hookHandlers.get(hook)?.add(handler);
    }

    console.log(
      `Plugin registered: ${plugin.metadata.name} v${plugin.metadata.version}`,
    );
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
  async init(agent: Agent, config: AgentConfig): Promise<void> {
    this.agent = agent;

    for (const [name, { instance, config: pluginConfig }] of this.plugins) {
      if (!pluginConfig.enabled) continue;

      try {
        if (instance.onInit) {
          await instance.onInit(agent, config);
        }
        console.log(`Plugin initialized: ${name}`);
      } catch (error) {
        console.error(`Failed to initialize plugin ${name}:`, error);
        this.emit("plugin_error", { name, error });
      }
    }
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
   * 启用插件
   */
  enablePlugin(name: string): void {
    const plugin = this.plugins.get(name);
    if (plugin) {
      plugin.config.enabled = true;
      console.log(`Plugin enabled: ${name}`);
    }
  }

  /**
   * 禁用插件
   */
  disablePlugin(name: string): void {
    const plugin = this.plugins.get(name);
    if (plugin) {
      plugin.config.enabled = false;
      console.log(`Plugin disabled: ${name}`);
    }
  }

  /**
   * 调用钩子
   */
  async callHook<T extends keyof PluginHooks>(
    hook: T,
    ...args: Parameters<NonNullable<PluginHooks[T]>>
  ): Promise<void> {
    const handlers = this.hookHandlers.get(hook);
    if (!handlers) return;

    for (const handler of handlers) {
      try {
        await (handler as any)(...args);
      } catch (error) {
        console.error(`Error in hook ${hook}:`, error);
        this.emit("hook_error", { hook, error });
      }
    }
  }

  /**
   * 调用带有返回值的钩子（用于拦截器）
   */
  async callInterceptHook<
    T extends
      | "onBeforeToolCall"
      | "onBeforeMessage"
      | "onUserInput"
      | "onModelResponse",
  >(hook: T, value: any, ...args: any[]): Promise<any> {
    const handlers = this.hookHandlers.get(hook);
    if (!handlers) return value;

    let result = value;

    for (const handler of handlers) {
      try {
        result = await (handler as any)(result, ...args);
      } catch (error) {
        console.error(`Error in intercept hook ${hook}:`, error);
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
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(plugin));

    for (const method of methods) {
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
   * 销毁所有插件
   */
  async destroy(): Promise<void> {
    for (const [name, { instance, config }] of this.plugins) {
      if (!config.enabled) continue;

      try {
        if (instance.onDestroy) {
          await instance.onDestroy();
        }
      } catch (error) {
        console.error(`Failed to destroy plugin ${name}:`, error);
      }
    }

    this.plugins.clear();
    this.hookHandlers.clear();
    console.log("All plugins destroyed");
  }
}
