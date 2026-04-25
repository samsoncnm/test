/**
 * Midscene 报告解析器
 * 使用 splitReportFile 解析 HTML 报告，提取 execution JSON 中的 yamlFlow 数据和 metrics 数据
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { splitReportFile } from "@midscene/core";
import type { MetricsReport, ParsedExecution, StepMetrics, TaskUsage } from "../types/index.js";

/**
 * 解析 Midscene HTML 报告文件，提取所有 execution 数据
 *
 * @param htmlPath - Midscene HTML 报告文件路径
 * @returns 解析后的 execution 列表
 */
export function parseReportFile(htmlPath: string): ParsedExecution[] {
  if (!fs.existsSync(htmlPath)) {
    return [];
  }

  const outputDir = path.dirname(htmlPath);

  // splitReportFile 是同步函数，会在 outputDir 下生成 .execution.json 文件
  const result = splitReportFile({ htmlPath, outputDir });

  const executions: ParsedExecution[] = [];

  for (const jsonFile of result.executionJsonFiles) {
    if (!fs.existsSync(jsonFile)) {
      continue;
    }

    const raw = JSON.parse(fs.readFileSync(jsonFile, "utf-8"));
    const executionList = raw.executions ?? [];

    for (const exec of executionList) {
      const taskList = exec.tasks ?? [];

      for (const task of taskList) {
        const output = task.output ?? {};
        const param = task.param ?? {};

        // 跳过 Plan 类型（只有 yamlFlow 非空时才记录）
        // 优先提取 yamlFlow，其次提取 actions，最后降级
        const yamlFlow = output.yamlFlow as ParsedExecution["yamlFlow"];
        const actions = output.actions as ParsedExecution["actions"];

        executions.push({
          taskName: exec.name ?? "",
          subType: task.subType ?? "",
          userInstruction: param.userInstruction ?? "",
          status: task.status ?? "",
          durationMs: task.timing?.cost ?? 0,
          actions,
          yamlFlow: yamlFlow?.length ? yamlFlow : undefined,
          outputOutput: output.output ?? undefined,
          shouldContinuePlanning: output.shouldContinuePlanning ?? undefined,
          _rawTask: task as unknown as Record<string, unknown>,
        });
      }
    }
  }

  return executions;
}

/**
 * 等待 .execution.json 文件稳定（文件存在 + 大小 > 0 + 修改时间距今 > 500ms）
 * 用于 run 模式：midscene CLI 退出后文件可能还在写入
 */
