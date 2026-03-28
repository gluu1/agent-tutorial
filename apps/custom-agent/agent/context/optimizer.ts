// core/context/optimizer.ts - 上下文优化器

import { AgentMessage, ContextConfig, ToolDefinition } from "../types";
import { ThreeTierMemoryManager } from "../memory/threeTierMemory";

/**
 * 上下文组装器
 */
export class ContextAssembler {
  private config: ContextConfig;
  private memory: ThreeTierMemoryManager;

  constructor(config: ContextConfig, memory: ThreeTierMemoryManager) {
    this.config = config;
    this.memory = memory;
  }

  /**
   * 组装完整上下文
   */
  async assemble(params: {
    userInput: string;
    systemPrompt?: string;
    skillsPrompt?: string;
    workspaceFiles?: Map<string, string>;
    availableTools?: ToolDefinition[];
  }): Promise<{ messages: AgentMessage[]; tokenCount: number }> {
    const components: Array<{
      priority: number;
      messages: AgentMessage[];
      name: string;
    }> = [];

    // 1. 系统提示词
    if (params.systemPrompt) {
      components.push({
        priority: this.config.priorities.systemPrompt,
        name: "systemPrompt",
        messages: [this.createMessage("system", params.systemPrompt)],
      });
    }

    // 2. 会话摘要
    const sessionSummary = this.memory.getSessionSummary();
    if (sessionSummary) {
      components.push({
        priority: this.config.priorities.sessionSummary,
        name: "sessionSummary",
        messages: [this.createMessage("system", sessionSummary)],
      });
    }

    // 3. Skills 说明
    if (params.skillsPrompt) {
      components.push({
        priority: this.config.priorities.skills,
        name: "skills",
        messages: [this.createMessage("system", params.skillsPrompt)],
      });
    }

    // 4. 工作区文件
    if (params.workspaceFiles && params.workspaceFiles.size > 0) {
      const workspaceContent = Array.from(params.workspaceFiles.entries())
        .map(([name, content]) => `## ${name}\n${content}`)
        .join("\n\n");

      components.push({
        priority: this.config.priorities.workspaceFiles,
        name: "workspace",
        messages: [this.createMessage("system", workspaceContent)],
      });
    }

    // 5. 可用工具说明
    if (params.availableTools && params.availableTools.length > 0) {
      const toolsDescription = this.formatToolsDescription(
        params.availableTools,
      );
      components.push({
        priority: this.config.priorities.systemPrompt,
        name: "tools",
        messages: [this.createMessage("system", toolsDescription)],
      });
    }

    // 6. 长期记忆检索
    const longTermMemories = await this.memory.longTerm.retrieve(
      params.userInput,
    );
    if (longTermMemories.length > 0) {
      const memoryContent = `相关记忆:\n${longTermMemories.map((m) => `- ${m.content}`).join("\n")}`;
      components.push({
        priority: this.config.priorities.longTermMemories,
        name: "longTerm",
        messages: [this.createMessage("system", memoryContent)],
      });
    }

    // 7. 历史对话（短期记忆）
    const shortTerm = this.memory.getShortTerm();
    if (shortTerm.length > 0) {
      components.push({
        priority: this.config.priorities.recentHistory,
        name: "history",
        messages: shortTerm,
      });
    }

    // 8. 当前用户消息
    components.push({
      priority: 0,
      name: "current",
      messages: [this.createMessage("user", params.userInput)],
    });

    // 按优先级排序并组装
    components.sort((a, b) => b.priority - a.priority);

    let messages: AgentMessage[] = [];
    let tokenCount = 0;
    const maxTokens =
      this.config.maxContextTokens - this.config.reservedOutputTokens;

    for (const component of components) {
      const componentTokens = this.estimateTokens(component.messages);

      if (tokenCount + componentTokens > maxTokens) {
        // 超出限制，尝试压缩
        if (component.priority > 30) {
          // 高优先级组件尝试压缩
          const compressed = await this.compressComponent(
            component,
            maxTokens - tokenCount,
          );
          if (compressed) {
            messages.push(...compressed);
            tokenCount += this.estimateTokens(compressed);
          }
        }
        // 低优先级组件直接跳过
        continue;
      }

      messages.push(...component.messages);
      tokenCount += componentTokens;
    }

    return { messages, tokenCount };
  }

  /**
   * 压缩组件
   */
  private async compressComponent(
    component: { priority: number; messages: AgentMessage[]; name: string },
    maxTokens: number,
  ): Promise<AgentMessage[] | null> {
    if (component.name === "history") {
      // 对话历史压缩
      const content = component.messages.map((m) => m.content).join("\n");
      const compressed = await this.summarize(content, maxTokens);
      return [this.createMessage("system", `[对话历史摘要]\n${compressed}`)];
    }

    if (component.name === "longTerm") {
      // 长期记忆压缩，保留最相关的
      return component.messages.slice(0, 3);
    }

    return null;
  }

  /**
   * 格式化工具说明
   */
  private formatToolsDescription(tools: ToolDefinition[]): string {
    const descriptions = tools.map((tool) => {
      return `### ${tool.name}\n${tool.description}\n参数: ${JSON.stringify(tool.parameters, null, 2)}`;
    });

    return `# 可用工具\n\n${descriptions.join("\n\n")}`;
  }

  /**
   * 创建消息
   */
  private createMessage(
    role: "system" | "user",
    content: string,
  ): AgentMessage {
    return {
      id: this.generateId(),
      role,
      content,
      timestamp: Date.now(),
    };
  }

  /**
   * 估算 Token 数
   */
  private estimateTokens(messages: AgentMessage[]): number {
    return messages.reduce((total, msg) => {
      return total + Math.ceil(msg.content.length / 4);
    }, 0);
  }

  /**
   * 生成摘要
   */
  private async summarize(content: string, maxTokens: number): Promise<string> {
    // 简化实现
    if (content.length <= maxTokens * 4) {
      return content;
    }
    return content.substring(0, maxTokens * 4) + "...";
  }

  private generateId(): string {
    return `ctx_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }
}

/**
 * 上下文压缩器
 */
export class ContextCompressor {
  private config: ContextConfig;

  constructor(config: ContextConfig) {
    this.config = config;
  }

  /**
   * 压缩上下文
   */
  async compress(
    messages: AgentMessage[],
    maxTokens: number,
  ): Promise<AgentMessage[]> {
    let currentTokens = 0;
    const compressed: AgentMessage[] = [];

    // 从后往前处理，保留最新消息
    for (let i = messages.length - 1; i >= 0; i--) {
      const msgTokens = Math.ceil(messages[i].content.length / 4);

      if (currentTokens + msgTokens > maxTokens) {
        // 超出限制，添加压缩标记
        if (compressed.length > 0) {
          compressed.unshift({
            id: this.generateId(),
            role: "system",
            content: `[前面 ${i + 1} 条消息已压缩]`,
            timestamp: Date.now(),
          });
        }
        break;
      }

      compressed.unshift(messages[i]);
      currentTokens += msgTokens;
    }

    return compressed;
  }

  private generateId(): string {
    return `cmp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }
}
