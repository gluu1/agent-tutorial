/**
 * 常用场景预设
 */
const ModelPresets = {
  /**
   * 精确任务 - 低温度，确定性输出
   * 适用于: 代码生成、数据提取、数学计算
   */
  precise: {
    temperature: 0.1,
    topP: 0.95,
    frequencyPenalty: 0,
    presencePenalty: 0,
  },

  /**
   * 平衡模式 - 默认推荐
   * 适用于: 对话、通用任务
   */
  balanced: {
    temperature: 0.7,
    topP: 1.0,
    frequencyPenalty: 0,
    presencePenalty: 0,
  },

  /**
   * 创意模式 - 高温度
   * 适用于: 文案创作、头脑风暴
   */
  creative: {
    temperature: 1.2,
    topP: 0.95,
    frequencyPenalty: 0.3,
    presencePenalty: 0.3,
  },

  /**
   * 代码模式 - 适中温度，低重复
   * 适用于: 编程任务
   */
  code: {
    temperature: 0.2,
    topP: 0.95,
    frequencyPenalty: 0.1,
    presencePenalty: 0,
  },

  /**
   * 推理模式 - DeepSeek R1 优化
   * 适用于: 复杂推理、数学证明
   */
  reasoning: {
    temperature: 0.6,
    topP: 0.95,
    reasoningEffort: 8192,
    includeReasoning: true,
  },
};
