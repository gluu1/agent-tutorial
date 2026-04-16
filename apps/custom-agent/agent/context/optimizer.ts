// context/optimizer.ts - 上下文优化器

import { AgentMessage, ContextConfig } from "../types";
import { ThreeTierMemoryManager } from "../memory/threeTierMemory";
import { KnowledgeBaseManager } from "../knowledge";

/**
 * 组件分类
 */
type ComponentName =
  | "systemPrompt"
  | "rules"
  | "skills"
  | "userInput"
  | "workspace"
  | "sessionSummary"
  | "knowledgeBase"
  | "longTerm"
  | "history";

interface ContextComponent {
  name: ComponentName;
  priority: number;
  compressible: boolean;
  messages: AgentMessage[];
  rawContent?: string;
}

/**
 * 上下文组装器
 */
export class ContextAssembler {
  private config: ContextConfig;
  private memory: ThreeTierMemoryManager;
  private knowledgeBaseManager?: KnowledgeBaseManager;

  constructor(
    config: ContextConfig,
    memory: ThreeTierMemoryManager,
    knowledgeBaseManager?: KnowledgeBaseManager,
  ) {
    this.config = config;
    this.memory = memory;
    this.knowledgeBaseManager = knowledgeBaseManager;
  }

  /**
   * 设置知识库管理器（init 后调用）
   */
  setKnowledgeBaseManager(manager: KnowledgeBaseManager): void {
    this.knowledgeBaseManager = manager;
  }

  /**
   * 组装完整上下文
   */
  async assemble(params: {
    userInput: string;
    systemPrompt?: string;
    rules?: string;
    skillsPrompt?: string;
    workspaceFiles?: Map<string, string>;
  }): Promise<{ messages: AgentMessage[]; tokenCount: number }> {
    const maxTokens =
      this.config.maxContextTokens - this.config.reservedOutputTokens;

    // 1. 收集所有组件
    const components = await this.collectComponents(params);

    // 2. 计算总 token
    const totalTokens = this.estimateTokens(
      components.map((c) => c.messages).flat(),
    );

    // 3. 如果总 token 未超限，直接返回
    if (totalTokens <= maxTokens) {
      return {
        messages: components
          .sort((a, b) => b.priority - a.priority)
          .map((c) => c.messages)
          .flat(),
        tokenCount: totalTokens,
      };
    }

    // 4. Token 超限，按优先级压缩
    return this.assembleWithCompression(components, maxTokens);
  }

