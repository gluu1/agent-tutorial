# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在此仓库中工作时提供指导。

## 语言规范

**默认使用中文回答** - 所有回答、注释、文档均使用中文，除非用户明确要求使用其他语言。

## 概述

这是一个用于学习 AI Agent 开发的教程仓库。代码展示了多种 Agent 模式，包括 ReAct、Plan-and-Execute、MCP 驱动 Agent 以及带插件系统的自定义 Agent 框架。文档主要使用中文编写。

## 项目结构

pnpm monorepo，包含三个主要应用和一个 packages 目录：

```
agent-tutorial/
├── apps/
│   ├── langchain/          # LangGraph-based agents (tsx run)
│   │   ├── index.ts        # Calculator agent (Ollama + custom tools)
│   │   ├── agent.ts        # ReAct agent (OpenAI + Tavily)
│   │   ├── fishing-agent/   # MCP-driven fishing advisor agent
│   │   └── email-agent/    # Email classification agent with human review
│   ├── openai/             # Basic OpenAI API + MCP integration
│   └── custom-agent/       # Custom ReAct agent with plugin system
│       ├── index.ts        # Entry point example
│       ├── agent/          # Core agent implementation
│       │   ├── agent-loop.ts    # ReAct loop
│       │   ├── types.ts         # TypeScript interfaces
│       │   ├── tools/registry.ts    # Tool executor & loader
│       │   ├── plugins/manager.ts    # Plugin lifecycle
│       │   ├── memory/threeTierMemory.ts  # 3-tier memory
│       │   └── context/optimizer.ts    # Context assembly
│       └── gateway/         # WebSocket/SSE gateway
├── packages/
│   ├── mcp-weather-server/ # MCP weather service
│   └── mcp-geocoding-server/ # MCP geocoding service
└── docs/                   # Chinese documentation
```

## 命令

```bash
# 安装依赖
pnpm install

# 运行应用
pnpm start:langchain   # LangGraph 计算器 Agent (Ollama)
pnpm start:openai      # OpenAI + Tavily Agent
pnpm start:custom-agent # 自定义 Agent (bun run index.ts)

# 运行特定的 langchain Agent
pnpm --filter langgraph-agent fishing-agent 深圳  # 钓鱼顾问

# 代码检查 (使用 biome)
npx @biomejs/biome check .
```

## 架构

### LangChain Agents (`apps/langchain/`)

三个 Agent 实现，展示不同模式：

1. **计算器 Agent** (`index.ts`): 使用 `Annotation.Root()` 自定义 `StateGraph`，扩展 `MessagesAnnotation`。为 `llmCalls` 自定义 reducer。使用 `@langchain/core/tools` 和 `zod` 定义工具。

2. **ReAct Agent** (`agent.ts`): 使用 `@langchain/langgraph/prebuilt` 中的 `createReactAgent`，配合 `MemorySaver` 检查点实现持久化。

3. **钓鱼 Agent** (`fishing-agent/`): 展示 MCP 集成。将 MCP 服务器作为子进程启动，通过 stdin/stdout 上的 JSON-RPC 动态加载工具。

### 自定义 Agent (`apps/custom-agent/`)

独立的 ReAct Agent 框架，具有：

- **ToolExecutor**: 基于注册表的工具系统，支持超时/重试/确认
- **ThreeTierMemoryManager**: 短期（滑动窗口）、会话摘要、长期（相似性搜索）
- **ContextAssembler**: 基于优先级的上下文组装，支持 token 限制
- **PluginManager**: 生命周期钩子 (`onInit`, `onBeforeLoop`, `onAfterLoop`, `onToolCall` 等)
- **AgentLoop**: 带指数退避重试的 ReAct 循环

工具定义模式：
```typescript
const tool: ToolDefinition = {
  name: "toolName",
  description: "What it does",
  parameters: { type: "object", properties: {...}, required: [...] },
  execute: async (params, context) => { /* ... */ },
  metadata?: { category, timeout, cost }
}
```

### MCP 服务器 (`packages/`)

使用 `@modelcontextprotocol/sdk` 的自定义 MCP 实现。每个都有 `index.ts`，导出带有工具定义的服务器实例。

## 关键依赖

| 包 | 用途 |
|---------|---------|
| `@langchain/langgraph` | 有状态 Agent 工作流 |
| `@langchain/ollama` | 本地 Ollama 模型 |
| `@langchain/openai` | OpenAI API |
| `@modelcontextprotocol/sdk` | MCP 协议 |
| `openai` | 直接调用 OpenAI API |
| `ws` | WebSocket 支持 |
| `@langchain/community` | 预置工具 (Tavily) |

## 前置条件

- **Ollama** 用于本地模型: `ollama serve` (运行在 http://127.0.0.1:11434)
- **API Keys** 通过环境变量:
  - `OPENAI_API_KEY` / `MINIMAX_API_KEY` - LLM 提供商
  - `TAVILY_API_KEY` - 搜索工具
  - `NEWS_API_KEY` - 新闻工具 (如已添加)

## 代码风格

- ES modules (import/export)
- TypeScript 严格模式
- Biome 格式化器 (biome.json 配置)
- Tab 缩进, LF 换行, 80 字符行宽
- 必须使用分号, 尾随逗号

## 项目规范

- 分支: `feature/xxx`, `fix/xxx`, `chore/xxx`
- 提交: `type(scope): description`
- 应用使用 `bun` 或 `tsx` 执行 TypeScript
