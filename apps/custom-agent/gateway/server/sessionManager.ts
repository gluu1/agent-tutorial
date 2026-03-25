// server/sessionManager.ts - 会话管理器

export interface Session {
  id: string;
  userId: string;
  agentId?: string;
  createdAt: number;
  lastActivityAt: number;
  metadata: Record<string, any>;
  status: "active" | "idle" | "closed";
}

/**
 * 会话管理器
 * 管理用户会话生命周期
 */
export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private userSessions: Map<string, Set<string>> = new Map();
  private readonly sessionTimeout = 30 * 60 * 1000; // 30 分钟

  /**
   * 创建会话
   */
  createSession(userId: string, metadata?: Record<string, any>): Session {
    const sessionId = this.generateSessionId();
    const session: Session = {
      id: sessionId,
      userId,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      metadata: metadata || {},
      status: "active",
    };

    this.sessions.set(sessionId, session);

    // 维护用户会话列表
    if (!this.userSessions.has(userId)) {
      this.userSessions.set(userId, new Set());
    }
    this.userSessions.get(userId)!.add(sessionId);

    // 启动过期清理
    this.scheduleCleanup(sessionId);

    return session;
  }

  /**
   * 获取会话
   */
  getSession(sessionId: string): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivityAt = Date.now();
    }
    return session;
  }

  /**
   * 更新会话
   */
  updateSession(
    sessionId: string,
    updates: Partial<Session>,
  ): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    Object.assign(session, updates);
    session.lastActivityAt = Date.now();

    return session;
  }

  /**
   * 删除会话
   */
  deleteSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    this.sessions.delete(sessionId);
    const userSessions = this.userSessions.get(session.userId);
    if (userSessions) {
      userSessions.delete(sessionId);
      if (userSessions.size === 0) {
        this.userSessions.delete(session.userId);
      }
    }

    return true;
  }

  /**
   * 列出用户所有会话
   */
  listSessions(userId: string): Session[] {
    const sessionIds = this.userSessions.get(userId);
    if (!sessionIds) return [];

    return Array.from(sessionIds)
      .map((id) => this.sessions.get(id))
      .filter((s): s is Session => s !== undefined);
  }

  /**
   * 清理过期会话
   */
  private scheduleCleanup(sessionId: string): void {
    setTimeout(() => {
      const session = this.sessions.get(sessionId);
      if (
        session &&
        Date.now() - session.lastActivityAt > this.sessionTimeout
      ) {
        this.deleteSession(sessionId);
        console.log(`Session ${sessionId} expired and cleaned up`);
      }
    }, this.sessionTimeout);
  }

  /**
   * 生成会话 ID
   */
  private generateSessionId(): string {
    return `sess_${Date.now()}_${Math.random().toString(36).substring(2, 12)}`;
  }
}
