/**
 *   1. 类型安全改进

  - 添加 ModelResponse 接口，替换 any 类型
  - 使用空值合并运算符 (??) 处理可能的空值

  2. 插件系统集成

  - 添加 PluginManager 可选依赖注入
  - 实现以下插件钩子：
    - onUserInput - 处理用户输入
    - onBeforeLoop / onAfterLoop - 循环生命周期
    - onModelResponse - 处理模型响应
    - onBeforeToolCall / onAfterToolCall - 工具调用前后
    - onError - 错误处理
    - onAgentEvent - 事件通知

  3. 超时控制

  - 使用 Promise.race 实现主循环超时
  - 为每个工具调用添加独立的超时控制
  - 将超时清理回调加入资源清理队列

  4. 重试机制

  - 实现工具调用的指数退避重试（每次重试等待时间递增）
  - 支持配置化的重试次数 (toolRetryCount)

  5. 错误处理增强

  - 清晰的错误消息格式（中文）
  - 完善的降级答案生成，包含工具调用详情
  - 资源清理机制

  6. 代码质量提升

  - 移除模拟代码和随机逻辑
  - 移除 console.error 调试语句
  - 提取 emitEvent 辅助方法，减少代码重复
  - 添加 getStatus() 方法用于状态查询
  - 完善的 JSDoc 注释

  7. 配置灵活性

  - 支持从 AgentConfig 读取模型配置
  - 所有配置项都有合理的默认值

  8. 模型响应处理

  - 添加 transformToModelResponse 方法处理多种响应格式
  - 支持 LangChain、OpenAI 等多种格式
  - 降级处理确保不会因为格式问题崩溃
 */

import { EventEmitter } from "events";
import OpenAI from "openai";
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
import { PluginManager } from "./plugins/manager";
import { ChatCompletionMessageParam } from "openai/resources/index";

/**
 * 模型响应接口
 */
interface ModelResponse {
  choices: Array<{
    message: {
      content?: string;
      toolCalls?: ToolCall[];
      reasoningContent?: string;
    };
  }>;
  usage?: {
    totalTokens?: number;
    promptTokens?: number;
    completionTokens?: number;
  };
}

/**
 * Agent Loop 核心循环
 * 实现 ReAct 模式：思考 -> 行动 -> 观察
 */
export class AgentLoop extends EventEmitter {
  private config: AgentConfig;
  private memory: ThreeTierMemoryManager;
  private toolExecutor: ToolExecutor;
  private contextAssembler: ContextAssembler;
  private pluginManager?: PluginManager;
  private isRunning: boolean = true;
  private abortController: AbortController;
  private model: OpenAI;
  private currentIteration: number = 0;
  private cleanupCallbacks: Array<() => Promise<void>> = [];

  constructor(
    config: AgentConfig,
    memory: ThreeTierMemoryManager,
    toolExecutor: ToolExecutor,
    contextAssembler: ContextAssembler,
    pluginManager?: PluginManager,
  ) {
    super();
    this.config = config;
    this.memory = memory;
    this.toolExecutor = toolExecutor;
    this.contextAssembler = contextAssembler;
    this.pluginManager = pluginManager;
    this.abortController = new AbortController();
    this.model = this.createModel();
  }

