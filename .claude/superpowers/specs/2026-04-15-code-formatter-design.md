# Code Formatter Agent 设计文档

## 概述

创建一个 Claude Code Agent，用于使用 Biome 自动格式化代码修改文件。

## 背景

项目使用 Biome 作为代码格式化工具，已有 `biome.json` 配置。当前 `pnpm biome` 命令可做检查，需要一个专门的 agent 来自动格式化 git 修改的文件。

## 设计

### 存放位置

`.claude/agents/code-formatter.md`

### Agent 定义

```yaml
---
name: code-formatter
description: 使用 Biome 自动格式化代码
tools: Bash, Glob, Read
model: haiku
---

自动格式化代码...
```

### 核心行为

1. **获取修改文件**
   - Staged 文件：`git diff --cached --name-only`
   - 工作区修改：`git diff --name-only`
   - 支持参数指定文件/目录

2. **筛选 Biome 支持的文件类型**
   - `.ts`, `.tsx`, `.js`, `.jsx`, `.json`

3. **执行格式化**
   - 命令：`npx @biomejs/biome format --write <files>`
   - 使用 `--write` 直接修改文件

4. **输出报告**
   - 格式化的文件数量
   - 修改的文件列表
   - 如无需格式化的文件，报告"No files need formatting"

### 使用方式

在 Claude Code 中对话调用：
```
@code-formatter 格式化我的修改
```

或作为子 agent 被其他 skill 调用。

## 实现

### 文件：`.claude/agents/code-formatter.md`

包含完整的 prompt，指导 agent：
1. 检测 git 修改文件
2. 过滤 Biome 支持的文件
3. 执行格式化命令
4. 报告结果
