// example.ts

import { AgentConfig } from "./agent/types";
import { Agent } from "./agent/agent";

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
  const result = await agent.run("帮我分析今天的新闻");

  console.log("结果:", result.answer);
  console.log("迭代次数:", result.iterations);
  console.log("工具调用:", result.toolCalls);

  // 销毁
  await agent.destroy();
}

main().catch(console.error);
