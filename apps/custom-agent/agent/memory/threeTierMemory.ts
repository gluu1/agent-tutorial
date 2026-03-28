// /memory/threeTierMemory.ts - 三层记忆系统

import { EventEmitter } from "events";
import {
  AgentMessage,
  MemoryConfig,
  SessionSummary,
  LongTermMemoryItem,
} from "../types";

/**
 * 短期记忆 - 滑动窗口
 */
export class ShortTermMemory {
  private messages: AgentMessage[] = [];
  private config: MemoryConfig["shortTerm"];
  private summarizeFn?: (messages: AgentMessage[]) => Promise<string>;

  constructor(config: MemoryConfig["shortTerm"]) {
    this.config = config;
  }

  setSummarizeFn(fn: (messages: AgentMessage[]) => Promise<string>): void {
    this.summarizeFn = fn;
  }

  add(message: AgentMessage): void {
    this.messages.push(message);
    this.checkCompression();
  }

  addAll(messages: AgentMessage[]): void {
    this.messages.push(...messages);
    this.checkCompression();
  }

  getAll(): AgentMessage[] {
    return [...this.messages];
  }

  getRecent(count: number): AgentMessage[] {
    return this.messages.slice(-count);
  }

  getRange(start: number, end: number): AgentMessage[] {
    return this.messages.slice(start, end);
  }

  getCount(): number {
    return this.messages.length;
  }

  estimateTokens(): number {
    return this.messages.reduce((total, msg) => {
      return total + Math.ceil(msg.content.length / 4);
    }, 0);
  }

  private checkCompression(): void {
    const tokenCount = this.estimateTokens();
    const messageCount = this.messages.length;

    if (
      tokenCount > this.config.maxTokens ||
      messageCount > this.config.maxMessages
    ) {
      this.compress();
    }
  }

  private async compress(): Promise<void> {
    const targetMessages = Math.floor(
      this.config.maxMessages * this.config.compressionThreshold,
    );

    if (this.config.compressionStrategy === "slidingWindow") {
      // 简单滑动窗口，丢弃最早的消息
      this.messages = this.messages.slice(-targetMessages);
    } else if (
      this.config.compressionStrategy === "summarize" &&
      this.summarizeFn
    ) {
      // 摘要压缩
      const toSummarize = this.messages.slice(0, -targetMessages);
      const toKeep = this.messages.slice(-targetMessages);

      const summary = await this.summarizeFn(toSummarize);

      this.messages = [
        {
          id: `summary_${Date.now()}`,
          role: "system",
          content: `[历史摘要]\n${summary}`,
          timestamp: Date.now(),
        },
        ...toKeep,
      ];
    } else if (
      this.config.compressionStrategy === "hybrid" &&
      this.summarizeFn
    ) {
      // 混合策略：摘要 + 保留部分历史
      const keepCount = Math.floor(targetMessages * 0.3);
      const summarizeCount = this.messages.length - targetMessages - keepCount;

      const toSummarize = this.messages.slice(0, summarizeCount);
      const toKeep = this.messages.slice(
        summarizeCount,
        summarizeCount + keepCount,
      );
      const recent = this.messages.slice(-targetMessages);

      const summary = await this.summarizeFn(toSummarize);

      this.messages = [
        {
          id: `summary_${Date.now()}`,
          role: "system",
          content: `[历史摘要]\n${summary}`,
          timestamp: Date.now(),
        },
        ...toKeep,
        ...recent,
      ];
    }
  }

  clear(): void {
    this.messages = [];
  }
}

/**
 * 会话记忆 - 摘要提炼
 */
export class SessionMemory {
  private summaries: SessionSummary[] = [];
  private messageCount: number = 0;
  private config: MemoryConfig["session"];
  private sessionId: string;
  private currentKeyPoints: string[] = [];
  private lastSummarizeAt: number = Date.now();

  constructor(sessionId: string, config: MemoryConfig["session"]) {
    this.sessionId = sessionId;
    this.config = config;
  }

  /**
   * 记录消息并检查是否需要摘要
   */
  recordMessage(message: AgentMessage): void {
    this.messageCount++;

    // 提取关键点（简化实现）
    if (this.config.extractKeyPoints && this.isKeyPoint(message)) {
      this.currentKeyPoints.push(this.extractKeyPoint(message));
    }

    // 检查是否需要生成摘要
    if (
      this.config.autoSummarize &&
      this.messageCount % this.config.summaryInterval === 0
    ) {
      this.generateSummary();
    }
  }

