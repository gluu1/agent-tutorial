import { AgentWebSocketGateway } from "./server/websocketServer.js";
import { SSEServer } from "./server/sseServer.js";
import { AgentGatewayHandlers } from "./server/handlers.js";

async function main() {
  console.log("Agent Gateway started");
  // 创建处理器
  const handlers = new AgentGatewayHandlers({
    requiresAuth: false, // 开发环境不要求认证
  });

  // 启动 WebSocket 网关
  const wsGateway = new AgentWebSocketGateway(
    {
      port: 8080,
      host: "localhost",
      path: "/agent/ws",
      heartbeatInterval: 30000,
    },
    handlers,
  );

  await wsGateway.start();

  // 启动 SSE 服务
  const sseServer = new SSEServer({
    port: 8081,
    host: "localhost",
    path: "/agent/sse",
    handlers,
  });

  await sseServer.start();

  console.error("Agent Gateway started", sseServer.getConnectionCount());

  console.log("Agent Gateway started");
  console.log("WebSocket: ws://localhost:8080/agent/ws");
  console.log("SSE: http://localhost:8081/agent/sse");
}

main().catch(console.error);
