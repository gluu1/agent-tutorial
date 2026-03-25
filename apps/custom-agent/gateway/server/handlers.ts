// server/handlers.ts - RPC 处理器 (Handlers)

import { ClientInfo } from "./websocketServer.js";
import { AgentCore } from "../../agent/core";
import { EventEmitter } from "events";

export interface AgentRunParams {
  sessionId: string;
  input: string;
  config?: any;
}

export interface AgentStopParams {
  sessionId: string;
}

export interface AgentStatusParams {
  sessionId?: string;
}

/**
 * Agent 网关 RPC 处理器
 */
export class AgentGatewayHandlers extends EventEmitter {
  private agents: Map<string, AgentCore> = new Map();
  private runningAgents: Map<string, Set<string>> = new Map(); // userId -> sessionIds
  private requiresAuth: boolean = false;

  constructor(config?: { requiresAuth?: boolean }) {
    super();
    this.requiresAuth = config?.requiresAuth ?? false;
  }

  isRequiresAuth(): boolean {
    return this.requiresAuth;
  }

  /**
   * 运行 Agent
   */
  async runAgent(client: ClientInfo, params: AgentRunParams): Promise<any> {
    const { sessionId, input, config } = params;
    const userId = client.userId;

    if (!userId) {
      throw new Error("User not authenticated");
    }

    // 检查是否有正在运行的 Agent
    const userRunning = this.runningAgents.get(userId);
    if (userRunning && userRunning.size > 0) {
      // 可以选择停止之前的或拒绝新的
      throw new Error("Agent already running for this user");
    }

    // 创建或获取 Agent 实例
    let agent = this.agents.get(sessionId);
    if (!agent) {
      agent = new AgentCore({
        sessionId,
        userId,
        config: config || {},
      });
      this.agents.set(sessionId, agent);
    }

    // 记录运行中的 Agent
    if (!this.runningAgents.has(userId)) {
      this.runningAgents.set(userId, new Set());
    }
    this.runningAgents.get(userId)!.add(sessionId);

    // 设置事件转发
    const eventHandler = (event: any) => {
      // 转发事件给客户端
      client.socket.send?.(
        this.encodeNotification("agent.event", {
          sessionId,
          event,
        }),
      );
    };

    agent.on("event", eventHandler);

    try {
      // 执行 Agent
      const result = await agent.run(input);

      return {
        sessionId,
        result,
        status: "completed",
      };
    } catch (error) {
      throw {
        code: 3003,
        message:
          error instanceof Error ? error.message : "Agent execution failed",
      };
    } finally {
      // 清理
      agent.off("event", eventHandler);
      this.runningAgents.get(userId)?.delete(sessionId);
    }
  }

  /**
   * 停止 Agent
   */
  async stopAgent(client: ClientInfo, params: AgentStopParams): Promise<any> {
    const { sessionId } = params;
    const userId = client.userId;

    const agent = this.agents.get(sessionId);
    if (!agent) {
      throw new Error("Agent not found");
    }

    if (agent.getUserId() !== userId) {
      throw new Error("Unauthorized");
    }

    await agent.stop();

    return {
      sessionId,
      status: "stopped",
    };
  }

  /**
   * 获取 Agent 状态
   */
  async getAgentStatus(
    client: ClientInfo,
    params: AgentStatusParams,
  ): Promise<any> {
    const { sessionId } = params;
    const userId = client.userId;

    if (sessionId) {
      const agent = this.agents.get(sessionId);
      if (!agent) {
        throw new Error("Agent not found");
      }

      if (agent.getUserId() !== userId) {
        throw new Error("Unauthorized");
      }

      return {
        sessionId,
        status: agent.getStatus(),
        progress: agent.getProgress(),
        currentStep: agent.getCurrentStep(),
      };
    } else {
      // 返回用户所有 Agent 状态
      const userSessions = this.runningAgents.get(userId!) || new Set();
      const statuses = [];

      for (const sid of userSessions) {
        const agent = this.agents.get(sid);
        if (agent) {
          statuses.push({
            sessionId: sid,
            status: agent.getStatus(),
          });
        }
      }

      return { agents: statuses };
    }
  }

  /**
   * 列出所有 Agent
   */
  async listAgents(client: ClientInfo): Promise<any> {
    const userId = client.userId;
    const userSessions = this.runningAgents.get(userId!) || new Set();

    return {
      agents: Array.from(userSessions).map((sessionId) => ({
        sessionId,
        status: this.agents.get(sessionId)?.getStatus() || "unknown",
      })),
    };
  }

  /**
   * 编码通知
   */
  private encodeNotification(type: string, data: any): Buffer {
    const notification = {
      type,
      data,
      timestamp: Date.now(),
    };

    return Buffer.from(JSON.stringify(notification), "utf-8");
  }
}
