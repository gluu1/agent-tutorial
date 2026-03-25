// client/websocketClient.ts - WebSocket 客户端

import { EventEmitter } from "events";
import WebSocket from "ws";
import { FrameCodec } from "../protocol/frameCodec.js";
import {
  MessageType,
  RpcRequest,
  RpcResponse,
  Notification,
  ErrorCode,
} from "../protocol/types.js";

export interface WebSocketClientConfig {
  url: string;
  token?: string;
  autoReconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  heartbeatInterval?: number;
}

/**
 * WebSocket 客户端
 * 支持自动重连、心跳保活、请求/响应匹配
 */
export class WebSocketClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: WebSocketClientConfig;
  private reconnectAttempts: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private pendingRequests: Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (reason: any) => void;
      timeout: NodeJS.Timeout;
    }
  > = new Map();
  private requestTimeout: number = 30000; // 30 seconds
  private isClosing: boolean = false;

  constructor(config: WebSocketClientConfig) {
    super();
    this.config = {
      autoReconnect: true,
      reconnectInterval: 3000,
      maxReconnectAttempts: 10,
      heartbeatInterval: 30000,
      ...config,
    };
  }

  /**
   * 连接服务器
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.config.url);

        this.ws.on("open", () => {
          console.log("WebSocket connected");
          this.reconnectAttempts = 0;
          this.startHeartbeat();

          // 发送认证
          if (this.config.token) {
            this.authenticate();
          }

          resolve();
        });

        this.ws.on("message", (data: Buffer) => {
          this.handleMessage(data);
        });

        this.ws.on("error", (error) => {
          console.error("WebSocket error:", error);
          this.emit("error", error);
          reject(error);
        });

        this.ws.on("close", (code, reason) => {
          console.log(`WebSocket closed: ${code} - ${reason}`);
          this.stopHeartbeat();

          if (!this.isClosing && this.config.autoReconnect) {
            this.scheduleReconnect();
          }

          this.emit("close", { code, reason });
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 认证
   */
  private async authenticate(): Promise<void> {
    const frame = FrameCodec.encodeJson(MessageType.AUTH, {
      token: this.config.token,
    });

    this.ws?.send(frame);

    // 等待认证响应
    return new Promise((resolve, reject) => {
      const handler = (data: Buffer) => {
        let offset = 0;
        let frame;

        while ((frame = FrameCodec.decode(data, offset)) !== null) {
          offset += 9 + frame.length;

          if (frame.type === MessageType.AUTH_RESPONSE) {
            const response = FrameCodec.decodeJson(frame);
            if (response.success) {
              this.emit("authenticated", response);
              resolve();
            } else {
              reject(new Error(response.error));
            }
            this.ws?.off("message", handler);
            return;
          }
        }
      };

      this.ws?.on("message", handler);

      setTimeout(() => {
        this.ws?.off("message", handler);
        reject(new Error("Authentication timeout"));
      }, 10000);
    });
  }

  /**
   * 处理消息
   */
  private handleMessage(data: Buffer): void {
    let offset = 0;
    let frame;

    while ((frame = FrameCodec.decode(data, offset)) !== null) {
      offset += 9 + frame.length;
      this.processFrame(frame);
    }
  }

  /**
   * 处理帧
   */
  private processFrame(frame: any): void {
    switch (frame.type) {
      case MessageType.RESPONSE:
        this.handleResponse(frame);
        break;

      case MessageType.NOTIFICATION:
        this.handleNotification(frame);
        break;

      case MessageType.PING:
        this.handlePing();
        break;

      case MessageType.PONG:
        this.handlePong();
        break;

      default:
        console.warn(`Unknown frame type: ${frame.type}`);
    }
  }

  /**
   * 处理响应
   */
  private handleResponse(frame: any): void {
    const response = FrameCodec.decodeJson<RpcResponse>(frame);
    const pending = this.pendingRequests.get(response.id);

    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(response.id);

      if (response.error) {
        pending.reject(new Error(response.error.message));
      } else {
        pending.resolve(response.result);
      }
    }
  }

  /**
   * 处理通知
   */
  private handleNotification(frame: any): void {
    const notification = FrameCodec.decodeJson<Notification>(frame);
    this.emit("notification", notification.type, notification.data);
    this.emit(`notification:${notification.type}`, notification.data);
  }

  /**
   * 处理心跳请求
   */
  private handlePing(): void {
    const pongFrame = FrameCodec.encode(MessageType.PONG, Buffer.alloc(0));
    this.ws?.send(pongFrame);
  }

  /**
   * 处理心跳响应
   */
  private handlePong(): void {
    // 心跳响应，无需处理
  }

  /**
   * 发送 RPC 请求
   */
  async call(method: string, params: any): Promise<any> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }

    const id = this.generateRequestId();
    const request: RpcRequest = {
      id,
      method,
      params,
      timestamp: Date.now(),
    };

    const frame = FrameCodec.encodeJson(MessageType.REQUEST, request);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, this.requestTimeout);

      this.pendingRequests.set(id, { resolve, reject, timeout });
      this.ws!.send(frame);
    });
  }

  /**
   * 发送通知（不需要响应）
   */
  notify(type: string, data: any): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const notification: Notification = {
      type,
      data,
      timestamp: Date.now(),
    };

    const frame = FrameCodec.encodeJson(MessageType.NOTIFICATION, notification);
    this.ws.send(frame);
  }

  /**
   * 订阅主题
   */
  subscribe(topic: string): void {
    this.notify("subscribe", { topic });
  }

  /**
   * 取消订阅
   */
  unsubscribe(topic: string): void {
    this.notify("unsubscribe", { topic });
  }

  /**
   * 关闭连接
   */
  async close(): Promise<void> {
    this.isClosing = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.stopHeartbeat();

    // 清理所有待处理请求
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Connection closed"));
    }
    this.pendingRequests.clear();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * 调度重连
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    if (this.reconnectAttempts >= this.config.maxReconnectAttempts!) {
      console.log("Max reconnect attempts reached");
      this.emit("reconnect_failed");
      return;
    }

    const delay =
      this.config.reconnectInterval! * Math.pow(1.5, this.reconnectAttempts);
    console.log(
      `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1})`,
    );

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      this.reconnectAttempts++;

      try {
        await this.connect();
        this.emit("reconnected");
      } catch (error) {
        console.error("Reconnect failed:", error);
        this.scheduleReconnect();
      }
    }, delay);
  }

  /**
   * 启动心跳
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const pingFrame = FrameCodec.encode(MessageType.PING, Buffer.alloc(0));
        this.ws.send(pingFrame);
      }
    }, this.config.heartbeatInterval);
  }

  /**
   * 停止心跳
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 生成请求 ID
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  }
}