  /**
   * 收集所有上下文组件
   */
  private async collectComponents(params: {
    userInput: string;
    systemPrompt?: string;
    rules?: string;
    skillsPrompt?: string;
    workspaceFiles?: Map<string, string>;
  }): Promise<ContextComponent[]> {
    const components: ContextComponent[] = [];
    const priorities = this.config.priorities;

    // 不可压缩组件 - Level 1: 系统提示词
    if (params.systemPrompt) {
      components.push({
        name: "systemPrompt",
        priority: priorities.systemPrompt,
        compressible: false,
        messages: [this.createMessage("system", params.systemPrompt)],
      });
    }

    // 不可压缩组件 - Level 2: Rules (优先级高于 skills，超限可丢弃)
    if (params.rules) {
      components.push({
        name: "rules",
        priority: priorities.rules ?? 95,
        compressible: false,
        messages: [this.createMessage("system", params.rules)],
        rawContent: params.rules,
      });
    }

    // 不可压缩组件 - Level 3: Skills
    if (params.skillsPrompt) {
      components.push({
        name: "skills",
        priority: priorities.skills,
        compressible: false,
        messages: [this.createMessage("system", params.skillsPrompt)],
      });
    }

    // 可压缩组件 - Level 4: 工作区文件
    if (params.workspaceFiles && params.workspaceFiles.size > 0) {
      const workspaceContent = Array.from(params.workspaceFiles.entries())
        .map(([name, content]) => `## ${name}\n${content}`)
        .join("\n\n");

      components.push({
        name: "workspace",
        priority: priorities.workspaceFiles,
        compressible: true,
        messages: [this.createMessage("system", workspaceContent)],
        rawContent: workspaceContent,
      });
    }

    // 可压缩组件 - Level 5: 会话摘要
    const sessionSummary = this.memory.getSessionSummary();
    if (sessionSummary) {
      components.push({
        name: "sessionSummary",
        priority: priorities.sessionSummary,
        compressible: true,
        messages: [this.createMessage("system", sessionSummary)],
        rawContent: sessionSummary,
      });
    }

    // 知识库检索 (预注入 Top-3)
    if (this.knowledgeBaseManager) {
      const kbResults = await this.knowledgeBaseManager.retrieve(
        params.userInput,
        3, // Top-3
      );
      if (kbResults.length > 0) {
        const kbContent = this.knowledgeBaseManager.formatAsContext(kbResults);
        components.push({
          name: "knowledgeBase",
          priority: 85, // 高于 sessionSummary
          compressible: false,
          messages: [this.createMessage("system", kbContent)],
          rawContent: kbContent,
        });
      }
    }

    // 可压缩组件 - Level 6: 长期记忆检索
    const longTermMemories = await this.memory.longTerm.retrieve(
      params.userInput,
    );
    if (longTermMemories.length > 0) {
      const memoryContent = `相关记忆:\n${longTermMemories.map((m) => `- ${m.content}`).join("\n")}`;
      components.push({
        name: "longTerm",
        priority: priorities.longTermMemories,
        compressible: true,
        messages: [this.createMessage("system", memoryContent)],
        rawContent: memoryContent,
      });
    }

    // 可压缩组件 - Level 7: 历史对话
    const shortTerm = this.memory.getShortTerm();
    if (shortTerm.length > 0) {
      components.push({
        name: "history",
        priority: priorities.recentHistory,
        compressible: true,
        messages: shortTerm,
        rawContent: shortTerm.map((m) => m.content).join("\n"),
      });
    }

    // 不可压缩组件 - Level 3: 用户输入
    components.push({
      name: "userInput",
      priority: priorities.userInput ?? 80,
      compressible: false,
      messages: [this.createMessage("user", params.userInput)],
    });

    return components;
  }

  /**
   * 带压缩的上下文组装
   * 降级顺序: skills -> rules -> 抛错
   */
  private async assembleWithCompression(
    components: ContextComponent[],
    maxTokens: number,
  ): Promise<{ messages: AgentMessage[]; tokenCount: number }> {
    const messages: AgentMessage[] = [];
    let tokenCount = 0;

    // Step 1: 尝试 systemPrompt + rules + skills + userInput
    let essentialNames: ComponentName[] = [
      "systemPrompt",
      "rules",
      "skills",
      "userInput",
    ];
    let essentialComponents = components.filter((c) =>
      essentialNames.includes(c.name),
    );
    let essentialTokens = this.estimateTokens(
      essentialComponents.map((c) => c.messages).flat(),
    );

    // Step 2: 如果超限，丢弃 skills
    if (essentialTokens > maxTokens) {
      console.warn("[ContextAssembler] Skills dropped due to context overflow");
      essentialNames = ["systemPrompt", "rules", "userInput"];
      essentialComponents = components.filter((c) =>
        essentialNames.includes(c.name),
      );
      essentialTokens = this.estimateTokens(
        essentialComponents.map((c) => c.messages).flat(),
      );
    }

    // Step 3: 如果还是超限，丢弃 rules
    if (essentialTokens > maxTokens) {
      console.warn("[ContextAssembler] Rules dropped due to context overflow");
      essentialNames = ["systemPrompt", "userInput"];
      essentialComponents = components.filter((c) =>
        essentialNames.includes(c.name),
      );
      essentialTokens = this.estimateTokens(
        essentialComponents.map((c) => c.messages).flat(),
      );
    }

    // Step 4: 如果还是超限，抛错
    if (essentialTokens > maxTokens) {
      throw new Error(
        `Context overflow: even essential content exceeds maxTokens (${maxTokens})`,
      );
    }

    // 添加不可压缩组件
    for (const comp of essentialComponents.sort(
      (a, b) => b.priority - a.priority,
    )) {
      messages.push(...comp.messages);
      tokenCount += this.estimateTokens(comp.messages);
    }

    // Step 4: 压缩可压缩组件
    const remaining = maxTokens - tokenCount;
    const compressibleComponents = components
      .filter((c) => c.compressible)
      .sort((a, b) => b.priority - a.priority);

    for (const comp of compressibleComponents) {
      if (remaining - tokenCount <= 0) break;

      const compressed = await this.compressComponent(
        comp,
        remaining - tokenCount,
      );
      if (compressed) {
        messages.push(...compressed);
        tokenCount += this.estimateTokens(compressed);
      }
    }

    console.error("[ContextAssembler] assembled", {
      totalTokens: tokenCount,
      maxTokens,
      components: components.map((c) => ({
        name: c.name,
        priority: c.priority,
        tokens: this.estimateTokens(c.messages),
      })),
    });

    return { messages, tokenCount };
  }

