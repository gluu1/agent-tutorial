import { KnowledgeBaseManager } from "./agent/knowledge";

async function main() {
	const apiKey = process.env.MINIMAX_API_KEY;
	if (!apiKey) {
		console.error("请设置 MINIMAX_API_KEY 环境变量");
		process.exit(1);
	}

	const kb = new KnowledgeBaseManager(
		"./docs",
		"./data/knowledge.db",
		apiKey,
		800,
	);

	try {
		await kb.initialize();
		console.log("初始化完成");

		console.log("索引中...");
		const result = await kb.indexDirectory();
		console.log("索引结果:", result);

		console.log("\n检索测试...");
		const results = await kb.retrieve("Agent 循环如何工作", 3);
		console.log("检索结果:", kb.formatAsContext(results));
	} finally {
		kb.close();
	}
}

main().catch(console.error);
