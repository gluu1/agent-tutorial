// server/websocketServer.ts - WebSocket 服务端

import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import { EventEmitter } from "events";
import { FrameCodec } from "../protocol/frameCodec";
import { Frame } from "../protocol/types";
import {
  MessageType,
  RpcRequest,
  RpcResponse,
  Notification,
  ErrorCode,
} from "../protocol/types.js";
import { AgentGatewayHandlers } from "./handlers";
import { SessionManager } from "./sessionManager";

export interface GatewayConfig {
  port: number;
  host?: string;
  path?: string;
  auth?: {
    enabled: boolean;
    validateToken: (
      token: string,
    ) => Promise<{ valid: boolean; userId?: string }>;
  };
  heartbeatInterval?: number;
  maxConnections?: number;
}

export interface ClientInfo {
  id: string;
  socket: WebSocket;
  userId?: string;
  authenticated: boolean;
  connectedAt: number;
  lastHeartbeat: number;
  subscriptions: Set<string>;
}

/**
 * Agent WebSocket 网关服务端
 */
export class AgentWebSocketGateway extends EventEmitter {
  private wss: WebSocketServer;
  private clients: Map<string, ClientInfo> = new Map();
  private handlers: AgentGatewayHandlers;
  private sessionManager: SessionManager;
  private config: GatewayConfig;
  private heartbeatTimer: NodeJS.Timeout;

  constructor(config: GatewayConfig, handlers: AgentGatewayHandlers) {
    super();
    this.config = {
      host: "0.0.0.0",
      path: "/agent",
      heartbeatInterval: 30000,
      maxConnections: 1000,
      ...config,
    };
    this.handlers = handlers;
    this.sessionManager = new SessionManager();
  }

  /**
   * 启动网关服务
   */
  async start(): Promise<void> {
    const server = createServer();

    this.wss = new WebSocketServer({
      server,
      path: this.config.path,
      maxPayload: 10 * 1024 * 1024, // 10MB
    });

    this.setupWebSocketHandlers();

    // 启动心跳检测
    this.startHeartbeat();

    return new Promise((resolve) => {
      server.listen(this.config.port, this.config.host, () => {
        console.log(
          `Agent Gateway listening on ws://${this.config.host}:${this.config.port}${this.config.path}`,
        );
        resolve();
      });
    });
  }

  /**
   * 停止网关服务
   */
  async stop(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    // 关闭所有客户端连接
    for (const [clientId, client] of this.clients) {
      client.socket.close(1000, "Server shutting down");
    }

    return new Promise((resolve) => {
      this.wss.close(() => resolve());
    });
  }

  /**
   * 设置 WebSocket 事件处理器
   */
  private setupWebSocketHandlers(): void {
    this.wss.on("connection", (socket: WebSocket, req) => {
      // 检查连接数限制
      if (this.clients.size >= this.config.maxConnections!) {
        socket.close(1013, "Too many connections");
        return;
      }

      const clientId = this.generateClientId();
      const clientInfo: ClientInfo = {
        id: clientId,
        socket,
        authenticated: false,
        connectedAt: Date.now(),
        lastHeartbeat: Date.now(),
        subscriptions: new Set(),
      };

      this.clients.set(clientId, clientInfo);

      console.log(`Client connected: ${clientId}`);
      this.emit("client_connected", { clientId });

      // 设置消息处理器
      socket.on("message", (data: Buffer) => {
        this.handleMessage(clientId, data);
      });

      socket.on("close", (code, reason) => {
        this.handleDisconnect(clientId, code, reason);
      });

      socket.on("error", (error) => {
        console.error(`Client ${clientId} error:`, error);
        this.emit("client_error", { clientId, error });
      });
    });
  }