  /**
   * 压缩组件
   */
  private async compressComponent(
    component: ContextComponent,
    maxTokens: number,
  ): Promise<AgentMessage[] | null> {
    const currentTokens = this.estimateTokens(component.messages);

    // 如果当前 token 已经小于等于限制，直接返回
    if (currentTokens <= maxTokens) {
      return component.messages;
    }

    switch (component.name) {
      case "workspace":
        // 工作区文件: 截断内容，保留文件名
        return this.compressWorkspace(component, maxTokens);

      case "sessionSummary":
        // 会话摘要: 摘要压缩
        return this.compressSummary(component, maxTokens);

      case "longTerm":
        // 长期记忆: 按相关性截断
        return this.compressLongTerm(component, maxTokens);

      case "history":
        // 历史对话: 摘要压缩
        return this.compressHistory(component, maxTokens);

      default:
        return null;
    }
  }

  /**
   * 压缩工作区文件 - 截断内容
   */
  private compressWorkspace(
    component: ContextComponent,
    maxTokens: number,
  ): AgentMessage[] {
    const content = component.rawContent || component.messages[0].content;
    const files = content.split("## ").filter(Boolean);
    let result = "";
    let currentTokens = 0;

    for (const file of files) {
      const fileTokens = this.estimateToken(file);

      if (currentTokens + fileTokens > maxTokens) {
        // 如果单个文件就超限，保留文件名
        const nameEnd = file.indexOf("\n");
        if (nameEnd > 0) {
          result += `## ${file.substring(0, nameEnd)}\n[内容已截断...]\n`;
        }
        break;
      }

      result += `## ${file}`;
      currentTokens += fileTokens;
    }

    return [this.createMessage("system", result || "[工作区内容已压缩]")];
  }

  /**
   * 压缩摘要
   */
  private compressSummary(
    component: ContextComponent,
    maxTokens: number,
  ): AgentMessage[] {
    const content = component.rawContent || component.messages[0].content;
    const compressed = this.summarize(content, maxTokens);
    return [
      this.createMessage("system", `[会话摘要压缩]\n${compressed}`),
    ];
  }

  /**
   * 压缩长期记忆 - 截断
   */
  private compressLongTerm(
    component: ContextComponent,
    maxTokens: number,
  ): AgentMessage[] {
    const content = component.rawContent || component.messages[0].content;
    const compressed = content.substring(0, Math.floor(maxTokens * 4));
    return [this.createMessage("system", `[相关记忆已压缩]\n${compressed}`)];
  }

  /**
   * 压缩历史对话 - 摘要
   */
  private compressHistory(
    component: ContextComponent,
    maxTokens: number,
  ): AgentMessage[] {
    const content = component.rawContent || component.messages[0].content;
    const compressed = this.summarize(content, maxTokens);
    return [
      this.createMessage("system", `[对话历史摘要]\n${compressed}`),
    ];
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
    return messages.reduce(
      (total, msg) => total + this.estimateToken(msg.content),
      0,
    );
  }

  private estimateToken(content: string): number {
    const chinese = (content.match(/[\u4e00-\u9fa5]/g) || []).length;
    const other = content.length - chinese;
    return chinese * 2 + other;
  }

  /**
   * 生成摘要
   */
  private summarize(content: string, maxTokens: number): string {
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
