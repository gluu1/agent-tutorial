// protocol/types.ts - 消息帧协议定义

/**
 * 消息类型枚举
 */
export enum MessageType {
  // 请求/响应类型
  REQUEST = 0x01, // RPC 请求
  RESPONSE = 0x02, // RPC 响应
  NOTIFICATION = 0x03, // 通知（不需要响应）

  // 流式类型
  STREAM_START = 0x10, // 流开始
  STREAM_DATA = 0x11, // 流数据块
  STREAM_END = 0x12, // 流结束
  STREAM_ERROR = 0x13, // 流错误

  // 控制类型
  PING = 0x20, // 心跳请求
  PONG = 0x21, // 心跳响应
  AUTH = 0x22, // 认证
  AUTH_RESPONSE = 0x23, // 认证响应
  CLOSE = 0x24, // 关闭连接
}

/**
 * 消息帧结构
 *
 * 帧格式:
 * ┌─────────┬─────────┬─────────┬─────────┬──────────┬──────────┐
 * │ Magic   │ Version │ Type    │ Flags   │ Length   │ Payload  │
 * │ 2 bytes │ 1 byte  │ 1 byte  │ 1 byte  │ 4 bytes  │ N bytes  │
 * └─────────┴─────────┴─────────┴─────────┴──────────┴──────────┘
 */
export interface Frame {
  magic: number; // 魔术字: 0x4B4D (KM)
  version: number; // 协议版本: 0x01
  type: MessageType; // 消息类型
  flags: number; // 标志位 (压缩、加密等)
  length: number; // payload 长度
  payload: Buffer; // 消息体
}

/**
 * RPC 请求
 */
export interface RpcRequest {
  id: string; // 请求 ID (UUID)
  method: string; // RPC 方法名，如 "agent.run"
  params: any; // 请求参数
  timestamp: number; // 请求时间戳
}

/**
 * RPC 响应
 */
export interface RpcResponse {
  id: string; // 对应的请求 ID
  result?: any; // 成功结果
  error?: RpcError; // 错误信息
  timestamp: number; // 响应时间戳
}

/**
 * RPC 错误
 */
export interface RpcError {
  code: number; // 错误码
  message: string; // 错误信息
  data?: any; // 附加数据
}

/**
 * 通知消息（服务端主动推送）
 */
export interface Notification {
  type: string; // 通知类型，如 "agent.event"
  data: any; // 通知数据
  timestamp: number;
}

/**
 * 流式数据块
 */
export interface StreamChunk {
  streamId: string; // 流 ID
  sequence: number; // 序列号
  data: any; // 数据块
  isEnd: boolean; // 是否结束
  error?: RpcError; // 错误信息（如果 isEnd 且出错）
}

/**
 * 错误码定义
 */
export const ErrorCode = {
  // 通用错误 (1000-1999)
  UNKNOWN_ERROR: 1000,
  INVALID_REQUEST: 1001,
  METHOD_NOT_FOUND: 1002,
  INVALID_PARAMS: 1003,
  INTERNAL_ERROR: 1004,

  // 认证错误 (2000-2999)
  UNAUTHORIZED: 2000,
  AUTH_EXPIRED: 2001,
  INVALID_TOKEN: 2002,

  // Agent 错误 (3000-3999)
  AGENT_NOT_FOUND: 3000,
  AGENT_BUSY: 3001,
  AGENT_TIMEOUT: 3002,
  AGENT_EXECUTION_ERROR: 3003,

  // 会话错误 (4000-4999)
  SESSION_NOT_FOUND: 4000,
  SESSION_EXPIRED: 4001,

  // 限流错误 (5000-5999)
  RATE_LIMITED: 5000,
  QUOTA_EXCEEDED: 5001,
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];
