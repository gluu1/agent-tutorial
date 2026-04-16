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
