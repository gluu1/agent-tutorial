// client/sseClient.ts

import { EventEmitter } from "events";

export interface SSEClientConfig {
  url: string;
  token?: string;
  autoReconnect?: boolean;
  reconnectInterval?: number;
  lastEventId?: string;
}

/**
 * SSE 客户端
 * 接收服务器推送事件
 */
export class SSEClient extends EventEmitter {
  private sse: EventSource | null = null;
  private config: SSEClientConfig;
  private reconnectAttempts: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isClosing: boolean = false;

  constructor(config: SSEClientConfig) {
    super();
    this.config = {
      autoReconnect: true,
      reconnectInterval: 3000,
      ...config,
    };
  }

  /**
   * 连接 SSE 服务
   */
  connect(): void {
    const url = new URL(this.config.url);

    if (this.config.token) {
      url.searchParams.set("token", this.config.token);
    }

    if (this.config.lastEventId) {
      url.searchParams.set("lastEventId", this.config.lastEventId);
    }

    this.sse = new EventSource(url.toString());

    this.sse.onopen = () => {
      console.log("SSE connected");
      this.reconnectAttempts = 0;
      this.emit("connected");
    };

    this.sse.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.emit("message", data);
        // 记录当前事件ID（服务端需在响应中返回id字段）
        if (event.lastEventId) {
          this.config.lastEventId = event.lastEventId;
        }
      } catch (error) {
        console.error("Failed to parse SSE message:", error);
      }
    };

    this.sse.onerror = (error) => {
      console.error("SSE error:", error);
      this.emit("error", error);

      if (!this.isClosing && this.config.autoReconnect) {
        this.scheduleReconnect();
      }
    };

    // 处理自定义事件
    const eventTypes = ["agent_event", "notification", "connected"];
    for (const type of eventTypes) {
      this.sse.addEventListener(type, (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          this.emit(type, data);
        } catch (error) {
          console.error(`Failed to parse ${type} event:`, error);
        }
      });
    }
  }

  /**
   * 调度重连
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    const delay =
      this.config.reconnectInterval! * Math.pow(1.5, this.reconnectAttempts);
    console.log(
      `SSE reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1})`,
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectAttempts++;
      this.disconnect();
      this.connect();
    }, delay);
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.isClosing = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.sse) {
      this.sse.close();
      this.sse = null;
    }

    this.emit("disconnected");
  }

  /**
   * 获取连接状态
   */
  get readyState(): number {
    return this.sse?.readyState ?? EventSource.CLOSED;
  }
}
