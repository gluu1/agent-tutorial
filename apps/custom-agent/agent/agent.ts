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
 * 采用事件驱动架构，便于监控和扩展
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
      this.pluginManager,
    );
  }

  /**
   * 初始化 Agent
   * 按顺序初始化各组件，确保依赖关系正确
   */
  async init(): Promise<void> {
    console.log(`Initializing Agent: ${this.config.sessionId}`);

    // 工作区文件需要在其他组件之前加载，因为可能被引用
    await this.loadWorkspaceFiles();
    await this.skillsManager.init();
    await this.registerTools();
    await this.initPlugins();

    // 插件系统需要最后初始化，确保其他组件都就绪
    await this.pluginManager.init(this.config);

    // 配置回调函数
    this.memory.setSummarizeFn(this.generateSummary.bind(this));
    this.toolExecutor.setConfirmationHandler(this.handleToolConfirmation.bind(this));

    // 事件转发到 Agent 级别，供外部监控
    this.agentLoop.on("event", (event: AgentEvent) => {
      this.emit("agent_event", event);
    });

    console.log(`Agent initialized: ${this.config.sessionId}`);
  }

  /**
   * 运行 Agent
   * 支持并发调用的锁机制，防止状态混乱
   */
  async invoke(input: string): Promise<AgentResult> {
    if (this.isRunning) {
      throw new Error("Agent is already running");
    }

    this.isRunning = true;
    this.emit("start", { input, sessionId: this.config.sessionId });

    const processedInput = await this.pluginManager.callInterceptHook(
      "onUserInput",
      input,
    );

    try {
      await this.pluginManager.callHook("onBeforeLoop", this.agentLoop, processedInput);

      const result = await this.agentLoop.run(processedInput);

      await this.pluginManager.callHook("onAfterLoop", this.agentLoop, result);

      // 成功的回答存入长期记忆，用于后续检索
      if (result.success && result.answer) {
        await this.memory.longTerm.store(result.answer, this.config.sessionId, 0.8);
      }

      this.emit("complete", result);
      return result;
    } catch (error) {
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
  registerPlugin(plugin: Plugin, config?: Record<string, unknown>): void {
    this.pluginManager.register(plugin, config);
    console.log(
      `Plugin registered: ${plugin.metadata.name} v${plugin.metadata.version}`,
    );
  }

  /**
   * 批量注册插件
   */
  registerPlugins(plugins: Plugin[]): void {
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
    memoryStats: {
      shortTerm: number;
      sessionSummary: number;
      longTerm: string;
    };
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
   * 这些文件定义 Agent 的行为规则和记忆
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
      } catch {
        // 文件不存在是正常的，跳过即可
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

    // 4. 自动加载内置工具（newsTools 等）
    await this.loadBuiltinAgentTools();

    console.log(`Registered ${this.toolExecutor.listTools().length} tools`);
  }

  /**
   * 加载内置 Agent 工具
   * 使用动态导入，按需加载不影响主流程
   */
  private async loadBuiltinAgentTools(): Promise<void> {
    try {
      const newsTools = await import("./tools/newsTools");
      if (newsTools.loadNewsTools) {
        const tools = newsTools.loadNewsTools();
        this.toolExecutor.registerAll(tools);
        console.log(`Loaded ${tools.length} builtin agent tools`);
      }
    } catch (error) {
      console.warn("Failed to load builtin agent tools:", error);
    }
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
   * 默认拒绝危险操作，需要外部设置确认处理器
   */
  private async handleToolConfirmation(
    tool: ToolDefinition,
    params: Record<string, unknown>,
  ): Promise<boolean> {
    this.emit("tool_confirmation", { tool, params });
    return false;
  }

  /**
   * 合并配置
   * 提供合理的默认值，便于用户仅配置需要的部分
   */
  private mergeConfig(config: AgentConfig): AgentConfig {
    return {
      ...config,
      memoryConfig: { ...this.getDefaultMemoryConfig(), ...config.memoryConfig },
      contextConfig: { ...this.getDefaultContextConfig(), ...config.contextConfig },
      toolConfig: { ...this.getDefaultToolConfig(), ...config.toolConfig },
      loopConfig: { ...this.getDefaultLoopConfig(), ...config.loopConfig },
      skillsConfig: { ...this.getDefaultSkillsConfig(), ...config.skillsConfig },
    };
  }

  private getDefaultMemoryConfig(): NonNullable<AgentConfig["memoryConfig"]> {
    return {
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
  }

  private getDefaultContextConfig(): NonNullable<AgentConfig["contextConfig"]> {
    return {
      maxContextTokens: 64000,
      reservedOutputTokens: 4096,
      assemblyStrategy: "prioritized" as const,
      priorities: {
        systemPrompt: 100,
        rules: 95,
        skills: 90,
        userInput: 80,
        workspaceFiles: 50,
        sessionSummary: 40,
        longTermMemories: 30,
        recentHistory: 20,
        toolResults: 10,
      },
    };
  }

  private getDefaultToolConfig(): NonNullable<AgentConfig["toolConfig"]> {
    return {
      autoLoadWorkspaceTools: true,
      toolPaths: ["./skills", "./tools"],
      toolTimeoutMs: 30000,
      sandboxLevel: "basic" as const,
      parallelExecution: true,
      maxParallelTools: 3,
      dangerousTools: ["delete", "exec", "rm"],
      blockedTools: [],
    };
  }

  private getDefaultLoopConfig(): NonNullable<AgentConfig["loopConfig"]> {
    return {
      maxIterations: 15,
      maxToolCallsPerIteration: 5,
      timeoutMs: 120000,
      onToolError: "continue" as const,
      toolRetryCount: 2,
      requireConfirmation: "dangerous" as const,
      streamOutput: true,
    };
  }

  private getDefaultSkillsConfig(): NonNullable<AgentConfig["skillsConfig"]> {
    return {
      enabled: true,
      skillsPath: process.cwd() || "./skills",
      autoLoad: true,
      watchChanges: false,
      allowedSkills: [],
      blockedSkills: [],
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
