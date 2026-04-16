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
	splitByParagraphs(
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
				// 如果单个段落就超限，递归按句子拆分
				if (paraTokens > this.maxChunkTokens) {
					const subChunks = this.splitBySentences(
						para,
						docId,
						titlePath,
						headingLevel,
						currentStartLine,
					);
					chunks.push(...subChunks);
				} else {
					currentChunk = para + "\n\n";
				}
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
	 */
	estimateTokens(text: string): number {
		const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
		const english = (text.match(/[a-zA-Z]/g) || []).length;
		return chinese * 2 + english / 4;
	}

	getDocId(filePath: string): string {
		const filename = filePath.split(/[/\\]/).pop() || filePath;
		return filename.replace(/\.md$/, "");
	}

	generateId(): string {
		return `chunk_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
	}

	/**
	 * 按句子递归拆分
	 */
	private splitBySentences(
		content: string,
		docId: string,
		titlePath: string,
		headingLevel: number,
		startLine: number,
	): Chunk[] {
		const sentences = content.split(/(?<=[。！？.!?])/);
		let currentChunk = "";
		let currentStartLine = startLine;
		const chunks: Chunk[] = [];

		for (const sentence of sentences) {
			const sentenceTokens = this.estimateTokens(sentence);
			if (this.estimateTokens(currentChunk) + sentenceTokens <= this.maxChunkTokens) {
				currentChunk += sentence;
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
				currentChunk = sentence;
				currentStartLine += currentChunk.split("\n").length;
			}
		}

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
}