export async function waitForExecutionJson(
  reportDir: string,
  htmlFileName: string,
  timeoutMs = 3000,
): Promise<void> {
  const start = Date.now();
  const expectedJson = path.join(reportDir, `${htmlFileName}.execution.json`);

  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(expectedJson)) {
      const stat = fs.statSync(expectedJson);
      if (stat.size > 0 && Date.now() - stat.mtimeMs > 500) {
        return;
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** 辅助：将 Midscene usage 字段映射为 TaskUsage */
function mapUsage(raw?: Record<string, unknown>): TaskUsage | undefined {
  if (!raw) return undefined;
  return {
    promptTokens: (raw["prompt_tokens"] as number) ?? 0,
    completionTokens: (raw["completion_tokens"] as number) ?? 0,
    totalTokens: (raw["total_tokens"] as number) ?? 0,
    cachedTokens: (raw["cached_input"] as number) ?? 0,
    timeCostMs: (raw["time_cost"] as number) ?? 0,
    modelName: (raw["model_name"] as string) ?? "",
    intent: (raw["intent"] as string) ?? "",
  };
}

/**
 * 从 .execution.json 数据中提取 metrics
 * 分组逻辑：Plan 任务携带 userInstruction，同一个 aiAct 调用的所有子 task 共享同一 instruction
 */
export function parseMetricsFromExecutions(params: {
  executions: ParsedExecution[];
  sdkVersion?: string;
  startUrl?: string;
}): Pick<MetricsReport, "environment" | "summary" | "steps"> {
  // 按 userInstruction 分组，同一 aiAct 的子 task 共享同一 instruction
  const stepMap = new Map<
    string,
    {
      userInstruction: string;
      tasks: NonNullable<ParsedExecution["_rawTask"]>[];
    }
  >();

  for (const exec of params.executions) {
    const rawTask = exec._rawTask;
    if (!rawTask) continue;

    const userInstruction = (rawTask.param?.userInstruction as string) ?? exec.userInstruction;
    const groupKey = userInstruction;

    if (!stepMap.has(groupKey)) {
      stepMap.set(groupKey, { userInstruction, tasks: [] });
    }
    stepMap.get(groupKey)!.tasks.push(rawTask);
  }

  const steps: StepMetrics[] = [];

  for (const [, group] of stepMap) {
    const tasks = group.tasks;
    if (tasks.length === 0) continue;
    const task0 = tasks[0]!;

    // wallTimeMs = 最后一个 task.end - 第一个 task.start
    const firstStart = task0.timing?.start ?? 0;
    const lastEnd = tasks.reduce((max, t) => Math.max(max, t.timing?.end ?? 0), 0);
    const wallTimeMs = Math.max(0, lastEnd - firstStart);

    // aiTimeMs = 累加所有 Plan/Locate 任务的 timing.cost
    const aiTimeMs = tasks.reduce((sum, t) => {
      const subType = t.subType ?? "";
      if (subType === "Plan" || subType === "Locate") {
        return sum + ((t.timing?.cost as number) ?? 0);
      }
      return sum;
    }, 0);

    // status = 第一个 task 的 status（Plan 任务决定整体状态）
    const status = (task0.status === "finished" ? "finished" : "failed") as "finished" | "failed";

    // 主模型 usage = 第一个 task（Plan 任务）的 usage
    const usage = mapUsage(task0.usage);

    // locateUsage = 累加所有 Locate 任务的 searchAreaUsage
    let locateUsage: TaskUsage | undefined;
    for (const t of tasks) {
      if ((t.subType ?? "") === "Locate") {
        const searchArea = t.searchAreaUsage;
        if (searchArea) {
          if (!locateUsage) {
            locateUsage = mapUsage(searchArea);
          } else {
            const mapped = mapUsage(searchArea);
            if (mapped) {
              locateUsage.promptTokens += mapped.promptTokens;
              locateUsage.totalTokens += mapped.totalTokens;
            }
          }
        }
      }
    }

    // actions = 从 yamlFlow 提取（先扁平化，再推断 locate，最后去重）
    const actionSet = new Set<string>();
    const actions: StepMetrics["actions"] = [];

    // 扁平化所有 task 的 yamlFlow
    const flatFlow: RawYamlFlowItem[] = [];
    for (const t of tasks) {
      const yf = t.output?.yamlFlow as RawYamlFlowItem[] | undefined;
      if (yf) flatFlow.push(...yf);
    }

    // locate 推断：aiInput 无 locate 时，只看紧邻前序 Tap
    for (let i = 0; i < flatFlow.length; i++) {
      const item = flatFlow[i]!;
      const actionKey = Object.keys(item).find(
        (k) => k !== "locate" && k !== "value" && k !== "timeout",
      );
      if (actionKey === "aiInput" && !item.locate && item.value) {
        const prev = flatFlow[i - 1];
        if (prev) {
          const prevKey = Object.keys(prev).find(
            (k) => k !== "locate" && k !== "value" && k !== "timeout",
          );
          if (prevKey === "aiTap" && prev.locate) {
            item.locate = prev.locate;
          }
        }
      }
    }

    // 从推断后的 flatFlow 提取 actions
    // aiInput 无 locate（且推断后仍无）：description 取 value 而非空
    for (const item of flatFlow) {
      const actionType = Object.keys(item).find(
        (k) => k !== "locate" && k !== "value" && k !== "timeout",
      );
      if (actionType) {
        const key = `${actionType}:${item.locate ?? item.value ?? ""}`;
        if (!actionSet.has(key)) {
          actionSet.add(key);
          actions.push({
            type: actionType,
            description: (item.locate as string) ?? (item.value as string) ?? "",
          });
        }
      }
    }

    // screenshots = 从每个 task 的 uiContext.screenshot.path 和 recorder[].screenshot.path 提取（去重）
    const screenshotSet = new Set<string>();
    const screenshots: string[] = [];
    for (const t of tasks) {
      // uiContext.screenshot.path
      const ss = t.uiContext?.screenshot as Record<string, unknown> | undefined;
      const screenshotPath = (ss?.path as string) ?? "";
      if (screenshotPath && !screenshotSet.has(screenshotPath)) {
        screenshotSet.add(screenshotPath);
        screenshots.push(screenshotPath);
      }
      // recorder[].screenshot.path
      const recorder = t.recorder;
      if (recorder) {
        for (const entry of recorder) {
          const entrySs = entry.screenshot as Record<string, unknown> | undefined;
          const recPath = (entrySs?.path as string) ?? "";
          if (recPath && !screenshotSet.has(recPath)) {
            screenshotSet.add(recPath);
            screenshots.push(recPath);
          }
        }
      }
    }

    steps.push({
      userInstruction: group.userInstruction,
      status,
      wallTimeMs,
      aiTimeMs,
      subTasks: tasks.length,
      usage,
      locateUsage,
      actions: actions.length > 0 ? actions : undefined,
      screenshots: screenshots.length > 0 ? screenshots : undefined,
    });
  }

  // 汇总
  let totalWallTimeMs = 0;
  let totalAiTimeMs = 0;
  let totalTokens = 0;
  let totalCachedTokens = 0;
  const modelMap = new Map<string, { tokens: number; aiTime: number }>();

  for (const step of steps) {
    totalWallTimeMs += step.wallTimeMs;
    totalAiTimeMs += step.aiTimeMs;
    if (step.usage) {
      totalTokens += step.usage.totalTokens;
      totalCachedTokens += step.usage.cachedTokens;
      const key = `${step.usage.modelName}:${step.usage.intent}`;
      const prev = modelMap.get(key) ?? { tokens: 0, aiTime: 0 };
      modelMap.set(key, {
        tokens: prev.tokens + step.usage.totalTokens,
        aiTime: prev.aiTime + step.aiTimeMs,
      });
    }
  }

  const modelBreakdown = Array.from(modelMap.entries()).map(([key, val]) => {
    const colonIdx = key.indexOf(":");
    const modelName = colonIdx >= 0 ? key.slice(0, colonIdx) : key;
    const intent = colonIdx >= 0 ? key.slice(colonIdx + 1) : "";
    return {
      modelName,
      intent,
      steps: 0,
      totalTokens: val.tokens,
      totalAiTimeMs: val.aiTime,
    };
  });

  // 统计每个模型的 step 数量
  for (const step of steps) {
    if (step.usage) {
      const entry = modelBreakdown.find(
        (e) => e.modelName === step.usage!.modelName && e.intent === step.usage!.intent,
      );
      if (entry) entry.steps++;
    }
  }

  return {
    environment: {
      sdkVersion: params.sdkVersion ?? "unknown",
      startUrl: params.startUrl,
    },
    summary: {
      totalSteps: steps.length,
      totalWallTimeMs,
      totalAiTimeMs,
      totalTokens,
      totalCachedTokens,
      modelBreakdown,
    },
    steps,
  };
}

/** YAML flow 条目原始类型 */
interface RawYamlFlowItem {
  [key: string]: unknown;
}
