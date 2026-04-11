// core/agent.ts - Agent 主入口

import * as fs from "fs";
import * as path from "path";
import { EventEmitter } from "events";
import {
  AgentConfig,
  AgentResult,
  AgentEvent,
  ToolDefinition,
  ExecutionContext,
  AgentMessage,
  MemoryConfig,
  ContextConfig,
  ToolConfig,
  LoopConfig,
} from "./types";
import { ThreeTierMemoryManager } from "./memory/threeTierMemory";
import { SkillsManager } from "./skills/manager";
import { ContextAssembler } from "./context/optimizer";
import { ToolExecutor, ToolLoader } from "./tools/registry";
import { AgentLoop } from "./agent-loop";
import { PluginManager } from "./plugins/manager";
import { Plugin } from "./plugins/types";

/**
 * Agent 主类
 * 负责组装所有组件，管理生命周期，支持插件系统
 */

export class Agent extends EventEmitter {
  private config: AgentConfig;
  private memory: ThreeTierMemoryManager;
  private skillsManager: SkillsManager;
  private toolExecutor: ToolExecutor;
  private contextAssembler: ContextAssembler;
  private agentLoop: AgentLoop;
  private plugins: Map<string, Plugin> = new Map();
  private pluginManager: PluginManager;
  private workspaceFiles: Map<string, string> = new Map();
  private isRunning: boolean = false;

  constructor(config: AgentConfig) {
    super();
    this.config = this.mergeConfig(config);

    // 初始化插件管理器
    this.pluginManager = new PluginManager(this);

    // 初始化三层记忆
    this.memory = new ThreeTierMemoryManager(
      this.config.sessionId,
      this.config.memoryConfig as MemoryConfig,
    );

    // 初始化 Skills 管理器
    this.skillsManager = new SkillsManager(this.config.skillsConfig!);

    // 初始化工具执行器
    this.toolExecutor = new ToolExecutor(this.config.toolConfig as ToolConfig);

    // 初始化上下文组件
    this.contextAssembler = new ContextAssembler(
      this.config.contextConfig as ContextConfig,
      this.memory,
    );

    // 初始化 Agent 循环
    this.agentLoop = new AgentLoop(
      this.config,
      this.memory,
      this.toolExecutor,
      this.contextAssembler,
    );
  }

  /**
   * 初始化 Agent
   */
  async init(): Promise<void> {
    console.log(`Initializing Agent: ${this.config.sessionId}`);

    // 1. 加载工作区文件
    await this.loadWorkspaceFiles();

    // 2. 初始化 Skills
    await this.skillsManager.init();

    // 3. 注册工具
    await this.registerTools();

    // 4. 初始化插件
    await this.initPlugins();
    // 4. 初始化插件管理器（这会触发所有插件的 onInit）
    await this.pluginManager.init(this.config);

    // 5. 设置记忆的摘要函数
    this.memory.setSummarizeFn(async (messages) => {
      return this.generateSummary(messages);
    });

    // 6. 设置工具确认处理器
    this.toolExecutor.setConfirmationHandler(async (tool, params) => {
      return this.handleToolConfirmation(tool, params);
    });

    // 7. 设置循环事件转发
    this.agentLoop.on("event", (event: AgentEvent) => {
      this.emit("agent_event", event);
    });

    console.log(`Agent initialized: ${this.config.sessionId}`);
  }