  /**
   * 处理客户端消息
   */
  private async handleMessage(clientId: string, data: Buffer): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    try {
      // 解码帧
      let offset = 0;
      let frame;

      while ((frame = FrameCodec.decode(data, offset)) !== null) {
        offset += 9 + frame.length;

        await this.processFrame(client, frame);
      }
    } catch (error) {
      console.error(`Error processing message from ${clientId}:`, error);

      // 发送错误响应
      const errorFrame = FrameCodec.encodeJson(MessageType.NOTIFICATION, {
        type: "error",
        data: {
          code: ErrorCode.INVALID_REQUEST,
          message: error instanceof Error ? error.message : "Invalid message",
        },
      });
      client.socket.send(errorFrame);
    }
  }

  /**
   * 处理单个帧
   */
  private async processFrame(client: ClientInfo, frame: Frame): Promise<void> {
    switch (frame.type) {
      case MessageType.AUTH:
        await this.handleAuth(client, frame);
        break;

      case MessageType.REQUEST:
        await this.handleRequest(client, frame);
        break;

      case MessageType.PING:
        await this.handlePing(client);
        break;

      case MessageType.NOTIFICATION:
        await this.handleNotification(client, frame);
        break;

      default:
        console.warn(`Unknown frame type: ${frame.type}`);
    }
  }

  /**
   * 处理认证
   */
  private async handleAuth(client: ClientInfo, frame: Frame): Promise<void> {
    const { token } = FrameCodec.decodeJson<{ token: string }>(frame);

    if (!this.config.auth?.enabled) {
      // 未启用认证，直接允许
      client.authenticated = true;
      const response = FrameCodec.encodeJson(MessageType.AUTH_RESPONSE, {
        success: true,
        clientId: client.id,
      });
      client.socket.send(response);
      return;
    }

    try {
      const result = await this.config.auth.validateToken(token);

      if (result.valid) {
        client.authenticated = true;
        client.userId = result.userId;

        const response = FrameCodec.encodeJson(MessageType.AUTH_RESPONSE, {
          success: true,
          clientId: client.id,
          userId: result.userId,
        });
        client.socket.send(response);

        console.log(`Client ${client.id} authenticated as ${result.userId}`);
      } else {
        const response = FrameCodec.encodeJson(MessageType.AUTH_RESPONSE, {
          success: false,
          error: "Invalid token",
        });
        client.socket.send(response);
        client.socket.close(1008, "Authentication failed");
      }
    } catch (error) {
      const response = FrameCodec.encodeJson(MessageType.AUTH_RESPONSE, {
        success: false,
        error: error instanceof Error ? error.message : "Auth error",
      });
      client.socket.send(response);
    }
  }

  /**
   * 处理 RPC 请求
   */
  private async handleRequest(client: ClientInfo, frame: Frame): Promise<void> {
    // 检查认证
    if (this.config.auth?.enabled && !client.authenticated) {
      await this.sendError(
        client,
        null,
        ErrorCode.UNAUTHORIZED,
        "Not authenticated",
      );
      return;
    }

    const request = FrameCodec.decodeJson<RpcRequest>(frame);

    try {
      // 路由到对应的 RPC 处理器
      const result = await this.routeRequest(client, request);

      // 发送响应
      const response: RpcResponse = {
        id: request.id,
        result,
        timestamp: Date.now(),
      };

      const responseFrame = FrameCodec.encodeJson(
        MessageType.RESPONSE,
        response,
      );
      client.socket.send(responseFrame);
    } catch (error) {
      await this.sendError(client, request.id, error);
    }
  }

  /**
   * 路由请求到处理器
   */
  private async routeRequest(
    client: ClientInfo,
    request: RpcRequest,
  ): Promise<any> {
    const [category, method] = request.method.split(".");

    switch (category) {
      case "agent":
        return this.handleAgentMethod(client, method, request.params);

      case "session":
        return this.handleSessionMethod(client, method, request.params);

      case "system":
        return this.handleSystemMethod(client, method, request.params);

      default:
        throw new Error(`Unknown method category: ${category}`);
    }
  }

  /**
   * Agent 相关方法
   */
  private async handleAgentMethod(
    client: ClientInfo,
    method: string,
    params: any,
  ): Promise<any> {
    switch (method) {
      case "run":
        return this.handlers.runAgent(client, params);

      case "stop":
        return this.handlers.stopAgent(client, params);

      case "status":
        return this.handlers.getAgentStatus(client, params);

      case "list":
        return this.handlers.listAgents(client);

      default:
        throw new Error(`Unknown agent method: ${method}`);
    }
  }

  /**
   * 会话相关方法
   */
  private async handleSessionMethod(
    client: ClientInfo,
    method: string,
    params: any,
  ): Promise<any> {
    switch (method) {
      case "create":
        return this.sessionManager.createSession(client.userId!, params);

      case "get":
        return this.sessionManager.getSession(params.sessionId);

      case "list":
        return this.sessionManager.listSessions(client.userId!);

      case "delete":
        return this.sessionManager.deleteSession(params.sessionId);

      default:
        throw new Error(`Unknown session method: ${method}`);
    }
  }

  /**
   * 系统相关方法
   */
  private async handleSystemMethod(
    client: ClientInfo,
    method: string,
    params: any,
  ): Promise<any> {
    switch (method) {
      case "health":
        return { status: "ok", timestamp: Date.now() };

      case "info":
        return {
          version: "1.0.0",
          protocol: "agent-gateway",
          features: ["websocket", "sse", "streaming"],
        };

      default:
        throw new Error(`Unknown system method: ${method}`);
    }
  }

  /**
   * 处理心跳
   */
  private async handlePing(client: ClientInfo): Promise<void> {
    client.lastHeartbeat = Date.now();

    const pongFrame = FrameCodec.encode(MessageType.PONG, Buffer.alloc(0));
    client.socket.send(pongFrame);
  }

  /**
   * 处理通知
   */
  private async handleNotification(
    client: ClientInfo,
    frame: Frame,
  ): Promise<void> {
    const notification = FrameCodec.decodeJson<Notification>(frame);

    // 根据通知类型分发
    switch (notification.type) {
      case "subscribe":
        this.handleSubscribe(client, notification.data);
        break;

      case "unsubscribe":
        this.handleUnsubscribe(client, notification.data);
        break;

      default:
        console.warn(`Unknown notification type: ${notification.type}`);
    }
  }

  /**
   * 处理订阅
   */
  private handleSubscribe(client: ClientInfo, data: { topic: string }): void {
    client.subscriptions.add(data.topic);
    console.log(`Client ${client.id} subscribed to ${data.topic}`);
  }

  /**
   * 处理取消订阅
   */
  private handleUnsubscribe(client: ClientInfo, data: { topic: string }): void {
    client.subscriptions.delete(data.topic);
  }

  /**
   * 处理断开连接
   */
  private handleDisconnect(
    clientId: string,
    code: number,
    reason: Buffer,
  ): void {
    const client = this.clients.get(clientId);
    if (client) {
      console.log(`Client disconnected: ${clientId}, code: ${code}`);
      this.clients.delete(clientId);
      this.emit("client_disconnected", { clientId, userId: client.userId });
    }
  }

  /**
   * 发送错误响应
   */
  private async sendError(
    client: ClientInfo,
    requestId: string | null,
    error: any,
    defaultMessage?: string,
  ): Promise<void> {
    const errorCode =
      typeof error === "number" ? error : ErrorCode.INTERNAL_ERROR;
    const errorMessage =
      defaultMessage ||
      (error instanceof Error ? error.message : String(error));

    const response: RpcResponse = {
      id: requestId || "unknown",
      error: {
        code: errorCode,
        message: errorMessage,
      },
      timestamp: Date.now(),
    };

    const responseFrame = FrameCodec.encodeJson(MessageType.RESPONSE, response);
    client.socket.send(responseFrame);
  }

  /**
   * 广播消息给所有客户端
   */
  broadcast(topic: string, data: any): void {
    const notification: Notification = {
      type: topic,
      data,
      timestamp: Date.now(),
    };

    const frame = FrameCodec.encodeJson(MessageType.NOTIFICATION, notification);

    for (const [clientId, client] of this.clients) {
      if (client.subscriptions.has(topic) || topic === "broadcast") {
        client.socket.send(frame);
      }
    }
  }

  /**
   * 发送消息给指定客户端
   */
  sendToClient(clientId: string, topic: string, data: any): boolean {
    const client = this.clients.get(clientId);
    if (!client) return false;

    const notification: Notification = {
      type: topic,
      data,
      timestamp: Date.now(),
    };

    const frame = FrameCodec.encodeJson(MessageType.NOTIFICATION, notification);
    client.socket.send(frame);

    return true;
  }

  /**
   * 启动心跳检测
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      const timeout = this.config.heartbeatInterval! * 2;

      for (const [clientId, client] of this.clients) {
        if (now - client.lastHeartbeat > timeout) {
          console.log(
            `Client ${clientId} heartbeat timeout, closing connection`,
          );
          client.socket.close(1000, "Heartbeat timeout");
          this.clients.delete(clientId);
        }
      }
    }, this.config.heartbeatInterval!);
  }

  /**
   * 生成客户端 ID
   */
  private generateClientId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }
}