  /**
   * 生成摘要
   */
  async generateSummary(): Promise<SessionSummary> {
    const summary: SessionSummary = {
      id: `summary_${Date.now()}`,
      sessionId: this.sessionId,
      content: this.buildSummaryContent(),
      keyPoints: [...this.currentKeyPoints],
      messageCount: this.messageCount,
      startTime: this.lastSummarizeAt,
      endTime: Date.now(),
      createdAt: Date.now(),
    };

    this.summaries.push(summary);
    this.currentKeyPoints = [];
    this.lastSummarizeAt = Date.now();

    return summary;
  }

  /**
   * 获取最新摘要
   */
  getLatestSummary(): SessionSummary | undefined {
    return this.summaries[this.summaries.length - 1];
  }

  /**
   * 获取所有摘要
   */
  getAllSummaries(): SessionSummary[] {
    return [...this.summaries];
  }

  /**
   * 获取会话上下文（摘要 + 关键点）
   */
  getContext(): string {
    if (this.summaries.length === 0) {
      return "";
    }

    const latest = this.getLatestSummary()!;
    let context = `## 会话摘要\n${latest.content}\n`;

    if (latest.keyPoints.length > 0) {
      context += `\n## 关键点\n${latest.keyPoints.map((p) => `- ${p}`).join("\n")}`;
    }

    return context;
  }

  private isKeyPoint(message: AgentMessage): boolean {
    // 判断是否为关键点（简化实现）
    return (
      message.role === "assistant" &&
      message.content.length > 50 &&
      !message.content.includes("工具调用")
    );
  }

  private extractKeyPoint(message: AgentMessage): string {
    // 提取关键点（简化实现）
    const sentences = message.content.split(/[。！？]/);
    return sentences[0] || message.content.substring(0, 100);
  }

  private buildSummaryContent(): string {
    return `会话进行到第 ${this.messageCount} 条消息，关键点: ${this.currentKeyPoints.join(", ")}`;
  }

  clear(): void {
    this.summaries = [];
    this.messageCount = 0;
    this.currentKeyPoints = [];
    this.lastSummarizeAt = Date.now();
  }
}

/**
 * 长期记忆 - 向量检索
 */
export class LongTermMemory {
  private items: Map<string, LongTermMemoryItem> = new Map();
  private config: MemoryConfig["longTerm"];
  private embeddingFn?: (text: string) => Promise<number[]>;

  constructor(config: MemoryConfig["longTerm"]) {
    this.config = config;
  }

  setEmbeddingFn(fn: (text: string) => Promise<number[]>): void {
    this.embeddingFn = fn;
  }

  /**
   * 存储记忆
   */
  async store(
    content: string,
    sessionId: string,
    importance: number = 0.5,
  ): Promise<string> {
    const embedding = this.embeddingFn
      ? await this.embeddingFn(content)
      : this.generateMockEmbedding();
    const id = this.generateId();

    const item: LongTermMemoryItem = {
      id,
      sessionId,
      content,
      embedding,
      importance,
      accessCount: 0,
      lastAccessAt: Date.now(),
      createdAt: Date.now(),
    };

    this.items.set(id, item);
    return id;
  }

  /**
   * 检索相关记忆
   */
  async retrieve(
    query: string,
    topK?: number,
  ): Promise<Array<{ content: string; score: number }>> {
    if (!this.config.enabled) {
      return [];
    }

    const queryEmbedding = this.embeddingFn
      ? await this.embeddingFn(query)
      : this.generateMockEmbedding();
    const results: Array<{
      id: string;
      content: string;
      score: number;
      item: LongTermMemoryItem;
    }> = [];

    for (const [id, item] of this.items) {
      const similarity = this.cosineSimilarity(queryEmbedding, item.embedding);

      // 应用时间衰减
      const age = Date.now() - item.lastAccessAt;
      const decay = Math.exp(-age / (30 * 24 * 3600000)); // 30天半衰期
      const importanceBoost = item.importance * 0.2;
      const accessBoost = Math.min(item.accessCount * 0.05, 0.5);

      const finalScore = similarity * decay + importanceBoost + accessBoost;

      if (finalScore >= this.config.similarityThreshold) {
        results.push({ id, content: item.content, score: finalScore, item });
      }
    }

    // 排序并取前 K 个
    results.sort((a, b) => b.score - a.score);
    const top = results.slice(0, topK || this.config.retrievalTopK);

    // 更新访问计数
    for (const result of top) {
      result.item.accessCount++;
      result.item.lastAccessAt = Date.now();
    }

    return top.map((r) => ({ content: r.content, score: r.score }));
  }

