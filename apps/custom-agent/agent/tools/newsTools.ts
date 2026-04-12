/**
 * 新闻工具 - 基于 HackerNews API 的新闻搜索与分析
 *
 * 分层架构：
 * 1. Types - 数据结构
 * 2. NewsService - API 通信层
 * 3. Tools - Agent 工具定义
 */

import { ToolDefinition } from "../types";

// ============================================================
// Types
// ============================================================

export interface HNItem {
  id: number;
  type: "story" | "comment" | "ask" | "show" | "job";
  title?: string;
  url?: string;
  text?: string;
  score?: number;
  by?: string;
  time?: number;
  descendants?: number;
  kids?: number[];
}

export interface NewsSearchResult {
  id: number;
  title: string;
  url: string;
  score: number;
  author: string;
  timestamp: string;
  commentCount: number;
  domain: string;
}

export interface NewsAnalysis {
  summary: string;
  sentiment: "正面" | "负面" | "中性";
  keyTopics: string[];
  keyEntities: string[];
}

// ============================================================
// News Service - API 通信层
// ============================================================

const HN_API_BASE = "https://hacker-news.firebaseio.com/v0";

class NewsService {
  /**
   * 带超时的请求
   */
  private async fetchWithTimeout<T>(url: string, timeoutMs = 10000): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json() as T;
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`请求超时 (${timeoutMs}ms)`);
      }
      throw error;
    }
  }

  /**
   * 获取热门新闻
   */
  async getTopStories(limit = 10): Promise<NewsSearchResult[]> {
    const ids = await this.fetchWithTimeout<number[]>(
      `${HN_API_BASE}/topstories.json`,
    );

    const storyIds = ids.slice(0, limit);
    const stories = await Promise.all(
      storyIds.map((id) => this.getItem(id)),
    );

    return stories.filter((s): s is NewsSearchResult => s !== null);
  }

  /**
   * 获取最佳新闻
   */
  async getBestStories(limit = 10): Promise<NewsSearchResult[]> {
    const ids = await this.fetchWithTimeout<number[]>(
      `${HN_API_BASE}/beststories.json`,
    );

    const storyIds = ids.slice(0, limit);
    const stories = await Promise.all(
      storyIds.map((id) => this.getItem(id)),
    );

    return stories.filter((s): s is NewsSearchResult => s !== null);
  }

  /**
   * 获取最新新闻
   */
  async getNewStories(limit = 10): Promise<NewsSearchResult[]> {
    const ids = await this.fetchWithTimeout<number[]>(
      `${HN_API_BASE}/newstories.json`,
    );

    const storyIds = ids.slice(0, limit);
    const stories = await Promise.all(
      storyIds.map((id) => this.getItem(id)),
    );

    return stories.filter((s): s is NewsSearchResult => s !== null);
  }

  /**
   * 搜索新闻
   */
  async searchStories(query: string, limit = 10): Promise<NewsSearchResult[]> {
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${limit}`;

    const data = await this.fetchWithTimeout<{
      hits: Array<{
        objectID: string;
        title: string;
        url?: string;
        points?: number;
        author?: string;
        created_at_i?: number;
        num_comments?: number;
      }>;
    }>(url);

    return data.hits.map((hit) => ({
      id: parseInt(hit.objectID, 10),
      title: hit.title || "无标题",
      url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      score: hit.points || 0,
      author: hit.author || "未知",
      timestamp: hit.created_at_i
        ? new Date(hit.created_at_i * 1000).toISOString()
        : new Date().toISOString(),
      commentCount: hit.num_comments || 0,
      domain: this.extractDomain(hit.url || ""),
    }));
  }

  /**
   * 获取单条新闻
   */
  async getItem(id: number): Promise<NewsSearchResult | null> {
    try {
      const item = await this.fetchWithTimeout<HNItem>(`${HN_API_BASE}/item/${id}.json`);

      if (!item || item.type !== "story") {
        return null;
      }

      return {
        id: item.id,
        title: item.title || "无标题",
        url: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
        score: item.score || 0,
        author: item.by || "未知",
        timestamp: item.time ? new Date(item.time * 1000).toISOString() : new Date().toISOString(),
        commentCount: item.descendants || 0,
        domain: this.extractDomain(item.url || ""),
      };
    } catch {
      return null;
    }
  }

  /**
   * 获取新闻详情
   */
  async getItemDetails(id: number): Promise<HNItem | null> {
    try {
      return await this.fetchWithTimeout<HNItem>(`${HN_API_BASE}/item/${id}.json`);
    } catch {
      return null;
    }
  }

  /**
   * 提取域名
   */
  private extractDomain(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "news.ycombinator.com";
    }
  }
}

// 单例
const newsService = new NewsService();

// ============================================================
// 分析函数
// ============================================================

/**
 * 提取关键词
 */
function extractKeywords(text: string): string[] {
  if (!text || typeof text !== "string") {
    return [];
  }

  const stopWords = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
    "being", "have", "has", "had", "do", "does", "did", "will", "would",
    "could", "should", "may", "might", "can", "this", "that", "these",
    "those", "it", "its", "they", "them", "their", "what", "which", "who",
    "when", "where", "why", "how", "all", "each", "every", "both", "few",
    "more", "most", "other", "some", "such", "no", "not", "only", "same",
    "so", "than", "too", "very", "just", "also", "now", "here", "there",
    "then", "once", "if", "about", "after", "before", "above", "below",
    "between", "into", "through", "during", "under", "again", "further",
    "while",
  ]);

  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stopWords.has(w));

  const frequency: Record<string, number> = {};
  for (const word of words) {
    frequency[word] = (frequency[word] || 0) + 1;
  }

  return Object.entries(frequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);
}

/**
 * 情感分析
 */
function analyzeSentiment(text: string): NewsAnalysis["sentiment"] {
  const positiveWords = [
    "good", "great", "excellent", "amazing", "wonderful", "best", "love",
    "perfect", "success", "win", "improve", "growth", "innovative", "breakthrough",
  ];
  const negativeWords = [
    "bad", "worst", "terrible", "awful", "fail", "failure", "problem", "bug",
    "crash", "vulnerability", "attack", "breach", "hack", "disaster", "loss",
  ];

  const lowerText = text.toLowerCase();
  let positive = 0;
  let negative = 0;

  for (const word of positiveWords) {
    if (lowerText.includes(word)) positive++;
  }
  for (const word of negativeWords) {
    if (lowerText.includes(word)) negative++;
  }

  if (positive > negative) return "正面";
  if (negative > positive) return "负面";
  return "中性";
}

/**
 * 生成摘要
 */
function generateSummary(items: NewsSearchResult[]): string {
  if (items.length === 0) {
    return "未找到相关新闻。";
  }

  const totalScore = items.reduce((sum, item) => sum + (item.score || 0), 0);
  const totalComments = items.reduce((sum, item) => sum + (item.commentCount || 0), 0);
  const avgScore = Math.round(totalScore / items.length);
  const domains = [...new Set(items.map((i) => i.domain || "未知"))];

  return `共 ${items.length} 条新闻。` +
    `总热度：${totalScore} 分，${totalComments} 条评论。` +
    `平均热度：${avgScore} 分。` +
    `来源：${domains.slice(0, 5).join("、")}${domains.length > 5 ? "等" : ""}`;
}

/**
 * 提取实体
 */
function extractEntities(text: string): string[] {
  const patterns = [
    /(?:GitHub|Google|Microsoft|Apple|Amazon|OpenAI|Anthropic|Meta|Tesla|Netflix)/gi,
    /(?:AI|ML|LLM|GPT|Claude|ChatGPT|Kubernetes|Docker)/gi,
  ];

  const entities: string[] = [];
  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) {
      entities.push(...matches.map((m) => m.toLowerCase()));
    }
  }

  return [...new Set(entities)].slice(0, 10);
}

// ============================================================
// 工具定义
// ============================================================

/**
 * 工具：获取热门新闻
 */
const newsGetTopStoriesTool: ToolDefinition = {
  name: "news_get_top_stories",
  description: "获取 Hacker News 热门新闻排行榜。用于查找今日最热门的科技新闻。",
  parameters: {
    type: "object",
    properties: {
      limit: {
        type: "number",
        description: "返回新闻数量（默认：10，最大：30）",
      },
      category: {
        type: "string",
        description: "新闻分类：top（热门）、best（最佳）、new（最新），默认：top",
        enum: ["top", "best", "new"],
      },
    },
    required: [],
  },
  metadata: {
    category: "新闻",
    timeout: 15000,
  },
  execute: async (params) => {
    const limit = Math.min(params.limit || 10, 30);
    const category = params.category || "top";

    let stories: NewsSearchResult[];
    if (category === "best") {
      stories = await newsService.getBestStories(limit);
    } else if (category === "new") {
      stories = await newsService.getNewStories(limit);
    } else {
      stories = await newsService.getTopStories(limit);
    }

    const categoryName = { top: "热门", best: "最佳", new: "最新" }[category];

    return {
      分类: categoryName,
      数量: stories.length,
      新闻列表: stories.map((s, i) => ({
        排名: i + 1,
        标题: s.title,
        热度: s.score,
        评论数: s.commentCount,
        来源: s.domain,
        链接: s.url,
        作者: s.author,
        时间: new Date(s.timestamp).toLocaleString("zh-CN"),
      })),
    };
  },
};

/**
 * 工具：搜索新闻
 */
const newsSearchTool: ToolDefinition = {
  name: "news_search",
  description: "通过关键词搜索 Hacker News 新闻。适合查找 AI、安全、创业等特定主题的新闻。",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "搜索关键词",
      },
      limit: {
        type: "number",
        description: "返回结果数量（默认：10，最大：30）",
      },
    },
    required: ["query"],
  },
  metadata: {
    category: "新闻",
    timeout: 15000,
  },
  execute: async (params) => {
    if (!params.query || params.query.trim().length === 0) {
      throw new Error("query 参数不能为空");
    }

    const limit = Math.min(params.limit || 10, 30);
    const stories = await newsService.searchStories(params.query.trim(), limit);

    return {
      搜索词: params.query,
      数量: stories.length,
      新闻列表: stories.map((s, i) => ({
        排名: i + 1,
        标题: s.title,
        热度: s.score,
        评论数: s.commentCount,
        来源: s.domain,
        链接: s.url,
        作者: s.author,
        时间: new Date(s.timestamp).toLocaleString("zh-CN"),
      })),
    };
  },
};

/**
 * 工具：获取新闻详情
 */
const newsGetItemTool: ToolDefinition = {
  name: "news_get_item",
  description: "通过 ID 获取单条新闻的详细信息，包括正文内容（Ask HN、Show HN）和评论数。",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "number",
        description: "Hacker News 新闻 ID",
      },
    },
    required: ["id"],
  },
  metadata: {
    category: "新闻",
    timeout: 10000,
  },
  execute: async (params) => {
    if (!params.id) {
      throw new Error("id 参数不能为空");
    }

    const item = await newsService.getItemDetails(params.id);

    if (!item) {
      return { 错误: "未找到该新闻", id: params.id };
    }

    return {
      ID: item.id,
      类型: item.type,
      标题: item.title,
      链接: item.url,
      正文: item.text,
      热度: item.score,
      作者: item.by,
      时间: item.time ? new Date(item.time * 1000).toLocaleString("zh-CN") : null,
      评论数: item.descendants || 0,
      评论链接: `https://news.ycombinator.com/item?id=${item.id}`,
    };
  },
};

