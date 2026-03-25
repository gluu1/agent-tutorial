// server/sseServer.ts - SSE 服务端 (Server-Sent Events)

import { EventEmitter } from "events";
import { IncomingMessage, ServerResponse, createServer } from "http";
import { AgentGatewayHandlers } from "./handlers";

export interface SSEConnection {
  id: string;
  res: ServerResponse;
  userId?: string;
  authenticated: boolean;
  connectedAt: number;
  lastEventId?: string;
}

/**
 * SSE 服务端
 * 提供单向流式推送能力
 */
export class SSEServer extends EventEmitter {
  private connections: Map<string, SSEConnection> = new Map();
  private handlers: AgentGatewayHandlers;
  private port: number;
  private host: string;
  private path: string;

  constructor(config: {
    port: number;
    host?: string;
    path?: string;
    handlers: AgentGatewayHandlers;
  }) {
    super();
    this.port = config.port;
    this.host = config.host || "0.0.0.0";
    this.path = config.path || "/sse";
    this.handlers = config.handlers;
  }

  /**
   * 启动 SSE 服务
   */
  async start(): Promise<void> {
    const server = createServer((req, res) => {
      this.handleRequest(req, res);
    });

    return new Promise((resolve) => {
      server.listen(this.port, this.host, () => {
        console.log(
          `SSE Server listening on http://${this.host}:${this.port}${this.path}`,
        );
        resolve();
      });
    });
  }

  /**
   * 处理 SSE 连接请求
   */
  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url!, `http://${req.headers.host}`);

    if (url.pathname !== this.path) {
      res.writeHead(404);
      res.end();
      return;
    }

    // 设置 SSE 响应头
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    });

    // 解析认证信息
    const authHeader = req.headers.authorization;
    let userId: string | undefined;
    let authenticated = false;

    // 这里可以实现认证逻辑
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      // 验证 token...
      authenticated = true;
      userId = "user_" + token.substring(0, 8);
    } else if (!this.handlers.isRequiresAuth()) {
      authenticated = true;
    }

    const connectionId = this.generateConnectionId();
    const connection: SSEConnection = {
      id: connectionId,
      res,
      userId,
      authenticated,
      connectedAt: Date.now(),
    };

    this.connections.set(connectionId, connection);

    // 发送初始连接成功消息
    this.sendEvent(connection, "connected", {
      connectionId,
      timestamp: Date.now(),
    });

    // 处理客户端断开
    req.on("close", () => {
      this.connections.delete(connectionId);
      this.emit("disconnected", { connectionId, userId });
      console.log(`SSE connection closed: ${connectionId}`);
    });

    this.emit("connected", { connectionId, userId });
    console.log(`SSE connection established: ${connectionId}`);
  }

  /**
   * 发送事件给指定连接
   */
  sendEvent(connection: SSEConnection, event: string, data: any): void {
    if (connection.res.writableEnded) return;

    const lines = [
      `event: ${event}`,
      `id: ${Date.now()}`,
      `data: ${JSON.stringify(data)}`,
      "",
    ];

    connection.res.write(lines.join("\n"));
  }

  /**
   * 广播事件给所有连接
   */
  broadcast(event: string, data: any, userId?: string): void {
    for (const [id, conn] of this.connections) {
      if (userId && conn.userId !== userId) continue;
      this.sendEvent(conn, event, data);
    }
  }

  /**
   * 发送 Agent 事件流
   */
  sendAgentEvent(connectionId: string, sessionId: string, event: any): void {
    const conn = this.connections.get(connectionId);
    if (!conn) return;

    this.sendEvent(conn, "agent_event", {
      sessionId,
      event,
      timestamp: Date.now(),
    });
  }

  /**
   * 获取连接数
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * 生成连接 ID
   */
  private generateConnectionId(): string {
    return `sse_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }
}
