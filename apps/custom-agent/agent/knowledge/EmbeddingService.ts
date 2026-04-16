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
				(res) => {
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
