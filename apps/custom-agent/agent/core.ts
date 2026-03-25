// agent/core.ts

import { EventEmitter } from "events";

export interface AgentCoreConfig {
  sessionId: string;
  userId: string;
  config: any;
}

export class AgentCore extends EventEmitter {
  private sessionId: string;
  private userId: string;
  private config: any;
  private status: "idle" | "running" | "stopping" | "error" = "idle";
  private progress: number = 0;
  private currentStep: string = "";

  constructor(config: AgentCoreConfig) {
    super();
    this.sessionId = config.sessionId;
    this.userId = config.userId;
    this.config = config.config;
  }

  async run(input: string): Promise<any> {
    this.status = "running";
    this.progress = 0;

    this.emit("event", {
      type: "start",
      data: { input },
    });

    try {
      // 模拟 Agent 执行过程
      const steps = ["分析问题", "收集信息", "处理数据", "生成答案"];

      for (let i = 0; i < steps.length; i++) {
        if (this.status === "stopping") {
          throw new Error("Agent stopped");
        }

        this.currentStep = steps[i];
        this.progress = ((i + 1) / steps.length) * 100;

        this.emit("event", {
          type: "step",
          data: {
            step: steps[i],
            progress: this.progress,
          },
        });

        // 模拟处理时间
        await this.sleep(1000);
      }

      const result = {
        answer: `处理完成: ${input}`,
        steps: steps.length,
      };

      this.emit("event", {
        type: "complete",
        data: result,
      });

      this.status = "idle";
      return result;
    } catch (error) {
      this.status = "error";
      this.emit("event", {
        type: "error",
        data: { error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.status = "stopping";
    this.emit("event", {
      type: "stop",
      data: { message: "Agent stopping..." },
    });
  }

  getUserId(): string {
    return this.userId;
  }

  getStatus(): string {
    return this.status;
  }

  getProgress(): number {
    return this.progress;
  }

  getCurrentStep(): string {
    return this.currentStep;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
