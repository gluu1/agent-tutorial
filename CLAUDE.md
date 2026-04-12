# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a tutorial repository for learning AI Agent development. The codebase demonstrates various agent patterns including ReAct, Plan-and-Execute, MCP-driven agents, and a custom agent framework with plugin system. Documentation is primarily in Chinese.

## Project Structure

pnpm monorepo with three main apps and a packages directory:

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

## Commands

```bash
# Install dependencies
pnpm install

# Run applications
pnpm start:langchain   # LangGraph calculator agent (Ollama)
pnpm start:openai      # OpenAI + Tavily agent
pnpm start:custom-agent # Custom agent (bun run index.ts)

# Run specific langchain agents
pnpm --filter langgraph-agent fishing-agent 深圳  # Fishing advisor

# Lint (uses biome)
npx @biomejs/biome check .
```

## Architecture

### LangChain Agents (`apps/langchain/`)

Three agent implementations demonstrating different patterns:

1. **Calculator Agent** (`index.ts`): Custom `StateGraph` with `Annotation.Root()` extending `MessagesAnnotation`. Custom reducers for `llmCalls`. Tools defined with `@langchain/core/tools` and `zod`.

2. **ReAct Agent** (`agent.ts`): Uses pre-built `createReactAgent` from `@langchain/langgraph/prebuilt` with `MemorySaver` checkpointer for persistence.

3. **Fishing Agent** (`fishing-agent/`): Demonstrates MCP integration. Spawns MCP servers as child processes, dynamically loads tools via JSON-RPC over stdin/stdout.

### Custom Agent (`apps/custom-agent/`)

A standalone ReAct agent framework with:

- **ToolExecutor**: Registry-based tool system, timeout/retry/confirmation support
- **ThreeTierMemoryManager**: Short-term (sliding window), Session summary, Long-term (similarity search)
- **ContextAssembler**: Priority-based context assembly with token limits
- **PluginManager**: Lifecycle hooks (`onInit`, `onBeforeLoop`, `onAfterLoop`, `onToolCall`, etc.)
- **AgentLoop**: ReAct loop with exponential backoff retry

Tool definition pattern:
```typescript
const tool: ToolDefinition = {
  name: "toolName",
  description: "What it does",
  parameters: { type: "object", properties: {...}, required: [...] },
  execute: async (params, context) => { /* ... */ },
  metadata?: { category, timeout, cost }
}
```

### MCP Servers (`packages/`)

Custom MCP implementations using `@modelcontextprotocol/sdk`. Each has an `index.ts` that exports a server instance with tool definitions.

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `@langchain/langgraph` | Stateful agent workflows |
| `@langchain/ollama` | Local Ollama model |
| `@langchain/openai` | OpenAI API |
| `@modelcontextprotocol/sdk` | MCP protocol |
| `openai` | Direct OpenAI API calls |
| `ws` | WebSocket support |
| `@langchain/community` | Pre-built tools (Tavily) |

## Prerequisites

- **Ollama** for local models: `ollama serve` (runs on http://127.0.0.1:11434)
- **API Keys** via environment variables:
  - `OPENAI_API_KEY` / `MINIMAX_API_KEY` - LLM provider
  - `TAVILY_API_KEY` - Search tool
  - `NEWS_API_KEY` - News tool (if added)

## Code Style

- ES modules (import/export)
- TypeScript strict mode
- Biome formatter (biome.json config)
- Tab indentation, LF line endings, 80 char line width
- Semicolons required, trailing commas

## Project Conventions

- Branch: `feature/xxx`, `fix/xxx`, `chore/xxx`
- Commit: `type(scope): description`
- Apps use `bun` or `tsx` for TypeScript execution
