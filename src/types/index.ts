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
  };
  tasks: Array<{
    name: string;
    continueOnError?: boolean;
    flow: Array<Record<string, unknown>>;
  }>;
}
