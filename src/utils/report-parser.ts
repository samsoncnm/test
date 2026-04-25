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
      const execId = exec.id ?? "";

      for (const task of taskList) {
        const output = task.output ?? {};
        const param = task.param ?? {};

        // 跳过 Plan 类型（只有 yamlFlow 非空时才记录）
        // 优先提取 yamlFlow，其次提取 actions，最后降级
        const yamlFlow = output.yamlFlow as ParsedExecution["yamlFlow"];
        const actions = output.actions as ParsedExecution["actions"];

        executions.push({
          executionId: execId,
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
 * 累加所有有 usage 的 task 的 token 数据
 */
function aggregateUsage(tasks: NonNullable<ParsedExecution["_rawTask"]>[]): TaskUsage | undefined {
  let totalPrompt = 0;
  let totalCompletion = 0;
  let totalTokens = 0;
  let totalCached = 0;
  let totalTimeCost = 0;
  let modelName = "";
  let intent = "";

  for (const t of tasks) {
    if (t.usage) {
      totalPrompt += (t.usage.prompt_tokens as number) ?? 0;
      totalCompletion += (t.usage.completion_tokens as number) ?? 0;
      totalTokens += (t.usage.total_tokens as number) ?? 0;
      totalCached += (t.usage.cached_input as number) ?? 0;
      totalTimeCost += (t.usage.time_cost as number) ?? 0;
      if (!modelName && (t.usage.model_name as string)) {
        modelName = t.usage.model_name as string;
        intent = t.usage.intent as string;
      }
    }
  }

  if (totalTokens === 0) return undefined;
  return {
    promptTokens: totalPrompt,
    completionTokens: totalCompletion,
    totalTokens,
    cachedTokens: totalCached,
    timeCostMs: totalTimeCost,
    modelName,
    intent,
  };
}

/**
 * 从 HTML 中检测有多少个不同的 data-group-id（即 SDK 执行了多少遍）
 */
export function detectPassInfo(htmlPath: string): { passIds: string[]; passCount: number } {
  try {
    const html = fs.readFileSync(htmlPath, "utf-8");
    const matches = [...html.matchAll(/data-group-id="([^"]+)"/g)];
    const passIds = [...new Set(matches.map((m) => m[1]!).filter(Boolean))];
    return { passIds, passCount: passIds.length };
  } catch {
    return { passIds: [], passCount: 0 };
  }
}

/**
 * 从 .execution.json 数据中提取 metrics
 * 分组逻辑：按 execution.id 分组（每个 execution.id = 一个完整的 aiAct 调用）
 * 对 double-pass 完全免疫（SDK 执行 N 遍，分 N 个 execution.id 组）
 */
export function parseMetricsFromExecutions(params: {
  executions: ParsedExecution[];
  sdkVersion?: string;
  startUrl?: string;
  htmlPath?: string;
}): Pick<MetricsReport, "environment" | "summary" | "steps" | "passInfo"> {
  // 按 execution.id 分组
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

    const groupKey = exec.executionId || `no-id-${stepMap.size}`;

    if (!stepMap.has(groupKey)) {
      stepMap.set(groupKey, {
        userInstruction: (rawTask.param?.userInstruction as string) ?? exec.userInstruction ?? "",
        tasks: [],
      });
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

    // aiTimeMs = 累加所有 Plan / Locate / Assert 任务的 timing.cost
    const aiTimeMs = tasks.reduce((sum, t) => {
      const subType = t.subType ?? "";
      if (subType === "Plan" || subType === "Locate" || subType === "Assert") {
        return sum + ((t.timing?.cost as number) ?? 0);
      }
      return sum;
    }, 0);

    // status = 第一个 task 的 status
    const status = (task0.status === "finished" ? "finished" : "failed") as "finished" | "failed";

    // usage = 累加所有 task 的 usage
    const usage = aggregateUsage(tasks);

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
      const ss = t.uiContext?.screenshot as Record<string, unknown> | undefined;
      const screenshotPath = (ss?.path as string) ?? "";
      if (screenshotPath && !screenshotSet.has(screenshotPath)) {
        screenshotSet.add(screenshotPath);
        screenshots.push(screenshotPath);
      }
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

  for (const step of steps) {
    if (step.usage) {
      const entry = modelBreakdown.find(
        (e) => e.modelName === step.usage!.modelName && e.intent === step.usage!.intent,
      );
      if (entry) entry.steps++;
    }
  }

  // 检测 double-pass
  const passInfo = params.htmlPath
    ? detectPassInfo(params.htmlPath)
    : { passIds: [], passCount: 0 };

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
    passInfo: {
      detected: passInfo.passCount > 1,
      passCount: passInfo.passCount,
      passIds: (passInfo.passIds || []).filter(
        (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      ),
    },
  };
}

/** YAML flow 条目原始类型 */
interface RawYamlFlowItem {
  [key: string]: unknown;
}
