# 知识库 RAG 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 custom-agent 实现完整的知识库 RAG 系统，支持文档解析、分块、向量化、检索和上下文注入。

**Architecture:** 管道式架构：DocumentProcessor → HierarchicalChunker → EmbeddingService → VectorStore(SQLite)，由 KnowledgeBaseManager 统一管理。上下文注入采用混合方案：预注入 + retrieveKnowledge 工具。

**Tech Stack:** TypeScript, better-sqlite3, MiniMax Embedding API

---

## 文件结构

```
apps/custom-agent/agent/
├── knowledge/
│   ├── types.ts                  ← Chunk, SearchResult, IndexResult, ParsedDocument
│   ├── DocumentProcessor.ts      ← Markdown 解析，提取标题层级
│   ├── HierarchicalChunker.ts    ← 层级分块
│   ├── EmbeddingService.ts       ← MiniMax 嵌入 API
│   ├── VectorStore.ts            ← SQLite CRUD
│   ├── KnowledgeBaseManager.ts   ← 索引 + 检索入口
│   └── index.ts                 ← 导出统一接口
├── tools/
│   └── registry.ts              ← 修改：注册 retrieveKnowledge 工具
├── context/
│   └── optimizer.ts             ← 修改：集成知识库预注入
└── types.ts                     ← 修改：添加相关类型
```

**需要新增依赖**：`better-sqlite3`

---

## Task 1: 添加类型定义

**Files:**
- Create: `apps/custom-agent/agent/knowledge/types.ts`
- Modify: `apps/custom-agent/agent/types.ts`

- [ ] **Step 1: 创建 knowledge/types.ts**

```typescript
// knowledge/types.ts

/**
 * 解析后的文档
 */
export interface ParsedDocument {
  filePath: string;
  fileHash: string;
  sections: DocumentSection[];
}

/**
 * 文档章节
 */
export interface DocumentSection {
  heading: string;
  level: number;       // 1-6 (# 数量)
  startLine: number;
  content: string;
}

/**
 * 知识库文本块
 */
export interface Chunk {
  id: string;
  docId: string;
  titlePath: string;
  content: string;
  headingLevel: number;
  startLine: number;
  tokenCount: number;
}

/**
 * 检索结果
 */
export interface SearchResult {
  chunkId: string;
  docId: string;
  titlePath: string;
  content: string;
  score: number;
}

/**
 * 索引结果
 */
export interface IndexResult {
  totalDocs: number;
  indexed: number;
  skipped: number;
  errors: string[];
}
```

- [ ] **Step 2: 在 agent/types.ts 添加 EmbeddingConfig**

在 `MemoryConfig` 后添加：

```typescript
/**
 * 知识库配置
 */
export interface KnowledgeBaseConfig {
  enabled: boolean;
  docsPath: string;           // 文档目录，如 "docs/"
  dbPath: string;             // SQLite 路径，如 "data/knowledge.db"
  embeddingApiKey?: string;   // 嵌入 API Key，不填则用 modelConfig 的
  embeddingBaseURL?: string;
  chunkTokenLimit: number;    // 默认 800
  retrievalTopK: number;      // 默认 5
  minScore: number;           // 默认 0.6
}
```

- [ ] **Step 3: 提交**

```bash
git add apps/custom-agent/agent/knowledge/types.ts apps/custom-agent/agent/types.ts
git commit -m "feat: 添加知识库 RAG 类型定义"
```

---

## Task 2: 实现 DocumentProcessor

**Files:**
- Create: `apps/custom-agent/agent/knowledge/DocumentProcessor.ts`

- [ ] **Step 1: 创建 DocumentProcessor.ts**

