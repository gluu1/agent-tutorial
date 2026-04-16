// core/types.ts

/**
 * Agent 配置
 */
export interface AgentConfig {
  sessionId: string;
  userId: string;
  modelConfig: ModelConfig;
  memoryConfig?: Partial<MemoryConfig>;
  contextConfig?: Partial<ContextConfig>;
  toolConfig?: Partial<ToolConfig>;
  loopConfig?: Partial<LoopConfig>;
  skillsConfig?: SkillsConfig;
  workspaceDir?: string;
  systemPrompt?: string;
  rules?: string;
  knowledgeBaseConfig?: Partial<KnowledgeBaseConfig>;
}

/**
 * 模型配置
 */
export interface ModelConfig {
  // ========== 核心参数 ==========

  provider: "openai" | "anthropic" | "deepseek" | "minimax" | "custom";
  model: string;
  apiKey: string;
  baseURL?: string;

  /**
   * 温度 - 控制随机性
   * - 0: 确定性输出，适合事实性任务
   * - 0.7: 平衡，适合对话
   * - 1.0+: 高创造性，适合创意任务
   * @default 0.7
   * @range 0-2 (OpenAI), 0-1 (Anthropic)
   */
  temperature?: number;

  /**
   * 最大输出 Token 数
   * 控制模型生成的最大长度
   * @default 4096
   */
  maxTokens?: number;

  /**
   * Top-P - 核采样
   * 从累积概率达到 p 的最小 token 集合中采样
   * @default 1.0
   * @range 0-1
   */
  topP?: number;

  // ========== 高级采样参数 ==========

  /**
   * Frequency Penalty - 频率惩罚
   * 降低重复 token 的概率
   * @default 0
   * @range -2.0 - 2.0
   */
  frequencyPenalty?: number;

  /**
   * Presence Penalty - 存在惩罚
   * 鼓励引入新话题
   * @default 0
   * @range -2.0 - 2.0
   */
  presencePenalty?: number;

  /**
   * Top-K - 仅从 top K 个 token 中采样
   * DeepSeek/Claude 特有参数
   * @example 40
   */
  topK?: number;

  /**
   * Stop Sequences - 停止序列
   * 遇到这些字符串时停止生成
   * @example ["\n", "Human:", "Observation:"]
   */
  stop?: string[];

  // ========== 结构化输出 ==========

  /**
   * 响应格式
   * - text: 纯文本
   * - json_object: 强制 JSON 输出
   */
  responseFormat?: {
    type: "text" | "json_object";
  };

  /**
   * JSON Schema - 结构化输出
   * OpenAI 特有，用于强制输出符合 schema 的 JSON
   */
  jsonSchema?: JSONSchema;

  // ========== 工具调用 ==========

  /**
   * 工具选择策略
   * - auto: 模型自主决定是否调用工具
   * - none: 不调用任何工具
   * - required: 必须调用工具
   * - { type: "function", function: { name: "xxx" } }: 强制调用指定工具
   */
  toolChoice?:
    | "auto"
    | "none"
    | "required"
    | {
        type: "function";
        function: { name: string };
      };

  // ========== 思考过程 (Reasoning) ==========

  /**
   * 思考预算 - DeepSeek R1 系列特有
   * 控制模型在推理模式下的思考 Token 数
   * @range 0 - 32768
   */
  reasoningEffort?: number;

  /**
   * 是否输出思考过程
   * DeepSeek R1 返回 reasoning_content 字段
   */
  includeReasoning?: boolean;
}

/**
 * 三层记忆配置
 */
export interface MemoryConfig {
  shortTerm: ShortTermMemoryConfig;
  longTerm: LongTermMemoryConfig;
  session: SessionMemoryConfig;
}

export interface ShortTermMemoryConfig {
  maxMessages: number;
  maxTokens: number;
  compressionThreshold: number;
  compressionStrategy: "slidingWindow" | "summarize" | "hybrid";
}

export interface LongTermMemoryConfig {
  enabled: boolean;
  retrievalTopK: number;
  similarityThreshold: number;
  decayFactor: number;
  importanceThreshold: number;
  storagePath?: string;
}

export interface SessionMemoryConfig {
  enabled: boolean;
  summaryInterval: number;
  maxSummaryTokens: number;
  extractKeyPoints: boolean;
  autoSummarize: boolean;
}

/**
 * 知识库配置
 */
