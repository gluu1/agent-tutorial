// core/agent-loop.ts

import { EventEmitter } from "events";
import { ChatOllama } from "@langchain/ollama";
import {
  AgentConfig,
  AgentResult,
  AgentEvent,
  AgentMessage,
  ToolCall,
  ToolCallRecord,
  ExecutionContext,
} from "./types";
import { ThreeTierMemoryManager } from "./memory/threeTierMemory";
import { ToolExecutor } from "./tools/registry";
import { ContextAssembler } from "./context/optimizer";

/**
 * Agent Loop 核心循环
 * 实现 ReAct 模式：思考 -> 行动 -> 观察
 */
export class AgentLoop extends EventEmitter {
  private config: AgentConfig;
  private memory: ThreeTierMemoryManager;
  private toolExecutor: ToolExecutor;
  private contextAssembler: ContextAssembler;
  private isRunning: boolean = true;
  private abortController: AbortController;
  private model: ChatOllama;

  constructor(
    config: AgentConfig,
    memory: ThreeTierMemoryManager,
    toolExecutor: ToolExecutor,
    contextAssembler: ContextAssembler,
  ) {
    super();
    this.config = config;
    this.memory = memory;
    this.toolExecutor = toolExecutor;
    this.contextAssembler = contextAssembler;
    this.abortController = new AbortController();
    this.model = new ChatOllama({
      model: "qwen3-vl:8b",
      baseUrl: "http://127.0.0.1:11434",
      temperature: 0.7,
      numPredict: 1024,
      streaming: false,
      think: false,
    });
  }