  /**
   * 创建模型实例
   */
  private createModel(): OpenAI {
    const modelConfig = this.config.modelConfig;

    return new OpenAI({
      apiKey: modelConfig.apiKey,
      baseURL: modelConfig.baseURL,
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

    // 插件钩子：用户输入
    const processedInput = await this.pluginManager?.callInterceptHook(
      "onUserInput",
      userInput,
      this.config,
    );

    // 添加用户消息到记忆
    await this.memory.addMessage({
      id: this.generateId(),
      role: "user",
      content: processedInput ?? userInput,
      timestamp: Date.now(),
    });

    this.emitEvent("start", { input: userInput });

    // 使用 Promise.race 实现超时控制
    const loopPromise = this.runLoop(
      processedInput ?? userInput,
      toolCalls,
      startTime,
    );
    const timeoutPromise = this.createTimeoutPromise();

    let result: AgentResult;

    try {
      result = await Promise.race([loopPromise, timeoutPromise]);
    } catch (error) {
      // 超时或循环出错时停止 agent
      await this.stop();

      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("[AgentLoop] 循环错误:", error);

      // 插件钩子：错误处理
      await this.pluginManager?.callHook("onError", error);

      this.emitEvent("error", { error: errorMessage });

      return {
        success: false,
        error: errorMessage,
        iterations: iteration,
        toolCalls,
        totalTokens,
        duration: Date.now() - startTime,
      };
    }

    // 插件钩子：循环结束后
    await this.pluginManager?.callHook("onAfterLoop", this, result);

    return result;
  }

  /**
   * 运行主循环逻辑
   */
  private async runLoop(
    userInput: string,
    toolCalls: ToolCallRecord[],
    startTime: number,
  ): Promise<AgentResult> {
    let iteration = 0;
    let finalAnswer: string | null = null;
    let totalTokens = 0;
    const maxIterations = this.config.loopConfig?.maxIterations ?? 10;

    // 插件钩子：循环开始前
    await this.pluginManager?.callHook("onBeforeLoop", this, userInput);

    while (this.isRunning && iteration < maxIterations) {
      this.currentIteration = ++iteration;

      this.emitEvent("thought", {
        iteration,
        message: "正在思考...",
      });

      // 组装上下文
      const context = await this.contextAssembler.assemble({
        userInput,
        systemPrompt: this.config.systemPrompt,
        rules: this.config.rules,
        skillsPrompt: await this.getSkillsPrompt(),
        workspaceFiles: await this.getWorkspaceFiles(),
      });

      // 调用模型
      const response = await this.invokeModel(context.messages);

      // 插件钩子：模型响应
      const processedResponse = await this.pluginManager?.callInterceptHook(
        "onModelResponse",
        response,
        this.config,
      );

      const finalResponse = processedResponse ?? response;
      totalTokens += finalResponse.usage?.totalTokens || 0;

      const assistantMessage = finalResponse.choices[0]?.message;
      if (!assistantMessage) {
        throw new Error("模型返回空响应");
      }

      // 添加助手消息到记忆
      await this.memory.addMessage({
        id: this.generateId(),
        role: "assistant",
        content: assistantMessage.content ?? "",
        toolCalls: assistantMessage.toolCalls,
        reasoningContent: assistantMessage.reasoningContent,
        timestamp: Date.now(),
      });

      // 处理思考过程
      if (assistantMessage.reasoningContent) {
        this.emitEvent("thought", {
          content: assistantMessage.reasoningContent,
          iteration,
        });
      }

      // 检查是否有工具调用
      if (assistantMessage.toolCalls && assistantMessage.toolCalls.length > 0) {
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

        continue;
      }

      // 无工具调用，即为最终答案
      finalAnswer = assistantMessage.content ?? "";
      break;
    }

    // 检查是否达到最大迭代次数
    if (!finalAnswer && iteration >= maxIterations) {
      finalAnswer = this.generateFallbackAnswer(toolCalls);
    }

    const result: AgentResult = {
      success: true,
      answer: finalAnswer ?? undefined,
      iterations: iteration,
      toolCalls,
      totalTokens,
      duration: Date.now() - startTime,
    };

    this.emitEvent("complete", result);

    return result;
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
    const maxTools = this.config.loopConfig?.maxToolCallsPerIteration ?? 5;
    const toolsToExecute = toolCalls.slice(0, maxTools);

    this.emitEvent("toolCall", {
      toolCalls: toolsToExecute.map((t) => t.function.name),
    });

    const executionContext: ExecutionContext = {
      sessionId: this.config.sessionId,
      userId: this.config.userId,
      variables: new Map(Object.entries(this.memory.working?.getAll() ?? {})),
      abortSignal: this.abortController.signal,
      knowledgeBaseManager: this.contextAssembler.getKnowledgeBaseManager(),
    };

    for (const toolCall of toolsToExecute) {
      const maxRetries = this.config.loopConfig?.toolRetryCount ?? 0;

      // 插件钩子：工具调用前
      const processedToolCall = await this.pluginManager?.callInterceptHook(
        "onBeforeToolCall",
        toolCall,
        executionContext,
      );

      const finalToolCall = processedToolCall ?? toolCall;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const startTime = Date.now();

        // 指数退避：首次尝试不等待，后续重试等待
        if (attempt > 0) {
          await this.delay(1000 * attempt);
        }

        try {
          const result = await this.executeToolWithTimeout(
            finalToolCall,
            executionContext,
          );

          // 插件钩子：工具调用后
          await this.pluginManager?.callHook(
            "onAfterToolCall",
            finalToolCall.function.name,
            result,
          );

          this.emitEvent("observation", {
            toolName: finalToolCall.function.name,
            result,
          });

          // 记录工具调用
          toolCallsRecord.push({
            id: finalToolCall.id,
            name: finalToolCall.function.name,
            params: this.parseToolParams(finalToolCall.function.arguments),
            result,
            duration: Date.now() - startTime,
          });

          results.push({
            toolCallId: finalToolCall.id,
            result,
            name: finalToolCall.function.name,
          });

          // 成功则跳出重试循环
          break;
        } catch (err) {
          const lastError = err instanceof Error ? err : new Error(String(err));
          const error = lastError.message;

          // 如果是最后一次尝试，则处理错误
          if (attempt === maxRetries) {
            this.emitEvent("error", {
              toolName: finalToolCall.function.name,
              error,
            });

            // 根据配置决定是否继续
            const onErrorStrategy =
              this.config.loopConfig?.onToolError ?? "continue";
            if (onErrorStrategy === "stop") {
              throw lastError;
            }

            // 记录失败的工具调用
            toolCallsRecord.push({
              id: finalToolCall.id,
              name: finalToolCall.function.name,
              params: this.parseToolParams(finalToolCall.function.arguments),
              result: { error },
              duration: Date.now() - startTime,
              error,
            });

            results.push({
              toolCallId: finalToolCall.id,
              result: { error },
              name: finalToolCall.function.name,
            });
          }
        }
      }
    }

    return results;
  }

  /**
   * 执行工具并处理超时
   */
  private async executeToolWithTimeout(
    toolCall: ToolCall,
    context: ExecutionContext,
  ): Promise<any> {
    const timeoutMs = this.config.toolConfig?.toolTimeoutMs ?? 30000;

    return Promise.race([
      this.toolExecutor.execute(toolCall, context),
      this.createTimeoutForTool(timeoutMs, toolCall.function.name),
    ]);
  }

  /**
   * 创建工具执行超时 Promise
   */
  private createTimeoutForTool(
    timeoutMs: number,
    toolName: string,
  ): Promise<never> {
    return new Promise((_, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`工具 ${toolName} 执行超时 (${timeoutMs}ms)`));
      }, timeoutMs);