export interface KnowledgeBaseConfig {
  enabled: boolean;
  docsPath: string; // 文档目录，如 "docs/"
  dbPath: string; // SQLite 路径，如 "data/knowledge.db"
  embeddingApiKey?: string; // 嵌入 API Key，不填则用 modelConfig 的
  embeddingBaseURL?: string;
  autoIndex?: boolean; // 默认 true，首次启动时全量索引
  chunkTokenLimit: number; // 默认 800
  retrievalTopK: number; // 默认 5
  minScore: number; // 默认 0.6
}

/**
 * 上下文配置
 */
export interface ContextConfig {
  maxContextTokens: number;
  reservedOutputTokens: number;
  assemblyStrategy: "prioritized" | "recentFirst" | "semantic";
  priorities: {
    systemPrompt: number;
    sessionSummary: number;
    skills: number;
    workspaceFiles: number;
    recentHistory: number;
    longTermMemories: number;
    toolResults: number;
    userInput?: number;
    rules?: number;
  };
}

/**
 * 工具配置
 */
export interface ToolConfig {
  autoLoadWorkspaceTools: boolean;
  toolPaths: string[];
  toolTimeoutMs: number;
  sandboxLevel: "none" | "basic" | "strict";
  parallelExecution: boolean;
  maxParallelTools: number;
  dangerousTools: string[];
  blockedTools: string[];
}

/**
 * Skills 配置
 */
export interface SkillsConfig {
  enabled: boolean;
  skillsPath: string;
  autoLoad: boolean;
  watchChanges: boolean;
  allowedSkills: string[];
  blockedSkills: string[];
}

/**
 * 循环配置
 */
export interface LoopConfig {
  maxIterations: number;
  maxToolCallsPerIteration: number;
  timeoutMs: number;
  onToolError: "stop" | "continue" | "retry";
  toolRetryCount: number;
  requireConfirmation: "always" | "dangerous" | "never";
  streamOutput: boolean;
}

/**
 * Agent 消息
 */
export interface AgentMessage {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
  reasoningContent?: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

/**
 * 工具调用
 */
export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * 工具定义
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute: (params: any, context: ExecutionContext) => Promise<any>;
  metadata?: {
    category?: string;
    dangerous?: boolean;
    requiresConfirmation?: boolean;
    timeout?: number;
    retryCount?: number;
    cost?: number;
  };
}

/**
 * Skill 定义
 */
export interface SkillDefinition {
  name: string;
  version: string;
  description: string;
  author?: string;
  triggers: string[];
  tools: ToolDefinition[];
  dependencies?: string[];
  permissions?: string[];
  onLoad?: () => Promise<void>;
  onUnload?: () => Promise<void>;
}

/**
 * 执行上下文
 */
export interface ExecutionContext {
  sessionId: string;
  userId: string;
  variables: Map<string, any>;
  abortSignal?: AbortSignal;
}

/**
 * JSON Schema
 */
export interface JSONSchema {
  type: "object" | "string" | "number" | "boolean" | "array";
  properties?: Record<string, JSONSchema>;
  required?: string[];
  description?: string;
  enum?: any[];
  items?: JSONSchema;
}

/**
 * Agent 事件
 */
export interface AgentEvent {
  type:
    | "start"
    | "thought"
    | "toolCall"
    | "observation"
    | "message"
    | "complete"
    | "error"
    | "interrupt";
  data: any;
  timestamp: number;
  iteration?: number;
}

/**
 * Agent 执行结果
 */
export interface AgentResult {
  success: boolean;
  answer?: string;
  error?: string;
  iterations: number;
  toolCalls: ToolCallRecord[];
  totalTokens: number;
  duration: number;
}

/**
 * 工具调用记录
 */
export interface ToolCallRecord {
  id: string;
  name: string;
  params: any;
  result: any;
  duration: number;
  error?: string;
}

/**
 * 会话摘要
 */
export interface SessionSummary {
  id: string;
  sessionId: string;
  content: string;
  keyPoints: string[];
  messageCount: number;
  startTime: number;
  endTime: number;
  createdAt: number;
}

/**
 * 长期记忆条目
 */
export interface LongTermMemoryItem {
  id: string;
  sessionId: string;
  content: string;
  embedding: number[];
  importance: number;
  accessCount: number;
  lastAccessAt: number;
  createdAt: number;
}
