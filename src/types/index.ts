/**
 * 核心类型定义
 */

/**
 * 单个 task 的 token 消耗
 * 匹配 task.usage 和 task.searchAreaUsage 字段结构
 * 注意：searchAreaUsage 只有 prompt_tokens / total_tokens，completion_tokens / cachedTokens 可能为空
 */
export interface TaskUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  timeCostMs: number;
  modelName: string;
  intent: string;
}

/**
 * 单个 step 的 metrics（对应一个 execution，即一个完整的 aiAct 调用）
 */
export interface StepMetrics {
  userInstruction: string;
  /** Plan 任务决定整体状态 */
  status: "finished" | "failed";
  /**
   * 墙钟耗时 = Σ(task.end - task.start) of all tasks in this step.
   * Double-pass 时同一个 step 可能执行多遍，累加所有遍的耗时能反映总代价。
   */
  wallTimeMs: number;
  /** AI 推理耗时 = Σ timing.cost（Plan / Locate / Assert 任务累加） */
  aiTimeMs: number;
  /** 这个 step 包含多少个子 task */
  subTasks: number;
  /** 主模型 usage（Plan 任务有） */
  usage?: TaskUsage;
  /** Locate 模型的 searchAreaUsage 累加（deepLocate 时有值） */
  locateUsage?: TaskUsage;
  /** 最终凝固的动作序列 */
  actions?: Array<{
    type: string;
    description: string;
  }>;
  /** 每个子 task 后的截图路径（相对路径） */
  screenshots?: string[];
  /** 缓存命中标记（通过 task.output.hitBy.from === "Cache" 检测）
   * 命中时 SDK 不调用 AI，故 usage 为空，但 step 仍存在 */
  hitByCache?: boolean;
}

/**
 * 完整 metrics 报告
 */
export interface MetricsReport {
  version: 1;
  scriptName: string;
  generatedAt: string;
  mode: "explore" | "run";
  /** 标识 SDK 是否发生了 double-pass（同一 YAML 执行了多遍） */
  passInfo?: {
    detected: boolean;
    passCount: number;
    /** 各 pass 的 group-id（HTML 中的 data-group-id） */
    passIds: string[];
  };
  environment: {
    sdkVersion: string;
    startUrl?: string;
  };
  summary: {
    /** 有 usage 的 step 数 */
    totalSteps: number;
    /** 墙钟总耗时（毫秒） */
    totalWallTimeMs: number;
    /** AI 推理总耗时（毫秒） */
    totalAiTimeMs: number;
    totalTokens: number;
    totalCachedTokens: number;
    /** 缓存命中 step 数（通过 hitBy.from === "Cache" 检测，命中时 SDK 不调用 AI） */
    hitByCacheCount: number;
    modelBreakdown: Array<{
      modelName: string;
      intent: string;
      steps: number;
      totalTokens: number;
      totalAiTimeMs: number;
    }>;
  };
  steps: StepMetrics[];
}

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
  /** 执行 ID（UUID），用于分组 */
  executionId: string;
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
  /** 原始 task JSON 对象，用于 metrics 提取 */
  _rawTask?: {
    status?: string;
    subType?: string;
    param?: Record<string, unknown>;
    timing?: { start?: number; end?: number; cost?: number };
    usage?: Record<string, unknown>;
    searchAreaUsage?: Record<string, unknown>;
    output?: Record<string, unknown>;
    recorder?: Array<{ screenshot?: { path?: string } }>;
    uiContext?: Record<string, unknown>;
    log?: { rawResponse?: string };
  };
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
 * 主模型配置（qwen3-vl-plus）
 * 同时负责视觉定位和任务规划。
 */
export interface MidsceneConfig extends MidsceneModelConfig {}

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
    /**
     * 引用的基础脚本名称（Delta Freeze 机制）。
     * 运行时预处理器会将 baseScript 替换为对应脚本的完整 flow，
     * 展开后此字段被删除，Midscene 看到的是标准 YAML。
     */
    baseScript?: string;
  }>;
}