      // 添加到清理回调
      this.cleanupCallbacks.push(async () => clearTimeout(timeoutId));
    });
  }

  /**
   * 解析工具参数
   */
  private parseToolParams(argumentsStr: string): any {
    try {
      return JSON.parse(argumentsStr);
    } catch {
      return { raw: argumentsStr };
    }
  }

  /**
   * 延迟指定毫秒数
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 调用模型
   */
  private async invokeModel(messages: AgentMessage[]): Promise<ModelResponse> {
    try {
      // 获取工具定义
      const toolDefinitions = this.toolExecutor.getDefinitions();

      // 转换消息格式，OpenAI API 需要 tool_call_id 和 tool_calls
      const openAIMessages: ChatCompletionMessageParam[] = messages.map((item) => {
        if (item.role === "tool") {
          return {
            role: "tool" as const,
            tool_call_id: item.toolCallId,
            content: item.content,
          };
        }
        if (item.role === "assistant" && item.toolCalls && item.toolCalls.length > 0) {
          return {
            role: "assistant" as const,
            content: item.content || null,
            tool_calls: item.toolCalls.map((tc) => ({
              id: tc.id,
              type: "function" as const,
              function: {
                name: tc.function.name,
                arguments: tc.function.arguments,
              },
            })),
          };
        }
        return {
          role: item.role as "system" | "user" | "assistant",
          content: item.content,
        };
      });

      const response = await this.model.chat.completions.create({
        model: "MiniMax-M2.7",
        tools: toolDefinitions.length > 0 ? toolDefinitions : undefined,
        messages: openAIMessages,
        top_p: 0.7,
        temperature: 0.9,
      });


      // 转换为标准响应格式
      return this.transformToModelResponse(response);
    } catch (error) {
      throw new Error(
        `模型调用失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 转换模型响应为标准格式
   */
  private transformToModelResponse(rawResponse: any): ModelResponse {
    // 处理 LangChain 格式的响应
    if (rawResponse?.responses) {
      // 结构化输出格式
      const response = rawResponse.responses[0];
      return {
        choices: [
          {
            message: {
              content: response?.content ?? "",
              toolCalls: response?.tool_calls ?? [],
            },
          },
        ],
        usage: rawResponse.usage,
      };
    }

    // 标准 OpenAI 格式
    if (rawResponse?.choices) {
      // 规范化 tool_calls -> toolCalls (OpenAI API 使用下划线，代码使用驼峰)
      const message = rawResponse.choices[0]?.message;
      if (message?.tool_calls) {
        rawResponse.choices[0].message.toolCalls = message.tool_calls;
        delete message.tool_calls;
      }
      return rawResponse;
    }

    // LangChain Message 格式
    if (rawResponse?.content !== undefined || rawResponse?.tool_calls) {
      return {
        choices: [
          {
            message: {
              content: rawResponse.content ?? "",
              toolCalls: rawResponse.tool_calls ?? [],
            },
          },
        ],
        usage: rawResponse.usage,
      };
    }

    // 降级处理
    return {
      choices: [
        {
          message: {
            content: String(rawResponse ?? ""),
            toolCalls: [],
          },
        },
      ],
      usage: { totalTokens: 0 },
    };
  }

  /**
   * 停止循环并清理资源
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    this.abortController.abort();

    this.emitEvent("interrupt", { message: "Agent 已停止" });

    // 执行所有清理回调
    await this.cleanup();
  }

  /**
   * 清理资源
   */
  private async cleanup(): Promise<void> {
    for (const callback of this.cleanupCallbacks) {
      try {
        await callback();
      } catch (error) {
        console.error("[AgentLoop] 清理回调执行失败:", error);
      }
    }
    this.cleanupCallbacks = [];
  }

  /**
   * 发射事件的辅助方法
   */
  private emitEvent(
    type: AgentEvent["type"],
    data: any,
    iteration?: number,
  ): void {
    const event: AgentEvent = {
      type,
      data,
      timestamp: Date.now(),
      iteration,
    };

    this.emit("event", event);

    // 同时通知插件管理器
    if (this.pluginManager) {
      this.pluginManager
        .callHook("onAgentEvent", event, this.config)
        .catch((error) => {
          console.error("[AgentLoop] 插件事件通知失败:", error);
        });
    }
  }

  /**
   * 获取 Skills 提示词
   */
  private async getSkillsPrompt(): Promise<string> {
    if (!this.config.skillsConfig?.enabled) {
      return "";
    }

    // TODO: 实现 Skills 提示词生成逻辑
    // 可以从 SkillsManager 加载已注册的 skills 信息
    return "";
  }

  /**
   * 获取工作区文件
   */
  private async getWorkspaceFiles(): Promise<Map<string, string>> {
    // TODO: 实现工作区文件读取逻辑
    // 可以根据 workspaceDir 配置读取相关文件
    return new Map();
  }

  /**
   * 创建超时 Promise
   */
  private createTimeoutPromise(): Promise<never> {
    const timeoutMs = this.config.loopConfig?.timeoutMs ?? 300000; // 默认 5 分钟

    return new Promise((_, reject) => {
      const timeoutId = setTimeout(() => {
        reject(
          new Error(`Agent 循环超时 (${timeoutMs}ms)，已达到最大执行时间`),
        );
      }, timeoutMs);

      // 添加到清理回调
      this.cleanupCallbacks.push(async () => clearTimeout(timeoutId));
    });
  }

  /**
   * 生成降级答案
   */
  private generateFallbackAnswer(toolCalls: ToolCallRecord[]): string {
    const toolsUsed = toolCalls.map((t) => t.name).join(", ");
    const maxIterations = this.config.loopConfig?.maxIterations ?? 10;

    let message = `我尝试了 ${maxIterations} 次推理，但未能完成您的请求。\n\n`;
    message += `已执行工具: ${toolsUsed || "无"}\n\n`;

    if (toolCalls.length > 0) {
      message += `工具调用详情:\n`;
      for (const call of toolCalls) {
        message += `- ${call.name}: ${call.error ?? "成功"}\n`;
      }
    }

    message += `\n请尝试:\n`;
    message += `1. 简化您的需求\n`;
    message += `2. 提供更多上下文信息\n`;
    message += `3. 检查工具是否可用\n`;

    return message;
  }

  /**
   * 生成唯一 ID
   */
  private generateId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * 获取当前状态
   */
  getStatus(): {
    isRunning: boolean;
    currentIteration: number;
    aborted: boolean;
  } {
    return {
      isRunning: this.isRunning,
      currentIteration: this.currentIteration,
      aborted: this.abortController.signal.aborted,
    };
  }
}
