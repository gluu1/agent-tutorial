// core/skills/manager.ts - Skills 系统

import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { SkillDefinition, ToolDefinition, SkillsConfig } from "../types";

/**
 * Skill 解析器
 */
export class SkillParser {
  /**
   * 解析 Skill 文件
   */
  static async parseSkillFile(
    filePath: string,
  ): Promise<SkillDefinition | null> {
    const content = await fs.promises.readFile(filePath, "utf-8");
    const ext = path.extname(filePath);

    if (ext === ".json") {
      return this.parseJSON(content);
    } else if (ext === ".yaml" || ext === ".yml") {
      return this.parseYAML(content);
    } else if (ext === ".md") {
      return this.parseMarkdown(content);
    }

    return null;
  }

  /**
   * 解析 JSON Skill
   */
  static parseJSON(content: string): SkillDefinition {
    const data = JSON.parse(content);
    return {
      name: data.name,
      version: data.version,
      description: data.description,
      author: data.author,
      triggers: data.triggers || [],
      tools: data.tools || [],
      dependencies: data.dependencies,
      permissions: data.permissions,
    };
  }

  /**
   * 解析 YAML Skill
   */
  static parseYAML(content: string): SkillDefinition {
    const data = yaml.load(content) as any;
    return {
      name: data.name,
      version: data.version,
      description: data.description,
      author: data.author,
      triggers: data.triggers || [],
      tools: data.tools || [],
      dependencies: data.dependencies,
      permissions: data.permissions,
    };
  }

  /**
   * 解析 Markdown Skill（OpenClaw 风格）
   *
   * 格式示例:
   * # Skill: browser-automation
   *
   * ## Description
   * 浏览器自动化技能，支持网页导航、截图、数据抓取
   *
   * ## Triggers
   * - 打开网页
   * - 截图
   * - 获取内容
   *
   * ## Tools
   * ### navigate
   * 导航到指定URL
   *
   * 参数:
   * - url (string, required): 目标URL
   */
  static parseMarkdown(content: string): SkillDefinition {
    const lines = content.split("\n");
    let name = "";
    let description = "";
    const triggers: string[] = [];
    const tools: ToolDefinition[] = [];

    let currentSection = "";
    let currentTool: Partial<ToolDefinition> | null = null;
    let toolParams: Record<string, any> = {};

    for (const line of lines) {
      // 解析标题
      if (line.startsWith("# Skill:")) {
        name = line.replace("# Skill:", "").trim();
      }
      // 解析章节
      else if (line.startsWith("## ")) {
        currentSection = line.replace("## ", "").trim().toLowerCase();
        currentTool = null;
      }
      // 解析描述
      else if (currentSection === "description" && line.trim()) {
        description += line.trim() + " ";
      }
      // 解析触发器
      else if (currentSection === "triggers" && line.trim().startsWith("-")) {
        triggers.push(line.replace("-", "").trim());
      }
      // 解析工具
      else if (line.startsWith("### ")) {
        if (currentTool) {
          // 保存上一个工具
          if (currentTool.name && currentTool.description) {
            tools.push({
              name: currentTool.name,
              description: currentTool.description,
              parameters: { type: "object", properties: toolParams },
              execute: async () => ({}), // 占位，实际执行需动态加载
            } as ToolDefinition);
          }
        }
        currentTool = { name: line.replace("###", "").trim() };
        toolParams = {};
      } else if (currentTool && line.includes("参数:")) {
        // 解析参数定义
        // 简化实现，生产环境需要完整解析
      }
    }

    // 保存最后一个工具
    if (currentTool?.name && currentTool?.description) {
      tools.push({
        name: currentTool.name,
        description: currentTool.description,
        parameters: { type: "object", properties: toolParams },
        execute: async () => ({}),
      } as ToolDefinition);
    }

    return {
      name: name || path.basename(__filename),
      version: "1.0.0",
      description: description.trim(),
      triggers,
      tools,
    };
  }
}

/**
 * Skill 加载器
 */
export class SkillLoader {
  private config: SkillsConfig;
  private skills: Map<string, SkillDefinition> = new Map();
  private watchers: Map<string, fs.FSWatcher> = new Map();

  constructor(config: SkillsConfig) {
    this.config = config;
  }