  /**
   * 删除过期记忆
   */
  cleanup(olderThanDays: number = 30): void {
    const cutoff = Date.now() - olderThanDays * 24 * 3600000;

    for (const [id, item] of this.items) {
      if (
        item.lastAccessAt < cutoff &&
        item.importance < this.config.importanceThreshold
      ) {
        this.items.delete(id);
      }
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private generateMockEmbedding(): number[] {
    return Array(1536)
      .fill(0)
      .map(() => Math.random() - 0.5);
  }

  private generateId(): string {
    return `lmem_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }
}

/**
 * 三层记忆管理器
 */
export class ThreeTierMemoryManager extends EventEmitter {
  public shortTerm: ShortTermMemory;
  public session: SessionMemory;
  public longTerm: LongTermMemory;
  private config: MemoryConfig;
  private sessionId: string;

  constructor(sessionId: string, config: MemoryConfig) {
    super();
    this.sessionId = sessionId;
    this.config = config;

    this.shortTerm = new ShortTermMemory(config.shortTerm);
    this.session = new SessionMemory(sessionId, config.session);
    this.longTerm = new LongTermMemory(config.longTerm);
  }

  /**
   * 添加消息到记忆系统
   */
  async addMessage(message: AgentMessage): Promise<void> {
    // 添加到短期记忆
    this.shortTerm.add(message);

    // 添加到会话记忆
    this.session.recordMessage(message);

    // 重要消息存入长期记忆
    if (this.shouldStoreLongTerm(message)) {
      await this.longTerm.store(
        message.content,
        this.sessionId,
        this.calculateImportance(message),
      );
    }

    this.emit("message_added", message);
  }

  /**
   * 获取完整上下文
   */
  async getContext(query: string): Promise<{
    shortTerm: AgentMessage[];
    sessionSummary: string;
    longTermMemories: Array<{ content: string; score: number }>;
  }> {
    const shortTerm = this.shortTerm.getAll();
    const sessionSummary = this.session.getContext();
    const longTermMemories = await this.longTerm.retrieve(query);

    return {
      shortTerm,
      sessionSummary,
      longTermMemories,
    };
  }

  /**
   * 生成会话摘要
   */
  async generateSummary(): Promise<SessionSummary> {
    return this.session.generateSummary();
  }

  /**
   * 获取短期记忆
   */
  getShortTerm(): AgentMessage[] {
    return this.shortTerm.getAll();
  }

  /**
   * 获取会话摘要
   */
  getSessionSummary(): string {
    return this.session.getContext();
  }

  /**
   * 设置摘要生成函数
   */
  setSummarizeFn(fn: (messages: AgentMessage[]) => Promise<string>): void {
    this.shortTerm.setSummarizeFn(fn);
  }

  /**
   * 设置向量化函数
   */
  setEmbeddingFn(fn: (text: string) => Promise<number[]>): void {
    this.longTerm.setEmbeddingFn(fn);
  }

  /**
   * 判断是否需要存入长期记忆
   */
  private shouldStoreLongTerm(message: AgentMessage): boolean {
    // 重要消息才存入长期记忆
    return (
      message.role === "assistant" &&
      message.content.length > 100 &&
      !message.content.includes("工具调用")
    );
  }

  /**
   * 计算消息重要性
   */
  private calculateImportance(message: AgentMessage): number {
    let importance = 0.5;

    // 长度因子
    if (message.content.length > 200) importance += 0.2;
    if (message.content.length > 500) importance += 0.1;

    // 角色因子
    if (message.role === "assistant") importance += 0.1;
    if (message.role === "user") importance += 0.05;

    return Math.min(importance, 1.0);
  }

  /**
   * 清空记忆
   */
  clear(): void {
    this.shortTerm.clear();
    this.session.clear();
    this.emit("cleared");
  }
}
