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
		embeddingBaseURL?: string,
	) {
		this.docsPath = docsPath;
		this.dbPath = dbPath;
		this.vectorStore = new VectorStore(dbPath);
		this.chunker = new HierarchicalChunker(maxChunkTokens);
		this.embeddingService = new EmbeddingService(embeddingApiKey, embeddingBaseURL);
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
		return path.basename(filePath, ".md");
	}
}
