/**
 * 核心类型定义
 */

export interface ScriptMeta {
  id: string;
  name: string;
  description: string;
  yamlPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScriptsIndex {
  version: 1;
  scripts: ScriptMeta[];
}

export type ExplorationStepResult = "success" | "error" | "pending";

export interface ExplorationStep {
  action: string;
  result: ExplorationStepResult;
  durationMs?: number;
  /** 是否使用深度定位（v1.6: deepLocate） */
  deepLocate?: boolean;
  /** Midscene 报告 HTML 文件路径（从 agent.reportFile 获取） */
  reportFile?: string;
  /** 错误信息（result 为 error 时） */
  errorMessage?: string;
}

/**
 * 单个 yamlFlow 条目
 * 格式如 { "aiInput": "", "value": "..." } 或 { "aiTap": "" }
 */
export interface YamlFlowItem {
  /** Midscene 原生动作类型键，如 aiInput / aiTap / sleep */
  [actionKey: string]: unknown;
}

/**
 * 从报告 JSON 解析出的单个任务执行记录
 * 结构匹配 executions[].tasks[] 字段
 */
export interface ParsedExecution {
  /** 执行名称，如 "Act - 在页面上随便说点什么" */
  taskName: string;
  /** 子类型：Plan / Input / Locate */
  subType: string;
  /** 原始用户指令 */
  userInstruction: string;
  /** 状态：finished / error */
  status: string;
  /** 执行耗时（毫秒） */
  durationMs: number;
  /** 动作列表（fallback 用） */
  actions?: Array<{
    type: string;
    param: Record<string, unknown>;
  }>;
  /**
   * Midscene 自动生成的 YAML flow 片段，可直接拼接
   * 格式如 [{ "aiInput": "", "value": "你好" }, { "aiTap": "" }]
   */
  yamlFlow?: YamlFlowItem[];
  /** 断言/输出文字，存于 task.output.output */
  outputOutput?: string;
  /** 是否继续规划（最后一步 Plan 任务为 false），存于 task.output.shouldContinuePlanning */
  shouldContinuePlanning?: boolean;
}

export interface ExplorationLog {
  startUrl: string;
  steps: ExplorationStep[];
}

export interface MidsceneModelConfig {
  modelBaseUrl: string;
  modelApiKey: string;
  modelName: string;
  modelFamily: string;
}

/**
 * 主模型配置（视觉定位）
 * 通过 MIDSCENE_MODEL_* 环境变量注入
 */
export interface MidsceneConfig extends MidsceneModelConfig {}

/**
 * Planning 模型配置（规划决策）
 * 通过 MIDSCENE_PLANNING_MODEL_* 环境变量注入
 * 用于复杂的任务规划、多步推理决策
 * 仅当配置了 MIDSCENE_PLANNING_MODEL_API_KEY 时生效
 */
export interface PlanningModelConfig extends MidsceneModelConfig {}

/**
 * Insight 模型配置（页面理解与分析）
 * 通过 MIDSCENE_INSIGHT_MODEL_* 环境变量注入
 * 用于 aiQuery / aiAssert 等需要深度页面理解的场景
 * 仅当配置了 MIDSCENE_INSIGHT_MODEL_API_KEY 时生效
 */
export interface InsightModelConfig extends MidsceneModelConfig {}

/**
 * 多模型配置集合
 */
export interface MultiModelConfig {
  default: MidsceneConfig;
  planning?: PlanningModelConfig;
  insight?: InsightModelConfig;
}

export interface YamlScript {
  web?: {
    url: string;
    userAgent?: string;
    viewportWidth?: number;
    viewportHeight?: number;
  };
  android?: Record<string, unknown>;
  ios?: Record<string, unknown>;
  computer?: Record<string, unknown>;
  agent?: {
    testId?: string;
    groupName?: string;
    groupDescription?: string;
    generateReport?: boolean;
    autoPrintReportMsg?: boolean;
    reportFileName?: string;
    replanningCycleLimit?: number;
    aiActContext?: string;
    cache?: boolean | { strategy?: string; id?: string };
    /**
     * 是否启用深度定位（v1.6: deepLocate）
     * 启用后 AI 会进行更精确的元素定位，适合复杂页面
     */
    deepLocate?: boolean;
  };
  tasks: Array<{
    name: string;
    continueOnError?: boolean;
    flow: Array<Record<string, unknown>>;
  }>;
}