  /**
   * 运行 Agent
   */
  async invoke(input: string): Promise<AgentResult> {
    if (this.isRunning) {
      throw new Error("Agent is already running");
    }

    this.isRunning = true;
    this.emit("start", { input, sessionId: this.config.sessionId });

    // 插件：用户输入预处理
    const processedInput = await this.pluginManager.callInterceptHook(
      "onUserInput",
      input,
    );

    try {
      // 插件：循环开始前
      await this.pluginManager.callHook(
        "onBeforeLoop",
        this.agentLoop,
        processedInput,
      );

      // 执行循环
      const result = await this.agentLoop.run(input);

      // 插件：循环结束后
      await this.pluginManager.callHook("onAfterLoop", this.agentLoop, result);

      // 存储到长期记忆（重要结果）
      if (result.success && result.answer) {
        await this.memory.longTerm.store(
          result.answer,
          this.config.sessionId,
          0.8,
        );
      }

      this.emit("complete", result);
      return result;
    } catch (error) {
      // 插件：错误处理
      await this.pluginManager.callHook("onError", error);
      this.emit("error", error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 停止 Agent
   */
  async stop(): Promise<void> {
    if (this.agentLoop) {
      await this.agentLoop.stop();
    }
    this.isRunning = false;
    this.emit("stopped");
  }

  /**
   * 注册插件
   */
  registerPlugin(plugin: Plugin, config?: any): void {
    this.pluginManager.register(plugin, config);
    console.log(
      `Plugin registered: ${plugin.metadata.name} v${plugin.metadata.version}`,
    );
  }

  /**
   * 批量注册插件
   */
  registerPlugins(plugins: [Plugin], config?: any): void {
    this.pluginManager.registerAll(plugins);
  }
  /**
   * 获取插件
   */
  getPlugin(name: string): Plugin | undefined {
    return this.pluginManager.getPlugin(name);
  }

  /**
   * 获取所有插件
   */
  getAllPlugins(): Plugin[] {
    return this.pluginManager.getAllPlugins();
  }

  /**
   * 启用插件
   */
  enablePlugin(name: string): void {
    this.pluginManager.enablePlugin(name);
  }

  /**
   * 禁用插件
   */
  disablePlugin(name: string): void {
    this.pluginManager.disablePlugin(name);
  }

  /**
   * 获取配置
   */
  getConfig(): AgentConfig {
    return this.config;
  }

  /**
   * 获取记忆管理器
   */
  getMemory(): ThreeTierMemoryManager {
    return this.memory;
  }

  /**
   * 获取工具执行器
   */
  getToolExecutor(): ToolExecutor {
    return this.toolExecutor;
  }

  /**
   * 获取状态
   */
  getStatus(): {
    sessionId: string;
    isRunning: boolean;
    memoryStats: any;
    toolCount: number;
    skillCount: number;
  } {
    return {
      sessionId: this.config.sessionId,
      isRunning: this.isRunning,
      memoryStats: {
        shortTerm: this.memory.shortTerm.getCount(),
        sessionSummary: this.memory.getSessionSummary().length,
        longTerm: this.memory.longTerm ? "enabled" : "disabled",
      },
      toolCount: this.toolExecutor.listTools().length,
      skillCount: this.skillsManager.getAllSkills().length,
    };
  }

  /**
   * 加载工作区文件
   */
  private async loadWorkspaceFiles(): Promise<void> {
    if (!this.config.workspaceDir) return;

    const files = ["AGENTS.md", "SOUL.md", "MEMORY.md", "RULES.md"];

    for (const file of files) {
      const filePath = path.join(this.config.workspaceDir!, file);
      try {
        const content = await fs.promises.readFile(filePath, "utf-8");
        this.workspaceFiles.set(file, content);
        console.log(`Loaded workspace file: ${file}`);
      } catch (error) {
        // 文件不存在，跳过
      }
    }
  }

  /**
   * 注册工具
   */
  private async registerTools(): Promise<void> {
    // 1. 加载内置工具
    const toolLoader = new ToolLoader(this.config.toolConfig as ToolConfig);
    const builtinTools = toolLoader.loadBuiltinTools();
    this.toolExecutor.registerAll(builtinTools);

    // 2. 从 Skills 加载工具
    const skillTools = this.skillsManager.getTools();
    this.toolExecutor.registerAll(skillTools);

    // 3. 从工作区加载工具
    if (this.config.workspaceDir) {
      const workspaceTools = await toolLoader.loadFromWorkspace(
        this.config.workspaceDir,
      );
      this.toolExecutor.registerAll(workspaceTools);
    }

    console.log(`Registered ${this.toolExecutor.listTools().length} tools`);
  }

  /**
   * 初始化插件
   */
  private async initPlugins(): Promise<void> {
    for (const [name, plugin] of this.plugins) {
      if (plugin.onInit) {
        await plugin.onInit(this, this.config);
        console.log(`Plugin initialized: ${name}`);
      }
    }
  }

  /**
   * 生成摘要
   */
  private async generateSummary(messages: AgentMessage[]): Promise<string> {
    // 简化实现，实际可以调用 LLM 生成摘要
    const keyPoints = messages
      .filter((m) => m.role === "assistant" && m.content.length > 50)
      .slice(-3)
      .map((m) => m.content.substring(0, 100));

    return `对话摘要: ${messages.length} 条消息\n关键内容:\n${keyPoints.map((p) => `- ${p}...`).join("\n")}`;
  }

  /**
   * 处理工具确认
   */
  private async handleToolConfirmation(
    tool: ToolDefinition,
    params: any,
  ): Promise<boolean> {
    this.emit("tool_confirmation", { tool, params });
    // 默认拒绝，需要外部设置确认处理器
    return false;
  }

  /**
   * 合并配置
   */
  private mergeConfig(config: AgentConfig): AgentConfig {
    const defaultMemoryConfig = {
      shortTerm: {
        maxMessages: 50,
        maxTokens: 8000,
        compressionThreshold: 0.8,
        compressionStrategy: "hybrid" as const,
      },
      longTerm: {
        enabled: true,
        retrievalTopK: 5,
        similarityThreshold: 0.7,
        decayFactor: 0.95,
        importanceThreshold: 0.3,
      },
      session: {
        enabled: true,
        summaryInterval: 20,
        maxSummaryTokens: 500,
        extractKeyPoints: true,
        autoSummarize: true,
      },
    };

    const defaultContextConfig = {
      maxContextTokens: 64000,
      reservedOutputTokens: 4096,
      assemblyStrategy: "prioritized" as const,
      priorities: {
        systemPrompt: 100,      // 最高优先级 - 永不压缩
        skills: 90,             // 高优先级 - 永不压缩
        userInput: 80,         // 用户输入 - 永不压缩
        workspaceFiles: 50,    // 可压缩
        sessionSummary: 40,    // 可压缩
        longTermMemories: 30,   // 可压缩
        recentHistory: 20,      // 可压缩
        toolResults: 10,        // 可压缩
      },
    };

    const defaultToolConfig = {
      autoLoadWorkspaceTools: true,
      toolPaths: ["./skills", "./tools"],
      toolTimeoutMs: 30000,
      sandboxLevel: "basic" as const,
      parallelExecution: true,
      maxParallelTools: 3,
      dangerousTools: ["delete", "exec", "rm"],
      blockedTools: [],
    };

    const defaultLoopConfig = {
      maxIterations: 15,
      maxToolCallsPerIteration: 5,
      timeoutMs: 120000,
      onToolError: "continue" as const,
      toolRetryCount: 2,
      requireConfirmation: "dangerous" as const,
      streamOutput: true,
    };

    const defaultSkillsConfig = {
      enabled: true,
      skillsPath: process.cwd() || "./skills",
      autoLoad: true,
      watchChanges: false,
      allowedSkills: [],
      blockedSkills: [],
    };

    return {
      ...config,
      memoryConfig: { ...defaultMemoryConfig, ...config.memoryConfig },
      contextConfig: { ...defaultContextConfig, ...config.contextConfig },
      toolConfig: { ...defaultToolConfig, ...config.toolConfig },
      loopConfig: { ...defaultLoopConfig, ...config.loopConfig },
      skillsConfig: { ...defaultSkillsConfig, ...config.skillsConfig },
    };
  }

  /**
   * 销毁 Agent
   */
  async destroy(): Promise<void> {
    await this.stop();

    // 调用插件销毁钩子
    for (const plugin of this.plugins.values()) {
      if (plugin.onDestroy) {
        await plugin.onDestroy();
      }
    }

    this.skillsManager.shutdown();
    this.removeAllListeners();
    console.log(`Agent destroyed: ${this.config.sessionId}`);
  }
}
