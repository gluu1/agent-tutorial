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
				if (currentSection) {
					currentSection.content = currentSection.content.trim();
				}

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

		if (currentSection) {
			currentSection.content = currentSection.content.trim();
		}

		return sections;
	}

	private computeHash(content: string): string {
		return crypto.createHash("md5").update(content).digest("hex");
	}
}
