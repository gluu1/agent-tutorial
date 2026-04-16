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
