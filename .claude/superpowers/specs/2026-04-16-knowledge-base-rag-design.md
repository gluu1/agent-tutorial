# 知识库 RAG 设计文档

## 概述

为 custom-agent 设计完整的外部知识库 RAG 系统，支持文档解析、分块、向量化、检索和上下文注入。

## 背景

项目需要增强 Agent 的知识问答能力。当用户询问与项目文档相关的问题时，Agent 应能准确检索并注入相关上下文，而非依赖自身知识「瞎答」。

## 设计决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 文档来源 | `docs/*.md` | 现有中文教程文档 |
| 嵌入模型 | MiniMax API | 与项目 LLM 供应商统一 |
| 向量存储 | SQLite | 本地持久化，重启不丢失 |
| 分块策略 | 层级分块（Header-based） | 保留文档结构，适合教程类文档 |
| 上下文注入 | 混合方案 | 预注入 + 工具调用结合 |

## 架构

```
docs/*.md
    │
    ▼
┌─────────────────────┐
│  DocumentProcessor   │  ← 解析 Markdown，提取标题层级
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│   HierarchicalChunker │  ← 按 ## 标题分块，保留层级结构
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│   EmbeddingService   │  ← MiniMax 嵌入 API
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│   VectorStore (SQLite) │  ← 持久化向量 + 元数据
└─────────────────────┘
           ▲
           │
┌──────────┴──────────┐
│  KnowledgeBaseManager │  ← 索引管理 / 检索入口
└──────────┬──────────┘
           │
    ┌──────┴──────┐
    ▼             ▼
┌─────────┐  ┌──────────────┐
│ Pre-inject│  │retrieveKnowledge│ (Tool)
└─────────┘  └──────────────┘
```

## 数据模型

### Chunk 接口

```typescript
interface Chunk {
  id: string;
  docId: string;          // 文档文件名
  titlePath: string;      // "文档标题 / ## 小节 / ### 子节"
  content: string;        // 文本内容
  headingLevel: number;   // 标题级别 (1-6)
  startLine: number;      // 起始行号
  tokenCount: number;
}
```

### SQLite 表结构

```sql
-- chunks: 文本块元数据
CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  title_path TEXT NOT NULL,
  content TEXT NOT NULL,
  heading_level INTEGER NOT NULL,
  start_line INTEGER NOT NULL,
  token_count INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- embeddings: 向量存储
CREATE TABLE embeddings (
  chunk_id TEXT PRIMARY KEY,
  embedding TEXT NOT NULL,  -- JSON 序列化数组
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (chunk_id) REFERENCES chunks(id)
);

-- documents: 文档索引记录
CREATE TABLE documents (
  doc_id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  file_hash TEXT NOT NULL,  -- 用于判断是否变更
  indexed_at INTEGER NOT NULL
);
```

## 核心组件

### 1. DocumentProcessor

职责：读取 Markdown 文件，解析标题层级结构

```typescript
class DocumentProcessor {
  async processFile(filePath: string): Promise<ParsedDocument>
  async scanDirectory(dirPath: string): Promise<ParsedDocument[]>
}

interface ParsedDocument {
  filePath: string;
  fileHash: string;
  sections: Array<{
    heading: string;      // 标题文本
    level: number;        // # 数量 1-6
    startLine: number;
    content: string;
  }>;
}
```

### 2. HierarchicalChunker

职责：按标题分块，单块过大时递归拆分

- 按 `##`（二级标题）为主要切分点
- 每个块保留 `titlePath` 上下文标签
- 单块 token 数超过 `maxChunkTokens`（默认 800）时，按段落递归拆分

```typescript
class HierarchicalChunker {
  constructor(private maxChunkTokens: number = 800) {}

  chunk(document: ParsedDocument): Chunk[]
}
```

### 3. EmbeddingService

职责：封装 MiniMax 嵌入 API

