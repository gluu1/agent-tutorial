// protocol/frameCodec.ts - 帧协议编解码器

import { Frame, MessageType } from "./types";

/**
 * 帧编解码器
 * 负责消息帧的编码和解码
 */
export class FrameCodec {
  private static readonly MAGIC = 0x4b4d; // "KM"
  private static readonly VERSION = 0x01;
  private static readonly HEADER_SIZE = 9; // 2+1+1+1+4 = 9 bytes

  /**
   * 编码消息帧
   */
  static encode(type: MessageType, payload: Buffer, flags: number = 0): Buffer {
    const buffer = Buffer.alloc(this.HEADER_SIZE + payload.length);
    let offset = 0;

    // Magic (2 bytes)
    buffer.writeUInt16BE(this.MAGIC, offset);
    offset += 2;

    // Version (1 byte)
    buffer.writeUInt8(this.VERSION, offset);
    offset += 1;

    // Type (1 byte)
    buffer.writeUInt8(type, offset);
    offset += 1;

    // Flags (1 byte)
    buffer.writeUInt8(flags, offset);
    offset += 1;

    // Length (4 bytes)
    buffer.writeUInt32BE(payload.length, offset);
    offset += 4;

    // Payload
    payload.copy(buffer, offset);

    return buffer;
  }

  /**
   * 解码消息帧
   * @returns 解码后的帧，如果数据不完整返回 null
   */
  static decode(buffer: Buffer, offset: number = 0): Frame | null {
    if (buffer.length - offset < this.HEADER_SIZE) {
      return null; // 数据不完整
    }

    let pos = offset;

    const magic = buffer.readUInt16BE(pos);
    pos += 2;

    if (magic !== this.MAGIC) {
      throw new Error(`Invalid magic number: ${magic.toString(16)}`);
    }

    const version = buffer.readUInt8(pos);
    pos += 1;

    const type = buffer.readUInt8(pos);
    pos += 1;

    const flags = buffer.readUInt8(pos);
    pos += 1;

    const length = buffer.readUInt32BE(pos);
    pos += 4;

    if (buffer.length - pos < length) {
      return null; // payload 不完整
    }

    const payload = Buffer.alloc(length);
    buffer.copy(payload, 0, pos, pos + length);

    return {
      magic,
      version,
      type,
      flags,
      length,
      payload,
    };
  }

  /**
   * 编码 JSON 负载
   */
  static encodeJson(type: MessageType, data: any, flags: number = 0): Buffer {
    const json = JSON.stringify(data);
    const payload = Buffer.from(json, "utf-8");
    return this.encode(type, payload, flags);
  }

  /**
   * 解码 JSON 负载
   */
  static decodeJson<T>(frame: Frame): T {
    return JSON.parse(frame.payload.toString("utf-8"));
  }
}

/**
 * 流式帧编码器（用于分块发送大数据）
 */
export class StreamFrameEncoder {
  private streamId: string;
  private sequence: number = 0;
  private readonly CHUNK_SIZE = 64 * 1024; // 64KB per chunk

  constructor(streamId: string) {
    this.streamId = streamId;
  }

  /**
   * 将大数据分割为多个帧
   */
  encodeChunks(data: any): Buffer[] {
    const chunks: Buffer[] = [];
    const json = JSON.stringify(data);
    const payload = Buffer.from(json, "utf-8");

    for (let i = 0; i < payload.length; i += this.CHUNK_SIZE) {
      const chunk = payload.subarray(i, i + this.CHUNK_SIZE);
      const chunkData = {
        streamId: this.streamId,
        sequence: this.sequence++,
        data: chunk.toString("base64"),
        isEnd: i + this.CHUNK_SIZE >= payload.length,
      };

      chunks.push(FrameCodec.encodeJson(MessageType.STREAM_DATA, chunkData));
    }

    return chunks;
  }
}
