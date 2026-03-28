// plugins/conversationStylePlugin.ts

import { Plugin, PluginHooks, PluginMetadata } from "./types";
import { Agent } from "../agent";
import { AgentMessage, AgentResult } from "../types";

export interface StyleConfig {
  style: "professional" | "casual" | "friendly" | "technical" | "creative";
  tone: "formal" | "informal" | "enthusiastic" | "empathetic";
  maxLength: number;
  useEmojis: boolean;
  addDisclaimer: boolean;
}

/**
 * 对话风格插件
 * 调整 Agent 的回复风格
 */
export class ConversationStylePlugin implements PluginHooks {
  public metadata: PluginMetadata = {
    name: "conversation-style",
    version: "1.0.0",
    description: "调整 Agent 的对话风格和语气",
    author: "Agent Core Team",
    license: "MIT",
  };

  private config: StyleConfig;
  private systemPromptModifier: string = "";

  constructor(config: Partial<StyleConfig> = {}) {
    this.config = {
      style: "friendly",
      tone: "informal",
      maxLength: 2000,
      useEmojis: true,
      addDisclaimer: false,
      ...config,
    };

    this.initStyleModifier();
  }

  private initStyleModifier(): void {
    const styleMap: Record<string, string> = {
      professional: "使用专业、严谨的语言，避免口语化表达。",
      casual: "使用日常口语，轻松自然的表达方式。",
      friendly: "使用友好、亲切的语气，适当表达关心。",
      technical: "使用技术术语，提供详细的解释。",
      creative: "使用富有创意和想象力的表达。",
    };

    const toneMap: Record<string, string> = {
      formal: "使用正式、礼貌的表达方式。",
      informal: "使用轻松、非正式的表达。",
      enthusiastic: "使用热情、积极的语气，表达鼓励。",
      empathetic: "使用理解、共情的语气，表达关心。",
    };

    this.systemPromptModifier = `\n\n## 对话风格要求\n- 风格: ${styleMap[this.config.style]}\n- 语气: ${toneMap[this.config.tone]}\n- 回复长度: 控制在 ${this.config.maxLength} 字符以内`;

    if (this.config.useEmojis) {
      this.systemPromptModifier += `\n- 可以适当使用 emoji 表达情感`;
    }

    if (this.config.addDisclaimer) {
      this.systemPromptModifier += `\n- 在涉及重要决策时，添加免责声明`;
    }
  }

  async onInit(agent: Agent, config: any): Promise<void> {
    // 修改系统提示词
    if (config.systemPrompt) {
      config.systemPrompt += this.systemPromptModifier;
    }
    console.log(
      `Conversation style plugin initialized: ${this.config.style} / ${this.config.tone}`,
    );
  }

  async onBeforeMessage(message: AgentMessage): Promise<AgentMessage> {
    // 处理用户消息
    if (message.role === "user") {
      message = this.processUserMessage(message);
    }
    return message;
  }

  async onAfterMessage(message: AgentMessage): Promise<AgentMessage> {
    // 处理助手消息
    if (message.role === "assistant") {
      message = this.processAssistantMessage(message);
    }
    return message;
  }

  private processUserMessage(message: AgentMessage): AgentMessage {
    // 可以在这里对用户消息进行预处理
    // 例如：提取情感、检测语气等
    return message;
  }

  private processAssistantMessage(message: AgentMessage): AgentMessage {
    let content = message.content;

    // 限制长度
    if (content.length > this.config.maxLength) {
      content =
        content.substring(0, this.config.maxLength - 50) +
        "\n\n... (内容已截断)";
    }

    // 添加 emoji
    if (this.config.useEmojis && !this.hasEmoji(content)) {
      content = this.addEmoji(content);
    }

    // 添加免责声明
    if (this.config.addDisclaimer && this.needsDisclaimer(content)) {
      content += "\n\n---\n*以上信息仅供参考，请谨慎决策。*";
    }

    return { ...message, content };
  }

  private hasEmoji(text: string): boolean {
    const emojiRegex =
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
    return emojiRegex.test(text);
  }

  private addEmoji(text: string): string {
    const firstSentence = text.split(/[。！？.!?]/)[0];

    if (firstSentence.includes("谢谢") || firstSentence.includes("感谢")) {
      return "🙏 " + text;
    }

    if (firstSentence.includes("你好") || firstSentence.includes("嗨")) {
      return "👋 " + text;
    }

    if (firstSentence.includes("恭喜") || firstSentence.includes("成功")) {
      return "🎉 " + text;
    }

    if (firstSentence.includes("注意") || firstSentence.includes("小心")) {
      return "⚠️ " + text;
    }

    return text;
  }

  private needsDisclaimer(content: string): boolean {
    const keywords = [
      "投资",
      "医疗",
      "法律",
      "决策",
      "建议",
      "investment",
      "medical",
      "legal",
    ];
    return keywords.some((kw) => content.toLowerCase().includes(kw));
  }

  async onDestroy(): Promise<void> {
    console.log("Conversation style plugin destroyed");
  }
}