```typescript
class EmbeddingService {
  constructor(private apiKey: string, private baseURL?: string) {}

  async embed(texts: string[]): Promise<number[][]>
  async embedOne(text: string): Promise<number[]>
}
```

**API 调用**：
- 端点：`POST /v1/text/embeddings`
- 模型：`embo-01`
- 维度：1536

### 4. VectorStore

职责：SQLite 读写向量和元数据

```typescript
class VectorStore {
  constructor(private dbPath: string) {}

  async initialize(): Promise<void>
  async insertChunk(chunk: Chunk, embedding: number[]): Promise<void>
  async search(queryEmbedding: number[], topK: number, minScore: number): Promise<SearchResult[]>
  async isDocumentChanged(docId: string, fileHash: string): Promise<boolean>
  async deleteDocument(docId: string): Promise<void>
}

interface SearchResult {
  chunkId: string;
  docId: string;
  titlePath: string;
  content: string;
  score: number;
}
```

### 5. KnowledgeBaseManager

职责：统一管理索引和检索

```typescript
class KnowledgeBaseManager {
  constructor(
    private vectorStore: VectorStore,
    private chunker: HierarchicalChunker,
    private embeddingService: EmbeddingService
  ) {}

  // 全量索引
  async indexDirectory(dirPath: string): Promise<IndexResult>

  // 增量索引（仅更新变更文档）
  async indexIncremental(dirPath: string): Promise<IndexResult>

  // 检索
  async retrieve(query: string, topK?: number): Promise<SearchResult[]>

  // 清除文档
  async removeDocument(docId: string): Promise<void>
}

interface IndexResult {
  totalDocs: number;
  indexed: number;
  skipped: number;
  errors: string[];
}
```

## 上下文注入

### 方式A - 预注入（Session 初始化）

首次用户输入时，对 query 做快速检索，取 Top-3 相关块注入 `ContextAssembler.longTerm` 槽位。

### 方式B - 工具调用

```typescript
const retrieveKnowledgeTool: ToolDefinition = {
  name: "retrieveKnowledge",
  description: "检索知识库中与问题相关的文档片段",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "搜索query" },
      topK: { type: "number", description: "返回数量", default: 5 }
    },
    required: ["query"]
  },
  execute: async (params, context) => {
    const results = await kbManager.retrieve(params.query, params.topK);
    return formatAsContext(results);
  }
}
```

## 文件结构

```
apps/custom-agent/agent/
├── memory/
│   └── threeTierMemory.ts        ← 现有
├── knowledge/
│   ├── types.ts                  ← Chunk, SearchResult, IndexResult
│   ├── DocumentProcessor.ts      ← Markdown 解析
│   ├── HierarchicalChunker.ts    ← 层级分块
│   ├── EmbeddingService.ts       ← MiniMax API
│   ├── VectorStore.ts            ← SQLite 操作
│   ├── KnowledgeBaseManager.ts   ← 核心管理器
│   └── index.ts                 ← 导出统一接口
```

## 错误处理

| 场景 | 处理 |
|------|------|
| 嵌入 API 超时 | 重试 3 次，指数退避 (1s, 2s, 4s) |
| SQLite 写入失败 | 回滚事务，记录错误日志 |
| 检索无结果 | 返回空数组，不阻塞 Agent |
| 文档解析失败 | 跳过该文件，继续处理其他 |
| 文档内容未变 | 跳过索引，提升性能 |

## 后续扩展

### 动态上传（预留接口）

```typescript
interface KnowledgeBaseManager {
  // 预留：用户上传文件
  async addDocuments(files: Array<{ name: string; content: string }>): Promise<IndexResult>
}
```

流程：接收上传的 Markdown/TXT → 走相同分块 → 嵌入 → 存储到同一 SQLite。

## 依赖

| 依赖 | 用途 |
|------|------|
| `better-sqlite3` | SQLite 操作 |
| MiniMax API | 嵌入向量生成 |