```typescript
// knowledge/DocumentProcessor.ts

import { ParsedDocument, DocumentSection } from "./types";
import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";

/**
 * Markdown 文档处理器
 * 解析 Markdown 文件，提取标题层级结构
 */
export class DocumentProcessor {
  /**
   * 处理单个文件
   */
  async processFile(filePath: string): Promise<ParsedDocument> {
    const content = await fs.readFile(filePath, "utf-8");
    const fileHash = this.computeHash(content);
    const sections = this.parseSections(content);

    return {
      filePath,
      fileHash,
      sections,
    };
  }

  /**
   * 扫描目录，获取所有 Markdown 文件
   */
  async scanDirectory(dirPath: string): Promise<string[]> {
    const files: string[] = [];

    async function walk(dir: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith(".")) {
          await walk(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          files.push(fullPath);
        }
      }
    }

    await walk(dirPath);
    return files;
  }

  /**
   * 解析 Markdown 内容，提取章节
   */
  private parseSections(content: string): DocumentSection[] {
    const sections: DocumentSection[] = [];
    const lines = content.split("\n");

    let currentSection: DocumentSection | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

      if (headingMatch) {
        // 保存上一个 section
        if (currentSection) {
          currentSection.content = currentSection.content.trim();
        }

        // 开始新 section
        currentSection = {
          heading: headingMatch[2].trim(),
          level: headingMatch[1].length,
          startLine: i + 1,
          content: "",
        };
        sections.push(currentSection);
      } else if (currentSection) {
        currentSection.content += line + "\n";
      }
    }

    // 处理最后一个 section
    if (currentSection) {
      currentSection.content = currentSection.content.trim();
    }

    return sections;
  }

  /**
   * 计算文件内容 hash
   */
  private computeHash(content: string): string {
    return crypto.createHash("md5").update(content).digest("hex");
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add apps/custom-agent/agent/knowledge/DocumentProcessor.ts
git commit -m "feat: 实现 DocumentProcessor Markdown 解析"
```

---

## Task 3: 实现 HierarchicalChunker

**Files:**
- Create: `apps/custom-agent/agent/knowledge/HierarchicalChunker.ts`

- [ ] **Step 1: 创建 HierarchicalChunker.ts**

```typescript
// knowledge/HierarchicalChunker.ts

import { ParsedDocument, Chunk, DocumentSection } from "./types";

/**
 * 层级分块器
 * 按 ## 标题分块，保留层级结构
 */
export class HierarchicalChunker {
  constructor(private maxChunkTokens: number = 800) {}

  /**
   * 将文档分块
   */
  chunk(document: ParsedDocument): Chunk[] {
    const chunks: Chunk[] = [];
    const docId = this.getDocId(document.filePath);

    // 构建标题路径栈
    const headingStack: Array<{ heading: string; level: number }> = [];

    for (const section of document.sections) {
      // 维护标题栈
      while (
        headingStack.length > 0 &&
        headingStack[headingStack.length - 1].level >= section.level
      ) {
        headingStack.pop();
      }
      headingStack.push({ heading: section.heading, level: section.level });

      // 构建 titlePath
      const titlePath = headingStack.map((h) => h.heading).join(" / ");

      // 检查内容是否超过限制
      const contentTokens = this.estimateTokens(section.content);

      if (contentTokens <= this.maxChunkTokens) {
        // 单块可直接添加
        chunks.push({
          id: this.generateId(),
          docId,
          titlePath,
          content: section.content,
          headingLevel: section.level,
          startLine: section.startLine,
          tokenCount: contentTokens,
        });
      } else {
        // 递归拆分段落
        const subChunks = this.splitByParagraphs(
          section.content,
          docId,
          titlePath,
          section.level,
          section.startLine,
        );
        chunks.push(...subChunks);
      }
    }

    return chunks;
  }

  /**
   * 按段落递归拆分
   */
  private splitByParagraphs(
    content: string,
    docId: string,
    titlePath: string,
    headingLevel: number,
    startLine: number,
  ): Chunk[] {
    const chunks: Chunk[] = [];
    const paragraphs = content.split(/\n\n+/);

    let currentChunk = "";
    let currentLines = 0;
    let currentStartLine = startLine;

    for (const para of paragraphs) {
      const paraTokens = this.estimateTokens(para);
      const paraLines = para.split("\n").length;

      if (this.estimateTokens(currentChunk) + paraTokens <= this.maxChunkTokens) {
        currentChunk += para + "\n\n";
        currentLines += paraLines;
      } else {
        if (currentChunk.trim()) {
          chunks.push({
            id: this.generateId(),
            docId,
            titlePath,
            content: currentChunk.trim(),
            headingLevel,
            startLine: currentStartLine,
            tokenCount: this.estimateTokens(currentChunk.trim()),
          });
        }

        currentChunk = para + "\n\n";
        currentStartLine = startLine + currentLines;
        currentLines = paraLines;
      }
    }

    // 添加最后一块
    if (currentChunk.trim()) {
      chunks.push({
        id: this.generateId(),
        docId,
        titlePath,
        content: currentChunk.trim(),
        headingLevel,
        startLine: currentStartLine,
        tokenCount: this.estimateTokens(currentChunk.trim()),
      });
    }

    return chunks;
  }

  /**
   * 估算 token 数量
   * 中文: 2 tokens/字，英文: 4 tokens/词
   */
  private estimateTokens(text: string): number {
    const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const english = (text.match(/[a-zA-Z]/g) || []).length;
    return chinese * 2 + english / 4;
  }

  /**
   * 从文件路径提取 docId
   */
  private getDocId(filePath: string): string {
    const filename = filePath.split(/[/\\]/).pop() || filePath;
    return filename.replace(/\.md$/, "");
  }

  /**
   * 生成唯一 ID
   */
  private generateId(): string {
    return `chunk_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add apps/custom-agent/agent/knowledge/HierarchicalChunker.ts
