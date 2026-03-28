// example.ts

import { AgentConfig } from "./agent/types";
import { Agent } from "./agent/agent";
import { BasePlugin, PluginMetadata } from "./agent/plugins/types";

// 1. 自定义插件（使用 BasePlugin 简化）
class CustomLoggerPlugin extends BasePlugin {
  metadata: PluginMetadata = {
    name: "custom-logger",
    version: "1.0.0",
    description: "自定义日志插件",
    author: "Developer",
  };

  async onBeforeLoop(loop: any, input: string): Promise<void> {
    console.log(`[CustomLogger] 开始处理: ${input.substring(0, 50)}...`);
  }

  async onAfterLoop(loop: any, result: any): Promise<void> {
    console.log(`[CustomLogger] 处理完成: ${result.iterations} 次迭代`);
  }

  async onError(error: Error): Promise<void> {
    console.error(`[CustomLogger] 错误: ${error.message}`);
  }
}

// 2. 自定义响应修饰插件
class ResponseDecoratorPlugin extends BasePlugin {
  metadata: PluginMetadata = {
    name: "response-decorator",
    version: "1.0.0",
    description: "给回复添加装饰",
    author: "Developer",
  };

  async onModelResponse(response: any): Promise<any> {
    if (response.choices && response.choices[0]?.message?.content) {
      const originalContent = response.choices[0].message.content;
      response.choices[0].message.content = `✨ ${originalContent} ✨`;
    }
    return response;
  }
}

async function main() {
  const config: AgentConfig = {
    sessionId: `session_${Date.now()}`,
    userId: "user_001",
    modelConfig: {
      provider: "deepseek",
      model: "deepseek-chat",
      apiKey: process.env.DEEPSEEK_API_KEY!,
      temperature: 0.7,
    },
    toolConfig: {},
    workspaceDir: "./workspace",
    systemPrompt: "你是一个智能助手，帮助用户解决问题。",
  };

  // 创建 Agent
  const agent = new Agent(config);

  // 注册插件（在 init 之前）
  agent.registerPlugin(new CustomLoggerPlugin());
  agent.registerPlugin(new ResponseDecoratorPlugin());

  // 监听事件
  agent.on("agent_event", (event) => {
    console.log(`[${event.type}]`, event.data);
  });

  agent.on("tool_confirmation", ({ tool, params }) => {
    console.log(`需要确认: 调用工具 ${tool.name}`);
    // 这里可以弹窗询问用户
  });

  // 初始化
  await agent.init();

  // 运行
  const result = await agent.invoke("帮我分析今天的新闻");

  console.log("结果:", result.answer);
  console.log("迭代次数:", result.iterations);
  console.log("工具调用:", result.toolCalls);

  // 销毁
  await agent.destroy();
}

main().catch(console.error);