/**
 * 工具：分析新闻
 */
const newsAnalyzeTool: ToolDefinition = {
  name: "news_analyze",
  description: "分析新闻列表，生成摘要、情感倾向、关键词和关键实体。用于 news_search 或 news_get_top_stories 之后对新闻进行深度分析。",
  parameters: {
    type: "object",
    properties: {
      newsData: {
        type: "string",
        description: "要分析的新闻数据（JSON 字符串，来自 news_search 或 news_get_top_stories 的结果）",
      },
      focus: {
        type: "string",
        description: "分析重点：overview（概览）、tech（科技）、trends（趋势）、summary（摘要），默认：overview",
        enum: ["overview", "tech", "trends", "summary"],
      },
    },
    required: ["newsData"],
  },
  metadata: {
    category: "新闻",
    timeout: 5000,
  },
  execute: async (params) => {
    if (!params.newsData) {
      throw new Error("newsData 参数不能为空");
    }

    let newsItems: NewsSearchResult[];
    try {
      const parsed = JSON.parse(params.newsData);
      newsItems = parsed.新闻列表 || parsed.stories || parsed;
    } catch {
      throw new Error("newsData 格式无效 - 必须是有效的 JSON");
    }

    if (!Array.isArray(newsItems) || newsItems.length === 0) {
      return { 错误: "没有可分析的新闻" };
    }

    const focus = params.focus || "overview";

    // 合并所有标题
    const allText = newsItems.map((i) => `${i.title}`).join(" ");

    // 生成分析
    const analysis: NewsAnalysis = {
      summary: generateSummary(newsItems),
      sentiment: analyzeSentiment(allText),
      keyTopics: extractKeywords(allText),
      keyEntities: extractEntities(allText),
    };

    // 按焦点的洞察
    let insights: string[] = [];
    if (focus === "tech") {
      const techKeywords = ["ai", "ml", "api", "security", "open source", "cloud", "startup", "model"];
      insights = newsItems
        .filter((item) => item.title && techKeywords.some((kw) => item.title!.toLowerCase().includes(kw)))
        .slice(0, 3)
        .map((item) => `• ${item.title}（${item.score} 热度）`);
    } else if (focus === "trends") {
      const topItems = [...newsItems].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 5);
      insights = topItems.map((item) => `• ${item.title || "无标题"}（${item.score || 0} 热度）`);
    }

    const focusName = {
      overview: "概览",
      tech: "科技",
      trends: "趋势",
      summary: "摘要",
    }[focus];

    return {
      分析重点: focusName,
      新闻总数: newsItems.length,
      分析结果: {
        摘要: analysis.summary,
        情感倾向: analysis.sentiment,
        关键词: analysis.keyTopics,
        关键实体: analysis.keyEntities,
      },
      重点洞察: insights.length > 0 ? insights : undefined,
      热门新闻: [...newsItems]
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map((s) => ({ 标题: s.title, 热度: s.score, 链接: s.url })),
    };
  },
};

/**
 * 加载所有新闻工具
 */
export function loadNewsTools(): ToolDefinition[] {
  return [
    newsGetTopStoriesTool,
    newsSearchTool,
    newsGetItemTool,
    newsAnalyzeTool,
  ];
}

export { newsService };