git commit -m "feat: 实现 HierarchicalChunker 层级分块"
```

---

## Task 4: 实现 EmbeddingService

**Files:**
- Create: `apps/custom-agent/agent/knowledge/EmbeddingService.ts`

- [ ] **Step 1: 创建 EmbeddingService.ts**

```typescript
// knowledge/EmbeddingService.ts

/**
 * MiniMax 嵌入服务
 */
export class EmbeddingService {
  private apiKey: string;
  private baseURL: string;

  constructor(apiKey: string, baseURL: string = "https://api.minimax.chat") {
    this.apiKey = apiKey;
    this.baseURL = baseURL;
  }

  /**
   * 批量嵌入文本
   */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const response = await this.requestWithRetry<EmbeddingResponse>({
      url: `${this.baseURL}/v1/text/embeddings`,
      method: "POST",
      body: {
        model: "embo-01",
        texts: texts,
      },
    });

    return response.embeddings.map((e) => e.embedding);
  }

  /**
   * 单条嵌入
   */
  async embedOne(text: string): Promise<number[]> {
    const results = await this.embed([text]);
    return results[0] || [];
  }

  /**
   * 带重试的请求
   */
  private async requestWithRetry<T>(
    options: RequestOptions,
    retries: number = 3,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let i = 0; i < retries; i++) {
      try {
        return await this.request<T>(options);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (i < retries - 1) {
          // 指数退避: 1s, 2s, 4s
          await this.delay(1000 * Math.pow(2, i));
        }
      }
    }

    throw lastError || new Error("Embedding request failed");
  }

  private request<T>(options: RequestOptions): Promise<T> {
    return new Promise((resolve, reject) => {
      const { url, method, body } = options;

      const chunks: Buffer[] = [];
      const https = require("https");
      const urlObj = new URL(url);

      const req = https.request(
        {
          hostname: urlObj.hostname,
          port: urlObj.port,
          path: urlObj.pathname,
          method,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
        },
        (res: any) => {
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            try {
              const data = JSON.parse(Buffer.concat(chunks).toString());
              if (res.statusCode >= 200 && res.statusCode < 300) {
                resolve(data);
              } else {
                reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(data)}`));
              }
            } catch {
              reject(new Error("Failed to parse response"));
            }
          });
        },
      );

      req.on("error", reject);
      req.write(JSON.stringify(body));
      req.end();
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

interface RequestOptions {
  url: string;
  method: string;
  body: any;
}

interface EmbeddingResponse {
  embeddings: Array<{ embedding: number[] }>;
}
```

- [ ] **Step 2: 提交**

```bash
git add apps/custom-agent/agent/knowledge/EmbeddingService.ts
git commit -m "feat: 实现 EmbeddingService MiniMax API 封装"
```

---

## Task 5: 实现 VectorStore

**Files:**
- Create: `apps/custom-agent/agent/knowledge/VectorStore.ts`

- [ ] **Step 1: 创建 VectorStore.ts**

```typescript
// knowledge/VectorStore.ts

import Database from "better-sqlite3";
import { Chunk, SearchResult } from "./types";

/**
 * SQLite 向量存储
 */
export class VectorStore {
  private db: Database.Database;

  constructor(private dbPath: string) {
    this.db = new Database(dbPath);
    // 启用 WAL 模式提升性能
    this.db.pragma("journal_mode = WAL");
  }

  /**
   * 初始化数据库表
   */
  async initialize(): Promise<void> {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        doc_id TEXT NOT NULL,
        title_path TEXT NOT NULL,
        content TEXT NOT NULL,
        heading_level INTEGER NOT NULL,
        start_line INTEGER NOT NULL,
        token_count INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS embeddings (
        chunk_id TEXT PRIMARY KEY,
        embedding TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (chunk_id) REFERENCES chunks(id)
      );

      CREATE TABLE IF NOT EXISTS documents (
        doc_id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        file_hash TEXT NOT NULL,
        indexed_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_chunks_doc_id ON chunks(doc_id);
      CREATE INDEX IF NOT EXISTS idx_embeddings_chunk_id ON embeddings(chunk_id);
    `);
  }

  /**
   * 插入 chunk 和 embedding
   */
  async insertChunk(chunk: Chunk, embedding: number[]): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO chunks (id, doc_id, title_path, content, heading_level, start_line, token_count, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const embedStmt = this.db.prepare(`
      INSERT OR REPLACE INTO embeddings (chunk_id, embedding, updated_at)
      VALUES (?, ?, ?)
    `);

    const now = Date.now();
    const transaction = this.db.transaction(() => {
      stmt.run(
        chunk.id,
        chunk.docId,
        chunk.titlePath,
        chunk.content,
        chunk.headingLevel,
        chunk.startLine,
        chunk.tokenCount,
        now,
      );
      embedStmt.run(chunk.id, JSON.stringify(embedding), now);
    });

    transaction();
  }

  /**
   * 搜索相似块
   */
  async search(
    queryEmbedding: number[],
    topK: number,
    minScore: number,
  ): Promise<SearchResult[]> {
    const chunks = this.db
      .prepare(
        `
      SELECT c.id, c.doc_id, c.title_path, c.content, e.embedding
      FROM chunks c
      JOIN embeddings e ON c.id = e.chunk_id
    `,
      )
      .all() as Array<{
      id: string;
      doc_id: string;
      title_path: string;
      content: string;
      embedding: string;
    }>;

    // 计算余弦相似度并排序
    const results: SearchResult[] = [];

    for (const row of chunks) {
      const embedding = JSON.parse(row.embedding) as number[];
      const score = this.cosineSimilarity(queryEmbedding, embedding);

      if (score >= minScore) {
        results.push({
          chunkId: row.id,
          docId: row.doc_id,
          titlePath: row.title_path,
          content: row.content,
          score,
        });
      }
    }

    // 排序并取 TopK
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  /**
   * 检查文档是否变更
   */
  async isDocumentChanged(docId: string, fileHash: string): Promise<boolean> {
    const row = this.db
      .prepare("SELECT file_hash FROM documents WHERE doc_id = ?")
      .get(docId) as { file_hash: string } | undefined;

    return !row || row.file_hash !== fileHash;
  }

  /**
   * 更新文档记录
   */
  async upsertDocument(
    docId: string,
    filePath: string,
    fileHash: string,
  ): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO documents (doc_id, file_path, file_hash, indexed_at)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(docId, filePath, fileHash, Date.now());
  }

  /**
   * 删除文档及其 chunks
   */
  async deleteDocument(docId: string): Promise<void> {
    const transaction = this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM embeddings WHERE chunk_id IN (SELECT id FROM chunks WHERE doc_id = ?)")
        .run(docId);
      this.db.prepare("DELETE FROM chunks WHERE doc_id = ?").run(docId);
      this.db.prepare("DELETE FROM documents WHERE doc_id = ?").run(docId);
    });
    transaction();
  }

  /**
   * 获取所有文档 ID
   */
  getAllDocIds(): string[] {
    const rows = this.db.prepare("SELECT doc_id FROM documents").all() as Array<{
      doc_id: string;
    }>;
    return rows.map((r) => r.doc_id);
  }

  /**
   * 计算余弦相似度
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-10);
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add apps/custom-agent/agent/knowledge/VectorStore.ts
git commit -m "feat: 实现 VectorStore SQLite 向量存储"
```

---

## Task 6: 实现 KnowledgeBaseManager

**Files:**
- Create: `apps/custom-agent/agent/knowledge/KnowledgeBaseManager.ts`
- Create: `apps/custom-agent/agent/knowledge/index.ts`

- [ ] **Step 1: 创建 KnowledgeBaseManager.ts**

```typescript
// knowledge/KnowledgeBaseManager.ts

import { DocumentProcessor } from "./DocumentProcessor";
import { HierarchicalChunker } from "./HierarchicalChunker";
import { EmbeddingService } from "./EmbeddingService";
import { VectorStore } from "./VectorStore";
import { Chunk, IndexResult, ParsedDocument, SearchResult } from "./types";
import * as path from "path";

/**
 * 知识库管理器
 * 统一管理索引和检索
 */
export class KnowledgeBaseManager {
  private vectorStore: VectorStore;
  private chunker: HierarchicalChunker;
  private embeddingService: EmbeddingService;
  private processor: DocumentProcessor;
  private docsPath: string;
  private dbPath: string;

  constructor(
    docsPath: string,
    dbPath: string,
    embeddingApiKey: string,
    maxChunkTokens: number = 800,
  ) {
    this.docsPath = docsPath;
    this.dbPath = dbPath;
    this.vectorStore = new VectorStore(dbPath);
    this.chunker = new HierarchicalChunker(maxChunkTokens);
    this.embeddingService = new EmbeddingService(embeddingApiKey);
    this.processor = new DocumentProcessor();
  }

  /**
   * 初始化
   */
  async initialize(): Promise<void> {
    await this.vectorStore.initialize();
  }

  /**
   * 全量索引
   */
  async indexDirectory(dirPath?: string): Promise<IndexResult> {
    const targetPath = dirPath || this.docsPath;
    const result: IndexResult = {
      totalDocs: 0,
      indexed: 0,
      skipped: 0,
      errors: [],
    };

    try {
      const files = await this.processor.scanDirectory(targetPath);
      result.totalDocs = files.length;

      for (const file of files) {
        try {
          const parsed = await this.processor.processFile(file);
          const docId = this.getDocId(parsed.filePath);

          // 检查是否需要重新索引
          const changed = await this.vectorStore.isDocumentChanged(
            docId,
            parsed.fileHash,
          );

          if (!changed) {
            result.skipped++;
            continue;
          }

          // 删除旧数据
          await this.vectorStore.deleteDocument(docId);

          // 分块
          const chunks = this.chunker.chunk(parsed);

          // 批量嵌入
          const contents = chunks.map((c) => c.content);
          const embeddings = await this.embeddingService.embed(contents);

          // 存储
          for (let i = 0; i < chunks.length; i++) {
            await this.vectorStore.insertChunk(chunks[i], embeddings[i]);
          }

          // 更新文档记录
          await this.vectorStore.upsertDocument(
            docId,
            parsed.filePath,
            parsed.fileHash,
          );

          result.indexed++;
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          result.errors.push(`${file}: ${msg}`);
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      result.errors.push(`扫描目录失败: ${msg}`);
    }

    return result;
  }

  /**
   * 检索相关块
   */
  async retrieve(query: string, topK: number = 5): Promise<SearchResult[]> {
    // 1. 生成 query embedding
    const queryEmbedding = await this.embeddingService.embedOne(query);

    // 2. 向量检索
    const results = await this.vectorStore.search(queryEmbedding, topK, 0.6);

    return results;
  }

  /**
   * 格式化检索结果为上下文
   */
  formatAsContext(results: SearchResult[]): string {
    if (results.length === 0) {
      return "未找到相关知识库内容";
    }

    const lines = ["## 知识库检索结果\n"];
    for (const result of results) {
      lines.push(`### [${result.docId}] ${result.titlePath}`);
      lines.push(`相关性: ${(result.score * 100).toFixed(1)}%`);
      lines.push(result.content);
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * 删除文档
   */
  async removeDocument(docId: string): Promise<void> {
    await this.vectorStore.deleteDocument(docId);
  }

  /**
   * 关闭
   */
  close(): void {
    this.vectorStore.close();
  }

  private getDocId(filePath: string): string {
    const filename = path.basename(filePath, ".md");
    return filename;
  }
}
```

- [ ] **Step 2: 创建 index.ts**

```typescript
// knowledge/index.ts

export { DocumentProcessor } from "./DocumentProcessor";
export { HierarchicalChunker } from "./HierarchicalChunker";
export { EmbeddingService } from "./EmbeddingService";
export { VectorStore } from "./VectorStore";
export { KnowledgeBaseManager } from "./KnowledgeBaseManager";

export type {
  Chunk,
  ParsedDocument,
  DocumentSection,
  SearchResult,
  IndexResult,
} from "./types";
```

- [ ] **Step 3: 提交**

```bash
git add apps/custom-agent/agent/knowledge/KnowledgeBaseManager.ts apps/custom-agent/agent/knowledge/index.ts
git commit -m "feat: 实现 KnowledgeBaseManager 知识库管理器"
```

---

## Task 7: 集成 retrieveKnowledge 工具

**Files:**
- Modify: `apps/custom-agent/agent/tools/registry.ts`
- Modify: `apps/custom-agent/agent/types.ts`

- [ ] **Step 1: 在 types.ts 添加 KnowledgeBaseConfig 引用**

在 `ToolConfig` 后添加：

```typescript
export interface KnowledgeBaseConfig {
  enabled: boolean;
  docsPath: string;
  dbPath: string;
  embeddingApiKey?: string;
  embeddingBaseURL?: string;
  chunkTokenLimit: number;
  retrievalTopK: number;
  minScore: number;
}
```

- [ ] **Step 2: 在 registry.ts 添加 retrieveKnowledge 工具**

在 `loadBuiltinTools` 中添加：

```typescript
private createKnowledgeTool(): ToolDefinition {
  return {
    name: "retrieveKnowledge",
    description: "检索知识库中与问题相关的文档片段，用于回答关于项目文档、技术细节等问题",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "搜索query，用中文描述你要查找的内容",
        },
        topK: {
          type: "number",
          description: "返回数量",
          default: 5,
        },
      },
      required: ["query"],
    },
    execute: async (params) => {
      // 注意：这里需要通过 context 或全局方式访问 KnowledgeBaseManager
      // 具体实现见 Task 8
      return { error: "KnowledgeBase not initialized" };
    },
  };
}
```

然后在 `loadBuiltinTools` 中调用 `this.createKnowledgeTool()`。

- [ ] **Step 3: 提交**

```bash
git add apps/custom-agent/agent/tools/registry.ts apps/custom-agent/agent/types.ts
git commit -m "feat: 注册 retrieveKnowledge 工具"
```

---

## Task 8: ContextAssembler 集成知识库预注入

**Files:**
- Modify: `apps/custom-agent/agent/context/optimizer.ts`
- Modify: `apps/custom-agent/agent/agent-loop.ts`

- [ ] **Step 1: 修改 ContextAssembler 支持预注入**

在 `ContextAssembler` 构造函数添加可选的 `knowledgeBaseManager`：

```typescript
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
```

- [ ] **Step 2: 修改 collectComponents 支持预注入**

在 `collectComponents` 方法中，在获取 `longTermMemories` 前添加知识库检索：

```typescript
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
```

- [ ] **Step 3: 提交**

```bash
git add apps/custom-agent/agent/context/optimizer.ts
git commit -m "feat: ContextAssembler 集成知识库预注入"
```

---

## Task 9: 添加依赖并测试

**Files:**
- Modify: `apps/custom-agent/package.json`

- [ ] **Step 1: 添加 better-sqlite3 依赖**

```bash
cd apps/custom-agent && pnpm add better-sqlite3 && pnpm add -D @types/better-sqlite3
```

- [ ] **Step 2: 创建测试脚本 test-knowledge.ts**

```typescript
// test-knowledge.ts
import { KnowledgeBaseManager } from "./agent/knowledge";

async function main() {
  const kb = new KnowledgeBaseManager(
    "./docs",
    "./data/knowledge.db",
    process.env.MINIMAX_API_KEY || "",
    800,
  );

  await kb.initialize();

  console.log("索引中...");
  const result = await kb.indexDirectory();
  console.log("索引结果:", result);

  console.log("\n检索测试...");
  const results = await kb.retrieve("Agent 循环如何工作", 3);
  console.log("检索结果:", kb.formatAsContext(results));

  kb.close();
}

main().catch(console.error);
```

- [ ] **Step 3: 运行测试**

```bash
cd apps/custom-agent
MINIMAX_API_KEY=your_key bun run test-knowledge.ts
```

- [ ] **Step 4: 提交**

```bash
git add apps/custom-agent/package.json
git commit -m "chore: 添加 better-sqlite3 依赖"
```

---

## Task 10: 集成到 Agent 主流程

**Files:**
- Modify: `apps/custom-agent/agent/agent.ts`

- [ ] **Step 1: 在 Agent 初始化时创建 KnowledgeBaseManager**

在 `Agent` 类中添加：

```typescript
import { KnowledgeBaseManager } from "./knowledge";

export class Agent {
  // ... existing properties
  private knowledgeBaseManager?: KnowledgeBaseManager;

  async initialize() {
    // ... existing init

    // 初始化知识库
    if (this.config.knowledgeBaseConfig?.enabled) {
      this.knowledgeBaseManager = new KnowledgeBaseManager(
        this.config.knowledgeBaseConfig.docsPath,
        this.config.knowledgeBaseConfig.dbPath,
        this.config.knowledgeBaseConfig.embeddingApiKey ||
          this.config.modelConfig.apiKey,
        this.config.knowledgeBaseConfig.chunkTokenLimit,
      );

      await this.knowledgeBaseManager.initialize();

      // 可选：首次启动时全量索引
      if (this.config.knowledgeBaseConfig.autoIndex !== false) {
        await this.knowledgeBaseManager.indexDirectory();
      }
    }
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add apps/custom-agent/agent/agent.ts
git commit -m "feat: Agent 集成知识库 RAG"
```

---

## 实现检查清单

- [ ] Task 1: 类型定义
- [ ] Task 2: DocumentProcessor
- [ ] Task 3: HierarchicalChunker
- [ ] Task 4: EmbeddingService
- [ ] Task 5: VectorStore
- [ ] Task 6: KnowledgeBaseManager
- [ ] Task 7: retrieveKnowledge 工具
- [ ] Task 8: ContextAssembler 预注入
- [ ] Task 9: 依赖 + 测试
- [ ] Task 10: Agent 集成

---

## 备选：子任务分解建议

如果使用 subagent-driven-development，建议按以下方式分解：

1. **子任务 1**: types.ts + DocumentProcessor + HierarchicalChunker
2. **子任务 2**: EmbeddingService + VectorStore
3. **子任务 3**: KnowledgeBaseManager + index.ts
4. **子任务 4**: 工具注册 + ContextAssembler 集成
5. **子任务 5**: Agent 集成 + 测试
