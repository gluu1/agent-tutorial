// plugins/performanceMonitorPlugin.ts - 性能监控插件 (PerformanceMonitorPlugin)

import { Plugin, PluginHooks, PluginMetadata } from "./types";
import { Agent } from "../agent";
import { AgentResult } from "../types";

export interface MonitorConfig {
  enableMetrics: boolean;
  reportIntervalMs: number;
  metricsEndpoint?: string;
  alertThresholds: {
    responseTimeMs: number;
    tokenUsage: number;
    errorRate: number;
  };
}

/**
 * 性能监控插件
 * 监控 Agent 的性能指标
 */
export class PerformanceMonitorPlugin implements PluginHooks {
  public metadata: PluginMetadata = {
    name: "performance-monitor",
    version: "1.0.0",
    description: "监控 Agent 性能指标",
    author: "Agent Core Team",
    license: "MIT",
  };

  private config: MonitorConfig;
  private metrics: {
    totalRequests: number;
    totalErrors: number;
    totalTokens: number;
    totalDuration: number;
    responseTimes: number[];
    toolCalls: Map<string, number>;
    timestamps: number[];
  };

  private reportTimer?: NodeJS.Timeout;

  constructor(config: Partial<MonitorConfig> = {}) {
    this.config = {
      enableMetrics: true,
      reportIntervalMs: 60000,
      alertThresholds: {
        responseTimeMs: 10000,
        tokenUsage: 100000,
        errorRate: 0.1,
      },
      ...config,
    };

    this.metrics = {
      totalRequests: 0,
      totalErrors: 0,
      totalTokens: 0,
      totalDuration: 0,
      responseTimes: [],
      toolCalls: new Map(),
      timestamps: [],
    };
  }

  name: string;
  version: string;
  description?: string;
  onBeforeToolCall?(toolName: string, params: any): Promise<any> {
    throw new Error("Method not implemented.");
  }
  onAfterToolCall?(toolName: string, result: any): Promise<void> {
    throw new Error("Method not implemented.");
  }
  onMessage?(message: AgentMessage): Promise<AgentMessage> {
    throw new Error("Method not implemented.");
  }
  async onInit(agent: Agent, config: any): Promise<void> {
    if (this.config.enableMetrics) {
      this.startReporting();
    }
    console.log("Performance monitor plugin initialized");
  }

  async onBeforeLoop(loop: any, input: string): Promise<void> {
    this.metrics.timestamps.push(Date.now());
    // 清理旧时间戳
    this.cleanupOldTimestamps();
  }

  async onAfterLoop(loop: any, result: AgentResult): Promise<void> {
    this.metrics.totalRequests++;
    this.metrics.totalTokens += result.totalTokens;
    this.metrics.totalDuration += result.duration;
    this.metrics.responseTimes.push(result.duration);

    if (!result.success) {
      this.metrics.totalErrors++;
    }

    // 记录工具调用
    for (const toolCall of result.toolCalls) {
      const count = this.metrics.toolCalls.get(toolCall.name) || 0;
      this.metrics.toolCalls.set(toolCall.name, count + 1);
    }

    // 检查告警
    this.checkAlerts(result);
  }

  async onError(error: Error): Promise<void> {
    this.metrics.totalErrors++;
    console.error("Performance monitor error:", error);
  }

  private startReporting(): void {
    this.reportTimer = setInterval(() => {
      this.reportMetrics();
    }, this.config.reportIntervalMs);
  }

  private reportMetrics(): void {
    const stats = this.getStats();
    console.log("📊 Performance Metrics:", JSON.stringify(stats, null, 2));

    // 发送到外部端点
    if (this.config.metricsEndpoint) {
      this.sendMetrics(stats);
    }
  }

  private getStats(): any {
    const requestCount = this.metrics.timestamps.length;
    const timeRange =
      requestCount > 1 ? (Date.now() - this.metrics.timestamps[0]) / 1000 : 0;

    const avgResponseTime =
      this.metrics.responseTimes.length > 0
        ? this.metrics.responseTimes.reduce((a, b) => a + b, 0) /
          this.metrics.responseTimes.length
        : 0;

    const errorRate =
      this.metrics.totalRequests > 0
        ? this.metrics.totalErrors / this.metrics.totalRequests
        : 0;

    return {
      timestamp: Date.now(),
      requests: {
        total: this.metrics.totalRequests,
        perMinute: requestCount / (timeRange / 60) || 0,
        errors: this.metrics.totalErrors,
        errorRate: errorRate,
      },
      performance: {
        avgResponseTimeMs: avgResponseTime,
        totalDurationMs: this.metrics.totalDuration,
        responseTimes: {
          p50: this.percentile(50),
          p90: this.percentile(90),
          p99: this.percentile(99),
        },
      },
      tokens: {
        total: this.metrics.totalTokens,
        averagePerRequest:
          this.metrics.totalRequests > 0
            ? this.metrics.totalTokens / this.metrics.totalRequests
            : 0,
      },
      tools: Object.fromEntries(this.metrics.toolCalls),
    };
  }

  private percentile(p: number): number {
    if (this.metrics.responseTimes.length === 0) return 0;

    const sorted = [...this.metrics.responseTimes].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
  }

  private checkAlerts(result: AgentResult): void {
    // 响应时间告警
    if (result.duration > this.config.alertThresholds.responseTimeMs) {
      console.warn(
        `⚠️ Response time alert: ${result.duration}ms > ${this.config.alertThresholds.responseTimeMs}ms`,
      );
    }

    // Token 使用告警
    if (result.totalTokens > this.config.alertThresholds.tokenUsage) {
      console.warn(
        `⚠️ Token usage alert: ${result.totalTokens} > ${this.config.alertThresholds.tokenUsage}`,
      );
    }

    // 错误率告警
    const errorRate =
      this.metrics.totalRequests > 0
        ? this.metrics.totalErrors / this.metrics.totalRequests
        : 0;
    if (errorRate > this.config.alertThresholds.errorRate) {
      console.warn(
        `⚠️ Error rate alert: ${(errorRate * 100).toFixed(2)}% > ${this.config.alertThresholds.errorRate * 100}%`,
      );
    }
  }

  private cleanupOldTimestamps(): void {
    const oneMinuteAgo = Date.now() - 60000;
    this.metrics.timestamps = this.metrics.timestamps.filter(
      (t) => t > oneMinuteAgo,
    );
  }

  private async sendMetrics(metrics: any): Promise<void> {
    try {
      await fetch(this.config.metricsEndpoint!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(metrics),
      });
    } catch (error) {
      console.error("Failed to send metrics:", error);
    }
  }

  async onDestroy(): Promise<void> {
    if (this.reportTimer) {
      clearInterval(this.reportTimer);
    }
    console.log("Performance monitor plugin destroyed");
  }
}
