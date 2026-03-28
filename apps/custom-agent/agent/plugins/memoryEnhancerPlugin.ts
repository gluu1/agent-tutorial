// plugins/memoryEnhancerPlugin.ts

import { Plugin, PluginHooks, PluginMetadata } from "./types";
import { Agent } from "../agent";
import { AgentMessage, AgentResult } from "../types";

export interface MemoryEnhancerConfig {
  autoSummarizeInterval: number;
  extractKeyEntities: boolean;
  storeImportantFacts: boolean;
  importanceThreshold: number;
}

/**
 * 记忆增强插件
 * 自动提取重要信息，增强记忆能力
 */
export class MemoryEnhancerPlugin implements PluginHooks {
  public metadata: PluginMetadata = {
    name: "memory-enhancer",
    version: "1.0.0",
    description: "增强 Agent 的记忆能力，自动提取重要信息",
    author: "Agent Core Team",
    license: "MIT",
  };

  private config: MemoryEnhancerConfig;
  private agent?: Agent;
  private importantFacts: string[] = [];
  private messageCount: number = 0;

  constructor(config: Partial<MemoryEnhancerConfig> = {}) {
    this.config = {
      autoSummarizeInterval: 10,
      extractKeyEntities: true,
      storeImportantFacts: true,
      importanceThreshold: 0.7,
      ...config,
    };
  }

  async onInit(agent: Agent, config: any): Promise<void> {
    this.agent = agent;
    console.log("Memory enhancer plugin initialized");
  }

  async onAfterMessage(message: AgentMessage): Promise<AgentMessage> {
    this.messageCount++;

    // 提取关键实体
    if (this.config.extractKeyEntities) {
      const entities = this.extractEntities(message.content);
      if (entities.length > 0) {
        console.log(`Extracted entities: ${entities.join(", ")}`);
      }
    }

    // 存储重要事实
    if (this.config.storeImportantFacts) {
      const importance = this.calculateImportance(message);
      if (importance >= this.config.importanceThreshold) {
        const fact = this.extractFact(message);
        if (fact) {
          this.importantFacts.push(fact);
          // 存储到长期记忆
          await this.agent?.memory.longTerm.store(
            fact,
            this.agent?.config.sessionId || "unknown",
            importance,
          );
        }
      }
    }

    // 自动摘要
    if (this.messageCount % this.config.autoSummarizeInterval === 0) {
      await this.generateSummary();
    }

    return message;
  }

  async onAfterLoop(loop: any, result: AgentResult): Promise<void> {
    // 会话结束时生成最终摘要
    if (result.success) {
      await this.generateFinalSummary();
    }
  }

  /**
   * 提取实体（人名、地点、日期等）
   */
  private extractEntities(text: string): string[] {
    const entities: string[] = [];

    // 简单实现：提取大写单词和数字
    const patterns = [
      /[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g, // 专有名词
      /\d{4}-\d{2}-\d{2}/g, // 日期
      /https?:\/\/[^\s]+/g, // URL
    ];

    for (const pattern of patterns) {
      const matches = text.match(pattern);
      if (matches) {
        entities.push(...matches);
      }
    }

    return [...new Set(entities)];
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

    // 关键词因子
    const importantKeywords = [
      "重要",
      "关键",
      "注意",
      "记住",
      "important",
      "key",
      "remember",
    ];
    const hasImportantKeyword = importantKeywords.some((kw) =>
      message.content.toLowerCase().includes(kw.toLowerCase()),
    );
    if (hasImportantKeyword) importance += 0.15;

    return Math.min(importance, 1.0);
  }

  /**
   * 提取事实
   */
  private extractFact(message: AgentMessage): string | null {
    // 简化实现：提取包含"是"、"等于"等关系的句子
    const sentences = message.content.split(/[。！？.!?]/);

    for (const sentence of sentences) {
      if (
        sentence.includes("是") ||
        sentence.includes("等于") ||
        sentence.includes("叫") ||
        sentence.includes("名为")
      ) {
        return sentence.trim();
      }
    }

    // 如果没有找到，取第一句
    if (sentences.length > 0 && sentences[0].length > 20) {
      return sentences[0].trim();
    }

    return null;
  }

  /**
   * 生成摘要
   */
  private async generateSummary(): Promise<void> {
    if (this.importantFacts.length === 0) return;

    const summary = `会话重要信息:\n${this.importantFacts.map((f, i) => `${i + 1}. ${f}`).join("\n")}`;

    // 存储到会话记忆
    await this.agent?.memory.session.generateSummary();

    console.log("Generated summary with", this.importantFacts.length, "facts");
  }

  /**
   * 生成最终摘要
   */
  private async generateFinalSummary(): Promise<void> {
    if (this.importantFacts.length === 0) return;

    const finalSummary = `## 会话总结\n\n本次会话共处理 ${this.messageCount} 条消息，提取了以下重要信息:\n\n${this.importantFacts.map((f, i) => `${i + 1}. ${f}`).join("\n")}`;

    // 存储到长期记忆
    await this.agent?.memory.longTerm.store(
      finalSummary,
      this.agent?.config.sessionId || "unknown",
      0.9,
    );

    console.log("Generated final summary");
  }

  /**
   * 获取重要事实
   */
  getImportantFacts(): string[] {
    return [...this.importantFacts];
  }

  async onDestroy(): Promise<void> {
    // 清理
    this.importantFacts = [];
    console.log("Memory enhancer plugin destroyed");
  }
}
