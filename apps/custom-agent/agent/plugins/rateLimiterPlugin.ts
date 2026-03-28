// plugins/rateLimiterPlugin.ts

import { Plugin,PluginHooks, PluginMetadata } from "./types";
import { Agent } from "../agent";
import { AgentConfig, AgentMessage, AgentResult } from "../types";
import { AgentLoop } from 'agent/agent-loop';

export interface RateLimiterConfig {
  maxRequestsPerMinute: number;
  maxTokensPerMinute: number;
  maxCostPerSession: number;
  onLimitExceeded: "error" | "queue" | "degrade";
  queueTimeoutMs: number;
}

/**
 * 限流插件
 * 控制 API 调用频率和成本
 */
export class RateLimiterPlugin implements Plugin {
  public metadata: PluginMetadata = {
    name: "rate-limiter",
    version: "1.0.0",
    description: "控制 API 调用频率和成本",
    author: "Agent Core Team",
    license: "MIT",
  };

  private config: RateLimiterConfig;
  private requestTimestamps: number[] = [];
  private tokenUsage: number[] = [];
  private cost: number = 0;
  private queue: Array<{
    resolve: Function;
    reject: Function;
    timestamp: number;
  }> = [];
  private processingQueue: boolean = false;

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = {
      maxRequestsPerMinute: 60,
      maxTokensPerMinute: 100000,
      maxCostPerSession: 1.0,
      onLimitExceeded: "queue",
    name: string;
    version: string;
    description?: string;
    onBeforeLoop?(loop: AgentLoop, input: string): Promise<void> {
        throw new Error('Method not implemented.');
    }
    onAfterLoop?(loop: AgentLoop, result: AgentResult): Promise<void> {
        throw new Error('Method not implemented.');
    }
    onAfterToolCall?(toolName: string, result: any): Promise<void> {
        throw new Error('Method not implemented.');
    }
    onMessage?(message: AgentMessage): Promise<AgentMessage> {
        throw new Error('Method not implemented.');
    }
      queueTimeoutMs: 30000,
      ...config,
    };
  }

  async onInit(agent: Agent, config: AgentConfig): Promise<void> {
    // 重置限流状态
    this.reset();
    console.log("Rate limiter plugin initialized");
  }

  async onBeforeToolCall(toolName: string, params: any): Promise<any> {
    // 检查工具调用是否受限
    await this.checkLimit();
    return params;
  }

  async onModelResponse(response: any): Promise<any> {
    // 记录 Token 使用
    const tokens = response.usage?.totalTokens || 0;
    this.recordTokenUsage(tokens);

    // 估算成本（简化计算）
    const cost = this.estimateCost(tokens);
    this.cost += cost;

    // 检查成本限制
    if (this.cost > this.config.maxCostPerSession) {
      throw new Error(
        `Cost limit exceeded: $${this.cost.toFixed(4)} / $${this.config.maxCostPerSession}`,
      );
    }

    return response;
  }

  async onError(error: Error): Promise<void> {
    console.error("Rate limiter error:", error);
  }

  async onDestroy(): Promise<void> {
    // 清理队列
    for (const item of this.queue) {
      item.reject(new Error("Rate limiter destroyed"));
    }
    this.queue = [];
  }

  /**
   * 检查是否超过限制
   */
  private async checkLimit(): Promise<void> {
    this.cleanupOldRecords();

    const requestsInLastMinute = this.requestTimestamps.length;
    const tokensInLastMinute = this.tokenUsage.reduce((a, b) => a + b, 0);

    if (requestsInLastMinute >= this.config.maxRequestsPerMinute) {
      await this.handleLimitExceeded("request");
    }

    if (tokensInLastMinute >= this.config.maxTokensPerMinute) {
      await this.handleLimitExceeded("token");
    }
  }

  /**
   * 处理超限
   */
  private async handleLimitExceeded(type: "request" | "token"): Promise<void> {
    if (this.config.onLimitExceeded === "error") {
      throw new Error(`Rate limit exceeded: ${type}`);
    }

    if (this.config.onLimitExceeded === "queue") {
      return this.queueRequest();
    }

    if (this.config.onLimitExceeded === "degrade") {
      // 降级处理：返回模拟响应
      console.warn(`Rate limit exceeded, degrading: ${type}`);
      return;
    }
  }

  /**
   * 队列请求
   */
  private queueRequest(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.queue.findIndex((item) => item.resolve === resolve);
        if (index !== -1) {
          this.queue.splice(index, 1);
          reject(new Error("Queue timeout"));
        }
      }, this.config.queueTimeoutMs);

      this.queue.push({
        resolve: () => {
          clearTimeout(timeout);
          resolve();
        },
        reject: (err: any) => {
          clearTimeout(timeout);
          reject(err);
        },
        timestamp: Date.now(),
      });

      this.processQueue();
    });
  }

  /**
   * 处理队列
   */
  private async processQueue(): Promise<void> {
    if (this.processingQueue || this.queue.length === 0) return;

    this.processingQueue = true;

    while (this.queue.length > 0) {
      this.cleanupOldRecords();

      const requestsInLastMinute = this.requestTimestamps.length;
      if (requestsInLastMinute < this.config.maxRequestsPerMinute) {
        const item = this.queue.shift();
        if (item) {
          this.recordRequest();
          item.resolve();
        }
      } else {
        // 等待一段时间后重试
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    this.processingQueue = false;
  }

  /**
   * 记录请求
   */
  private recordRequest(): void {
    this.requestTimestamps.push(Date.now());
  }

  /**
   * 记录 Token 使用
   */
  private recordTokenUsage(tokens: number): void {
    this.tokenUsage.push(tokens);
    this.cleanupOldRecords();
  }

  /**
   * 清理过期记录
   */
  private cleanupOldRecords(): void {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    this.requestTimestamps = this.requestTimestamps.filter(
      (t) => t > oneMinuteAgo,
    );
    this.tokenUsage = this.tokenUsage.filter((_, i) => {
      // 简化：假设 token 使用记录与请求记录对应
      return this.requestTimestamps[i] > oneMinuteAgo;
    });
  }

  /**
   * 估算成本
   */
  private estimateCost(tokens: number): number {
    // 简化成本计算
    return tokens * 0.000002; // $0.002 per 1K tokens
  }

  /**
   * 重置状态
   */
  private reset(): void {
    this.requestTimestamps = [];
    this.tokenUsage = [];
    this.cost = 0;
    this.queue = [];
    this.processingQueue = false;
  }

  /**
   * 获取当前状态
   */
  getStatus(): {
    requestsLastMinute: number;
    tokensLastMinute: number;
    totalCost: number;
    queueSize: number;
  } {
    this.cleanupOldRecords();
    return {
      requestsLastMinute: this.requestTimestamps.length,
      tokensLastMinute: this.tokenUsage.reduce((a, b) => a + b, 0),
      totalCost: this.cost,
      queueSize: this.queue.length,
    };
  }
}