  /**
   * 加载所有 Skills
   */
  async loadAll(): Promise<Map<string, SkillDefinition>> {
    if (!this.config.enabled) {
      return this.skills;
    }

    const skillsPath = path.resolve(this.config.skillsPath);

    try {
      const files = await fs.promises.readdir(skillsPath);

      for (const file of files) {
        const filePath = path.join(skillsPath, file);
        const stat = await fs.promises.stat(filePath);

        if (stat.isFile()) {
          const skill = await SkillParser.parseSkillFile(filePath);
          if (skill && this.isAllowed(skill)) {
            this.skills.set(skill.name, skill);
          }
        }
      }

      // 监听文件变化
      if (this.config.watchChanges) {
        this.watchDirectory(skillsPath);
      }
    } catch (error) {
      console.error("Failed to load skills:", error);
    }

    return this.skills;
  }

  /**
   * 加载单个 Skill
   */
  async loadSkill(skillName: string): Promise<SkillDefinition | null> {
    const skillPath = path.join(this.config.skillsPath, `${skillName}.md`);

    try {
      const skill = await SkillParser.parseSkillFile(skillPath);
      if (skill && this.isAllowed(skill)) {
        this.skills.set(skill.name, skill);
        return skill;
      }
    } catch (error) {
      console.error(`Failed to load skill ${skillName}:`, error);
    }

    return null;
  }

  /**
   * 获取 Skill
   */
  getSkill(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  /**
   * 获取所有 Skills
   */
  getAllSkills(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  /**
   * 获取 Skill 的工具
   */
  getToolsFromSkills(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];

    for (const skill of this.skills.values()) {
      tools.push(...skill.tools);
    }

    return tools;
  }

  /**
   * 生成 Skills 提示词
   */
  generatePrompt(): string {
    const skillsList = this.getAllSkills();
    if (skillsList.length === 0) return "";

    const sections = skillsList.map((skill) => {
      const triggers =
        skill.triggers.length > 0
          ? `\n触发词: ${skill.triggers.join(", ")}`
          : "";

      const tools = skill.tools
        .map((tool) => `  - ${tool.name}: ${tool.description}`)
        .join("\n");

      return `## ${skill.name} v${skill.version}
${skill.description}${triggers}

工具:
${tools}`;
    });

    return `# 可用技能 (Skills)\n\n${sections.join("\n\n")}`;
  }

  /**
   * 检查 Skill 是否允许加载
   */
  private isAllowed(skill: SkillDefinition): boolean {
    // 检查黑名单
    if (this.config.blockedSkills.includes(skill.name)) {
      return false;
    }

    // 检查白名单
    if (
      this.config.allowedSkills.length > 0 &&
      !this.config.allowedSkills.includes(skill.name)
    ) {
      return false;
    }

    return true;
  }

  /**
   * 监听目录变化
   */
  private watchDirectory(dir: string): void {
    const watcher = fs.watch(
      dir,
      { recursive: true },
      async (eventType, filename) => {
        if (filename && (eventType === "change" || eventType === "rename")) {
          const filePath = path.join(dir, filename);
          try {
            const skill = await SkillParser.parseSkillFile(filePath);
            if (skill) {
              this.skills.set(skill.name, skill);
              console.log(`Skill reloaded: ${skill.name}`);
            }
          } catch (error) {
            console.error(`Failed to reload skill ${filename}:`, error);
          }
        }
      },
    );

    this.watchers.set(dir, watcher);
  }

  /**
   * 关闭所有监听器
   */
  close(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
  }
}

/**
 * Skills 管理器
 */
export class SkillsManager extends EventEmitter {
  private loader: SkillLoader;
  private config: SkillsConfig;

  constructor(config: SkillsConfig) {
    super();
    this.config = config;
    this.loader = new SkillLoader(config);
  }

  /**
   * 初始化
   */
  async init(): Promise<void> {
    if (this.config.autoLoad) {
      await this.loader.loadAll();
      console.log(`Loaded ${this.loader.getAllSkills().length} skills`);
    }
  }

  /**
   * 获取所有工具
   */
  getTools(): ToolDefinition[] {
    return this.loader.getToolsFromSkills();
  }

  /**
   * 生成提示词
   */
  generatePrompt(): string {
    return this.loader.generatePrompt();
  }

  /**
   * 获取 Skill
   */
  getSkill(name: string): SkillDefinition | undefined {
    return this.loader.getSkill(name);
  }

  /**
   * 获取所有 Skills
   */
  getAllSkills(): SkillDefinition[] {
    return this.loader.getAllSkills();
  }

  /**
   * 关闭
   */
  shutdown(): void {
    this.loader.close();
  }
}