  /**
   * 运行 Agent 循环
   */
  async run(userInput: string): Promise<AgentResult> {
    const startTime = Date.now();
    let iteration = 0;
    const toolCalls: ToolCallRecord[] = [];
    let finalAnswer: string | null = null;
    let totalTokens = 0;

    this.emit("event", {
      type: "start",
      data: { input: userInput },
      timestamp: Date.now(),
    });

    // 添加用户消息到记忆
    await this.memory.addMessage({
      id: this.generateId(),
      role: "user",
      content: userInput,
      timestamp: Date.now(),
    });

    // 设置超时
    const timeoutPromise = this.createTimeoutPromise();

    try {
      while (
        this.isRunning &&
        iteration < this.config.loopConfig!.maxIterations
      ) {
        iteration++;

        this.emit("event", {
          type: "thought",
          data: { iteration, message: "正在思考..." },
          timestamp: Date.now(),
          iteration,
        });

        // 组装上下文
        const context = await this.contextAssembler.assemble({
          userInput,
          systemPrompt: this.config.systemPrompt,
          skillsPrompt: await this.getSkillsPrompt(),
          workspaceFiles: await this.getWorkspaceFiles(),
          availableTools: this.toolExecutor.getDefinitions(),
        });

        // 调用模型（带流式支持）
        const response = await this.invokeModel(context.messages);
        totalTokens += response.usage?.totalTokens || 0;

        const assistantMessage = response.choices[0].message;

        // 添加助手消息到记忆
        await this.memory.addMessage({
          id: this.generateId(),
          role: "assistant",
          content: assistantMessage.content || "",
          toolCalls: assistantMessage.toolCalls,
          reasoningContent: assistantMessage.reasoningContent,
          timestamp: Date.now(),
        });

        // 处理思考过程
        if (assistantMessage.reasoningContent) {
          this.emit("event", {
            type: "thought",
            data: { content: assistantMessage.reasoningContent, iteration },
            timestamp: Date.now(),
            iteration,
          });
        }

        // 检查是否有工具调用
        if (
          assistantMessage.toolCalls &&
          assistantMessage.toolCalls.length > 0
        ) {
          // 执行工具调用
          const toolResults = await this.executeTools(
            assistantMessage.toolCalls,
            toolCalls,
          );

          // 添加工具结果到记忆
          for (const result of toolResults) {
            await this.memory.addMessage({
              id: this.generateId(),
              role: "tool",
              content: JSON.stringify(result.result),
              toolCallId: result.toolCallId,
              name: result.name,
              timestamp: Date.now(),
            });
          }

          // 继续下一轮循环
          continue;
        }

        // 无工具调用，即为最终答案
        finalAnswer = assistantMessage.content;
        break;
      }

      // 检查是否达到最大迭代次数
      if (!finalAnswer && iteration >= this.config.loopConfig!.maxIterations) {
        finalAnswer = this.generateFallbackAnswer(toolCalls);
      }

      const result: AgentResult = {
        success: true,
        answer: finalAnswer || undefined,
        iterations: iteration,
        toolCalls,
        totalTokens,
        duration: Date.now() - startTime,
      };

      this.emit("event", {
        type: "complete",
        data: result,
        timestamp: Date.now(),
      });

      return result;
    } catch (error) {
      const errorResult: AgentResult = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        iterations: iteration,
        toolCalls,
        totalTokens,
        duration: Date.now() - startTime,
      };

      this.emit("event", {
        type: "error",
        data: { error: errorResult.error },
        timestamp: Date.now(),
      });

      return errorResult;
    }
  }

  /**
   * 执行工具调用
   */
  private async executeTools(
    toolCalls: ToolCall[],
    toolCallsRecord: ToolCallRecord[],
  ): Promise<Array<{ toolCallId: string; result: any; name: string }>> {
    const results: Array<{ toolCallId: string; result: any; name: string }> =
      [];
    const maxTools = this.config.loopConfig!.maxToolCallsPerIteration;
    const toolsToExecute = toolCalls.slice(0, maxTools);

    this.emit("event", {
      type: "toolCall",
      data: { toolCalls: toolsToExecute.map((t) => t.function.name) },
      timestamp: Date.now(),
    });

    const executionContext: ExecutionContext = {
      sessionId: this.config.sessionId,
      userId: this.config.userId,
      variables: this.memory.working.getAll(),
      abortSignal: this.abortController.signal,
    };

    for (const toolCall of toolsToExecute) {
      const startTime = Date.now();
      let result: any;
      let error: string | undefined;

      try {
        result = await this.toolExecutor.execute(toolCall, executionContext);

        this.emit("event", {
          type: "observation",
          data: { toolName: toolCall.function.name, result },
          timestamp: Date.now(),
        });
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        result = { error };

        this.emit("event", {
          type: "error",
          data: { toolName: toolCall.function.name, error },
          timestamp: Date.now(),
        });

        // 根据配置决定是否继续
        if (this.config.loopConfig!.onToolError === "stop") {
          throw err;
        }
      }

      // 记录工具调用
      toolCallsRecord.push({
        id: toolCall.id,
        name: toolCall.function.name,
        params: JSON.parse(toolCall.function.arguments),
        result,
        duration: Date.now() - startTime,
        error,
      });

      results.push({
        toolCallId: toolCall.id,
        result,
        name: toolCall.function.name,
      });
    }

    return results;
  }

  /**
   * 调用模型
   */
  private async invokeModel(messages: AgentMessage[]): Promise<any> {
    // 简化实现，实际应调用模型 API
    // 这里返回模拟响应

    const hasTools = this.toolExecutor.getDefinitions().length > 0;

    if (hasTools && Math.random() > 0.7) {
      // 模拟工具调用
      return {
        choices: [
          {
            message: {
              content: "",
              toolCalls: [
                {
                  id: this.generateId(),
                  type: "function",
                  function: {
                    name: "echo",
                    arguments: JSON.stringify({ message: "test" }),
                  },
                },
              ],
            },
          },
        ],
        usage: { totalTokens: 100 },
      };
    }

    const modelWithTools = this.model.bindTools([]);

    console.error("调用模型接口，输入消息:", messages);
    const result = await modelWithTools.invoke(messages);

    // 模拟普通响应
    return result;
  }

  /**
   * 停止循环
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    this.abortController.abort();
    this.emit("event", {
      type: "interrupt",
      data: { message: "Agent stopped by user" },
      timestamp: Date.now(),
    });
  }

  /**
   * 获取 Skills 提示词
   */
  private async getSkillsPrompt(): Promise<string> {
    // 简化实现
    return "";
  }

  /**
   * 获取工作区文件
   */
  private async getWorkspaceFiles(): Promise<Map<string, string>> {
    return new Map();
  }

  /**
   * 创建超时 Promise
   */
  private createTimeoutPromise(): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(
            `Agent loop timeout after ${this.config.loopConfig!.timeoutMs}ms`,
          ),
        );
      }, this.config.loopConfig!.timeoutMs);
    });
  }

  /**
   * 生成降级答案
   */
  private generateFallbackAnswer(toolCalls: ToolCallRecord[]): string {
    const toolsUsed = toolCalls.map((t) => t.name).join(", ");
    return `我尝试了 ${this.config.loopConfig!.maxIterations} 次推理，但未能完成您的请求。\n\n已执行工具: ${toolsUsed || "无"}\n\n请尝试简化您的需求，或提供更多上下文信息。`;
  }

  /**
   * 生成 ID
   */
  private generateId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }
}
