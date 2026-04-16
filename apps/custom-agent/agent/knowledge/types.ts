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
	level: number; // 1-6 (# 数量)
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
