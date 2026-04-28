import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import type { MetricsReport, ParsedExecution, StepMetrics, TaskUsage } from "../types/index.js";

const _require = createRequire(import.meta.url);

// Midscene 转义规则：HTML 中 < > 被替换为 __midscene_lt__ __midscene_gt__
function antiEscapeScriptTag(html: string): string {
  return html.replace(/__midscene_lt__/g, "<").replace(/__midscene_gt__/g, ">");
}

/**
 * 从 HTML 尾部增量提取本次运行的 execution 数据。
 * Midscene 按时间顺序追加 dump script 到 HTML 尾部，本次运行的数据在文件末尾。
 * 只读取尾部 ~2-8MB（而非全量 90MB），只处理 logTime >= minLogTime 的 execution。
 */
function extractRecentExecutions(
  htmlPath: string,
  minLogTime: number,
): { executions: Record<string, unknown>[]; sdkVersion: string } | null {
  const INITIAL_TAIL_SIZE = 2 * 1024 * 1024; // 2MB
  const MAX_TAIL_SIZE = 16 * 1024 * 1024; // 16MB
  const fileSize = fs.statSync(htmlPath).size;
  if (fileSize === 0) return null;

  const screenshotsDir = path.join(path.dirname(htmlPath), "screenshots");

  for (let tailSize = INITIAL_TAIL_SIZE; tailSize <= MAX_TAIL_SIZE; tailSize *= 2) {
    const readSize = Math.min(tailSize, fileSize);
    const startOffset = fileSize - readSize;

    const fd = fs.openSync(htmlPath, "r");
    const buffer = Buffer.alloc(readSize);
    fs.readSync(fd, buffer, 0, readSize, startOffset);
    fs.closeSync(fd);

    const tail = buffer.toString("utf-8");

    // 收集尾部 buffer 中的 midscene-image 标签（截图 base64 数据）
    const imageMap = new Map<string, string>();
    const imageTagRe = /<script type="midscene-image" data-id="([^"]+)">([\s\S]*?)<\/script>/g;
    let imgMatch: RegExpExecArray | null;
    while ((imgMatch = imageTagRe.exec(tail)) !== null) {
      const id = imgMatch[1];
      const data = imgMatch[2];
      if (id && data) imageMap.set(id, antiEscapeScriptTag(data.trim()));
    }

    // 提取 midscene_web_dump 标签
    // Midscene 每次状态变化都追加一个 dump 快照，同一个 execution 会出现多次
    // 用 Map 去重，后出现的覆盖先出现的（最终状态）
    const dumpTagRe = /<script type="midscene_web_dump"[^>]*>([\s\S]*?)<\/script>/g;
    const execMap = new Map<string, Record<string, unknown>>();
    let sdkVersion = "unknown";
    let foundAnyDump = false;

    let dumpMatch: RegExpExecArray | null;
    while ((dumpMatch = dumpTagRe.exec(tail)) !== null) {
      foundAnyDump = true;
      const content = dumpMatch[1] ? antiEscapeScriptTag(dumpMatch[1].trim()) : "";
      if (!content) continue;

      let dump: Record<string, unknown>;
      try {
        dump = JSON.parse(content);
      } catch {
        continue;
      }

      if (sdkVersion === "unknown" && dump.sdkVersion) {
        sdkVersion = dump.sdkVersion as string;
      }

      const executions = dump.executions as Record<string, unknown>[] | undefined;
      if (!executions) continue;

      for (const exec of executions) {
        const logTime = exec.logTime as number | undefined;
        if (logTime !== undefined && logTime >= minLogTime) {
          const execId = exec.id as string | undefined;
          const key = execId ?? `${exec.name}|${logTime}`;
          externalizeScreenshots(exec, screenshotsDir, htmlPath, imageMap);
          execMap.set(key, exec);
        }
      }
    }

    if (execMap.size > 0) {
      return { executions: Array.from(execMap.values()), sdkVersion };
    }

    if (foundAnyDump) return null;

    if (readSize >= fileSize) return null;
  }

  return null;
}

/**
 * 将 execution 中的 inline 截图引用转为文件引用。
 * 优先使用已有的截图文件，其次从 HTML 尾部 buffer 中提取 base64 数据写入文件。
 */
function externalizeScreenshots(
  node: unknown,
  screenshotsDir: string,
  _htmlPath: string,
  imageMap: Map<string, string>,
): void {
  if (Array.isArray(node)) {
    for (const item of node) externalizeScreenshots(item, screenshotsDir, _htmlPath, imageMap);
    return;
  }
  if (typeof node !== "object" || node === null) return;

  const record = node as Record<string, unknown>;
  if (
    record.type === "midscene_screenshot_ref" &&
    typeof record.id === "string" &&
    record.storage === "inline" &&
    (record.mimeType === "image/png" || record.mimeType === "image/jpeg")
  ) {
    const ext = record.mimeType === "image/jpeg" ? "jpeg" : "png";
    const fileName = `${record.id}.${ext}`;
    const relativePath = `./screenshots/${fileName}`;
    const absolutePath = path.join(screenshotsDir, fileName);

    if (!fs.existsSync(absolutePath)) {
      const dataUri = imageMap.get(record.id as string);
      if (dataUri) {
        fs.mkdirSync(screenshotsDir, { recursive: true });
        const rawBase64 = dataUri.replace(/^data:image\/[a-zA-Z+]+;base64,/, "");
        fs.writeFileSync(absolutePath, Buffer.from(rawBase64, "base64"));
      }
    }

    if (fs.existsSync(absolutePath)) {
      record.storage = "file";
      record.path = relativePath;
    }
    return;
  }

  for (const value of Object.values(record)) {
    externalizeScreenshots(value, screenshotsDir, _htmlPath, imageMap);
  }
}

export function parseReportFile(
  htmlPath: string,
  options?: { scriptStartTime?: number },
): {
  executions: ParsedExecution[];
  sdkVersion: string;
} {
  if (!fs.existsSync(htmlPath)) {
    return { executions: [], sdkVersion: "unknown" };
  }

  const minLogTime = options?.scriptStartTime ?? 0;

  // 增量路径：scriptStartTime 存在时，从 HTML 尾部直接提取本次运行的 execution
  if (minLogTime > 0) {
    const result = extractRecentExecutions(htmlPath, minLogTime);
    if (result && result.executions.length > 0) {
      return {
        executions: rawExecutionsToParseResult(result.executions),
        sdkVersion: result.sdkVersion,
      };
    }
  }

  // Fallback：全量解析（首次运行、无 scriptStartTime、或增量提取失败）
  const outputDir = path.dirname(htmlPath);
  let executionJsonFiles: string[];
  const existingFiles = fs.readdirSync(outputDir).filter((f) => /^\d+\.execution\.json$/.test(f));

  if (existingFiles.length > 0) {
    const htmlMtime = fs.statSync(htmlPath).mtimeMs;
    const jsonMtimeMax = existingFiles.reduce((max, f) => {
      return Math.max(max, fs.statSync(path.join(outputDir, f)).mtimeMs);
    }, 0);

    if (jsonMtimeMax >= htmlMtime) {
      executionJsonFiles = existingFiles.map((f) => path.join(outputDir, f)).sort();
    } else {
      const result = splitReportFileWithTimeout({ htmlPath, outputDir }, 300000);
      executionJsonFiles = result.executionJsonFiles;
    }
  } else {
    const result = splitReportFileWithTimeout({ htmlPath, outputDir }, 300000);
    executionJsonFiles = result.executionJsonFiles;
  }

  const executions: ParsedExecution[] = [];
  let sdkVersion = "unknown";

  for (const jsonFile of executionJsonFiles) {
    if (!fs.existsSync(jsonFile)) continue;

    if (sdkVersion === "unknown") {
      const rawMeta = JSON.parse(fs.readFileSync(jsonFile, "utf-8"));
      sdkVersion = (rawMeta.sdkVersion as string) ?? "unknown";
    }

    const raw = JSON.parse(fs.readFileSync(jsonFile, "utf-8"));
    const executionList = raw.executions ?? [];

    for (const exec of executionList) {
      const execLogTime = exec.logTime as number | undefined;
      if (minLogTime > 0 && execLogTime !== undefined && execLogTime < minLogTime) continue;

      const taskList = exec.tasks ?? [];
      const execId = exec.id ?? "";

      for (const task of taskList) {
        const output = task.output ?? {};
        const param = task.param ?? {};
        const yamlFlow = output.yamlFlow as ParsedExecution["yamlFlow"];
        const actions = output.actions as ParsedExecution["actions"];

        executions.push({
          executionId: execId,
          executionLogTime: execLogTime,
          taskName: exec.name ?? "",
          subType: task.subType ?? "",
          userInstruction: param.userInstruction ?? "",
          status: task.status ?? "",
          durationMs: task.timing?.cost ?? 0,
          actions,
          yamlFlow: yamlFlow?.length ? yamlFlow : undefined,
          outputOutput: output.output ?? undefined,
          shouldContinuePlanning: output.shouldContinuePlanning ?? undefined,
          _rawTask: {
            status: task.status,
            subType: task.subType,
            param: task.param,
            timing: task.timing,
            usage: task.usage,
            searchAreaUsage: task.searchAreaUsage,
            output: task.output,
            hitBy: task.hitBy,
            recorder: task.recorder,
            uiContext: task.uiContext,
            log: task.log,
            error: task.error,
            errorMessage: task.errorMessage,
            errorStack: task.errorStack,
          } as unknown as Record<string, unknown>,
        });
      }
    }
  }

  return { executions, sdkVersion };
}

/** 将从 HTML 直接提取的 raw execution 对象转为 ParsedExecution[] */
function rawExecutionsToParseResult(rawExecs: Record<string, unknown>[]): ParsedExecution[] {
  const executions: ParsedExecution[] = [];
  for (const exec of rawExecs) {
    const taskList = (exec.tasks ?? []) as Record<string, unknown>[];
    const execId = (exec.id ?? "") as string;
    const execLogTime = exec.logTime as number | undefined;

    for (const task of taskList) {
      const output = (task.output ?? {}) as Record<string, unknown>;
      const param = (task.param ?? {}) as Record<string, unknown>;
      const yamlFlow = output.yamlFlow as ParsedExecution["yamlFlow"];
      const actions = output.actions as ParsedExecution["actions"];

      executions.push({
        executionId: execId,
        executionLogTime: execLogTime,
        taskName: (exec.name ?? "") as string,
        subType: (task.subType ?? "") as string,
        userInstruction: (param.userInstruction ?? "") as string,
        status: (task.status ?? "") as string,
        durationMs: ((task.timing as Record<string, unknown>)?.cost ?? 0) as number,
        actions,
        yamlFlow: (yamlFlow as unknown[])?.length ? yamlFlow : undefined,
        outputOutput: (output.output as string) ?? undefined,
        shouldContinuePlanning: (output.shouldContinuePlanning as boolean) ?? undefined,
        _rawTask: {
          status: task.status,
          subType: task.subType,
          param: task.param,
          timing: task.timing,
          usage: task.usage,
          searchAreaUsage: task.searchAreaUsage,
          output: task.output,
          hitBy: task.hitBy,
          recorder: task.recorder,
          uiContext: task.uiContext,
          log: task.log,
          error: task.error,
          errorMessage: task.errorMessage,
          errorStack: task.errorStack,
        } as unknown as Record<string, unknown>,
      });
    }
  }
  return executions;
}

function splitReportFileWithTimeout(
  params: { htmlPath: string; outputDir: string },
  _timeoutMs: number,
): { executionJsonFiles: string[] } {
  const { splitReportHtmlByExecution } = _require("@midscene/core") as {
    splitReportHtmlByExecution: (params: { htmlPath: string; outputDir: string }) => {
      executionJsonFiles: string[];
    };
  };
  return splitReportHtmlByExecution(params);
}

/** 按 Midscene 执行阶段归一化分组（同 phase 的重复 execution 合并）
 * 用于将 Midscene 报告中的多个 execution 条目按阶段归组，
 * 生成我们自己的 step 视图。
 */
function normalizeExecName(name: string): string {
  return (name || "")
    .toLowerCase()
    .replace(
      /^(input|tap|assert|sleep|scroll|hover|keyboardpress|doubleclick|rightclick|locate|plan)\s*[-–—]\s*/i,
      "$1:",
    )
    .replace(/\s+/g, " ")
    .trim();
}

const EXEC_PREFIX_MAP: Record<string, string> = {
  tap: "点击",
  input: "输入到",
  locate: "定位",
  assert: "断言",
  sleep: "等待",
  scroll: "滚动",
  hover: "悬停",
  keyboardpress: "按键",
  doubleclick: "双击",
  rightclick: "右键点击",
};

function friendlyFromExecName(execName: string): string {
  const m = execName.match(
    /^(Tap|Input|Locate|Assert|Sleep|Scroll|Hover|KeyboardPress|DoubleClick|RightClick)\s*[-–—]\s*(.+)$/i,
  );
  if (!m || !m[1] || !m[2]) return execName;
  const prefix = EXEC_PREFIX_MAP[m[1].toLowerCase()] ?? m[1];
  return `${prefix} ${m[2]}`;
}

/** 从 task 参数推断 userInstruction
 * 源码证据：midscene_run/report/1.execution.json — Locate 任务用 param.prompt，
 * Action Space Input 任务用 param.value + param.locate.description
 */
function inferUserInstruction(
  rawTask: NonNullable<ParsedExecution["_rawTask"]>,
  execName: string,
): string {
  const param = (rawTask as Record<string, unknown>).param as Record<string, unknown> | undefined;
  if (!param) return friendlyFromExecName(execName);
  const subType = (rawTask as Record<string, unknown>).subType as string | undefined;

  if (subType === "Plan") {
    return String(param.prompt ?? param.userInstruction ?? friendlyFromExecName(execName));
  }
  if (subType === "Locate") {
    // param.prompt 只有元素名（如 "账号输入框"），不含动作上下文
    // execName 如 "Tap - 账号输入框" 包含完整信息，从 execName 解析
    return friendlyFromExecName(execName);
  }
  if (subType === "Input") {
    const value = String(param.value ?? "");
    const locate = (param.locate as Record<string, unknown>)?.description as string | undefined;
    return locate ? `输入"${value}"到 ${locate}` : friendlyFromExecName(execName);
  }
  if (subType === "Tap") {
    const locate = (param.locate as Record<string, unknown>)?.description as string | undefined;
    return locate ? `点击 ${locate}` : friendlyFromExecName(execName);
  }
  if (subType === "Sleep") {
    return `等待${param.timeMs ?? 3000}ms`;
  }
  if (subType === "Assert") {
    return String(param.dataDemand ?? friendlyFromExecName(execName));
  }
  return friendlyFromExecName(execName);
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
 * 从 .execution.json 数据中提取 metrics
 * 分组逻辑：按 exec.name 归一化分组（同阶段重复执行合并）
 */
export function parseMetricsFromExecutions(params: {
  executions: ParsedExecution[];
  sdkVersion?: string;
  startUrl?: string;
  scriptStartTime?: number;
  scriptEndTime?: number;
}): Pick<MetricsReport, "environment" | "summary" | "steps"> {
  // 按 exec.name 归一化分组（同阶段重复执行合并）
  const stepMap = new Map<
    string,
    {
      userInstruction: string;
      tasks: NonNullable<ParsedExecution["_rawTask"]>[];
      /** 缓存命中标记（任一 task 有 hitBy.from === "Cache" 即为 true） */
      hitByCache: boolean;
      /** 估算节省的 token 数（缓存命中时，SDK 不调用 AI，估算每次 Locate ≈ 2836 tokens） */
      cachedTokensEstimate: number;
      /** 绝对时间戳基准（execution.logTime），用于推导 absoluteStartTime */
      executionLogTime?: number;
      /** 是否为断言任务（根据 execution 名字判断） */
      isAssertFlag: boolean;
    }
  >();

  for (const exec of params.executions) {
    const rawTask = exec._rawTask;
    if (!rawTask) continue;

    // 判断是否为断言任务（"Assert - xxx" 或 "Insight - xxx" 格式）
    const execTaskName = exec.taskName ?? "";
    const execTaskNameLower = execTaskName.toLowerCase();
    const isExecAssert =
      execTaskNameLower.startsWith("assert") ||
      execTaskNameLower.startsWith("insight") ||
      execTaskNameLower.includes("断言");

    // B1: 改用 exec.name 归一化分组，替代 execution.id
    const groupKey = normalizeExecName(exec.taskName);

    if (!stepMap.has(groupKey)) {
      // B2: 从 task 参数推断 userInstruction，替代 param.userInstruction
      stepMap.set(groupKey, {
        userInstruction: inferUserInstruction(rawTask, exec.taskName),
        tasks: [],
        hitByCache: false,
        cachedTokensEstimate: 0,
        executionLogTime: exec.executionLogTime,
        isAssertFlag: isExecAssert,
      });
    } else {
      // 如果同名 group 已有，更新 isAssertFlag（如果任一 execution 是 assert 则为 assert）
      const existing = stepMap.get(groupKey)!;
      existing.isAssertFlag = existing.isAssertFlag || isExecAssert;
    }
    stepMap.get(groupKey)!.tasks.push(rawTask);

    // B3: 检测缓存命中（hitBy.from === "Cache"）
    // hitBy 在 task 顶层（与 output 同级），不在 output 内部
    const taskRecord = rawTask as Record<string, unknown>;
    const hitBy = taskRecord.hitBy as Record<string, unknown> | undefined;
    if (hitBy?.from === "Cache") {
      stepMap.get(groupKey)!.hitByCache = true;
      // 缓存命中时 SDK 不调用 AI，估算节省约 2836 tokens（截图 vision input）
      stepMap.get(groupKey)!.cachedTokensEstimate += 2836;
    }
  }

  const steps: StepMetrics[] = [];

  for (const [, group] of stepMap) {
    const tasks = group.tasks;
    if (tasks.length === 0) continue;
    const task0 = tasks[0]!;

    // wallTimeMs = sum of each task's actual duration (task.end - task.start)
    // Previously used lastEnd - firstStart which spans across all executions,
    // giving inflated times like ~4100s per step instead of the real ~5s
    const wallTimeMs = tasks.reduce((sum, t) => {
      const start = t.timing?.start ?? 0;
      const end = t.timing?.end ?? 0;
      return sum + Math.max(0, end - start);
    }, 0);

    // aiTimeMs = 累加所有 Plan / Locate / Assert 任务的 timing.cost
    const aiTimeMs = tasks.reduce((sum, t) => {
      const subType = t.subType ?? "";
      if (subType === "Plan" || subType === "Locate" || subType === "Assert") {
        return sum + ((t.timing?.cost as number) ?? 0);
      }
      return sum;
    }, 0);

    // status = 第一个 task 的状态
    // cancelled 任务（因前置失败被取消）应标记为 skipped，而非 failed
    const rawStatus = task0.status ?? "";
    const status = (
      rawStatus === "finished"
        ? "finished"
        : rawStatus === "failed"
          ? "failed"
          : rawStatus === "cancelled"
            ? "skipped"
            : "failed"
    ) as "finished" | "failed" | "skipped" | "cancelled";

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

    // isAssert = 直接从 stepMap 的 isAssertFlag 取值（在 stepMap 构建时已计算）
    const isAssertFlag = group.isAssertFlag;

    // screenshots = 从每个 task 的 uiContext.screenshot.path 和 recorder[].screenshot.path 提取（去重）
    // 修复截图路径：./screenshots/xxx.jpeg -> ../../../report/screenshots/xxx.jpeg
    // 原因：HTML 报告在 midscene_run/output/reports/run/，截图在 midscene_run/report/screenshots/
    //       从 HTML 目录出发：..→reports/，../..→output/，../../..→midscene_run/，../../../report→midscene_run/report/
    const screenshotSet = new Set<string>();
    const screenshots: string[] = [];
    const fixScreenshotPath = (p: string) =>
      p.startsWith("./screenshots/") ? `../../../report/${p.slice(2)}` : p;
    for (const t of tasks) {
      const ss = t.uiContext?.screenshot as Record<string, unknown> | undefined;
      const screenshotPath = (ss?.path as string) ?? "";
      if (screenshotPath) {
        const fixed = fixScreenshotPath(screenshotPath);
        if (!screenshotSet.has(fixed)) {
          screenshotSet.add(fixed);
          screenshots.push(fixed);
        }
      }
      const recorder = t.recorder;
      if (recorder) {
        for (const entry of recorder) {
          const entrySs = entry.screenshot as Record<string, unknown> | undefined;
          const recPath = (entrySs?.path as string) ?? "";
          if (recPath) {
            const fixed = fixScreenshotPath(recPath);
            if (!screenshotSet.has(fixed)) {
              screenshotSet.add(fixed);
              screenshots.push(fixed);
            }
          }
        }
      }
    }

    // absoluteStartTime = execution.logTime（timing.start 本身已是毫秒级时间戳，再相加会溢出）
    const absoluteStartTime =
      group.executionLogTime !== undefined ? group.executionLogTime : undefined;

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
      hitByCache: group.hitByCache,
      isAssert: isAssertFlag || undefined,
      absoluteStartTime,
      ...(status === "failed"
        ? (() => {
            const lastTask = tasks[tasks.length - 1]!;
            const errName = (lastTask as Record<string, unknown>).error as
              | Record<string, unknown>
              | undefined;
            const errType = (errName?.name as string) ?? undefined;
            const errMsg = (lastTask as Record<string, unknown>).errorMessage as string | undefined;
            const errStack = (lastTask as Record<string, unknown>).errorStack as string | undefined;
            const lastUiCtx = (lastTask as Record<string, unknown>).uiContext as
              | Record<string, unknown>
              | undefined;
            const ss = lastUiCtx?.screenshot as Record<string, unknown> | undefined;
            const failSs = (ss?.path as string) ?? undefined;
            return {
              ...(errType ? { errorType: errType } : {}),
              ...(errMsg ? { errorMessage: errMsg } : {}),
              ...(failSs ? { failureScreenshot: failSs } : {}),
              ...(errStack ? { errorStack: errStack } : {}),
            };
          })()
        : {}),
    });
  }

  // 汇总
  // 进程级别墙钟时间 = scriptEndTime - scriptStartTime
  // 包括：Midscene CLI 启动 + SDK 执行 + 报告解析
  // 注意：这不是 SDK 的 summary.duration（纯引擎执行时间），而是整个 Node 进程的生命周期
  const totalWallTimeMs = params.scriptStartTime
    ? (params.scriptEndTime ?? Date.now()) - params.scriptStartTime
    : steps.reduce((sum, s) => sum + s.aiTimeMs, 0);
  let totalAiTimeMs = 0;
  let totalTokens = 0;
  let totalCachedTokens = 0;
  let hitByCacheCount = 0;
  let passCount = 0;
  let failCount = 0;
  let skipCount = 0;
  let assertCount = 0;
  let estimatedSavedTokens = 0;
  const modelMap = new Map<
    string,
    { tokens: number; prompt: number; completion: number; cached: number; aiTime: number }
  >();

  for (const step of steps) {
    totalAiTimeMs += step.aiTimeMs;
    if (step.hitByCache) {
      hitByCacheCount++;
    }
    if (step.status === "finished") passCount++;
    else if (step.status === "failed") failCount++;
    else if (step.status === "skipped" || step.status === "cancelled") skipCount++;
    if (step.isAssert) assertCount++;
    if (step.usage) {
      totalTokens += step.usage.totalTokens;
      totalCachedTokens += step.usage.cachedTokens;
      const key = `${step.usage.modelName}:${step.usage.intent}`;
      const prev = modelMap.get(key) ?? { tokens: 0, prompt: 0, completion: 0, cached: 0, aiTime: 0 };
      modelMap.set(key, {
        tokens: prev.tokens + step.usage.totalTokens,
        prompt: prev.prompt + step.usage.promptTokens,
        completion: prev.completion + step.usage.completionTokens,
        cached: prev.cached + step.usage.cachedTokens,
        aiTime: prev.aiTime + step.aiTimeMs,
      });
    }
  }

  // 从 stepMap 汇总估算节省 token（缓存命中时 SDK 不调用 AI，无 usage 字段）
  for (const [, group] of stepMap) {
    estimatedSavedTokens += group.cachedTokensEstimate;
  }

  // 计算 token 消耗结构分解
  // locateCallCount = 非 Assert、非 Sleep、非 Locate 的 step 数
  // 注意：Midscene 的 yamlFlow 条目全部是 Action Space 类型（Tap/Input），
  // Locate 任务属于 Planning 层，不单独出现在 yamlFlow 中
  const locateCallCount = steps.filter(
    (s) => !s.isAssert && !s.userInstruction.startsWith("等待"),
  ).length;
  // 平均每次 Locate token（无缓存时）
  const nonCachedLocateSteps = steps.filter(
    (s) => s.subTasks > 0 && !s.isAssert && !s.hitByCache && s.usage,
  );
  const tokenPerLocate =
    nonCachedLocateSteps.length > 0
      ? Math.round(
          nonCachedLocateSteps.reduce((sum, s) => sum + (s.usage?.totalTokens ?? 0), 0) /
            nonCachedLocateSteps.length,
        )
      : 2836;
  // 平均每次 Assert token
  const assertSteps = steps.filter((s) => s.isAssert && s.usage);
  const tokenPerAssert =
    assertSteps.length > 0
      ? Math.round(
          assertSteps.reduce((sum, s) => sum + (s.usage?.totalTokens ?? 0), 0) / assertSteps.length,
        )
      : 3241;

  // 计算耗时结构分解
  // totalExecutionWallTimeMs = 分步 wallTime 相加（不含 CLI 启动 / 浏览器启动 / 页面加载等开销）
  // overheadMs = 进程总耗时 - step 执行耗时
  const totalExecutionWallTimeMs = steps.reduce((sum, s) => sum + s.wallTimeMs, 0);
  const overheadMs = Math.max(0, totalWallTimeMs - totalExecutionWallTimeMs);

  const modelBreakdown = Array.from(modelMap.entries()).map(([key, val]) => {
    const colonIdx = key.indexOf(":");
    const modelName = colonIdx >= 0 ? key.slice(0, colonIdx) : key;
    const intent = colonIdx >= 0 ? key.slice(colonIdx + 1) : "";
    return {
      modelName,
      intent,
      steps: steps.length,
      totalTokens: val.tokens,
      promptTokens: val.prompt,
      completionTokens: val.completion,
      cachedTokens: val.cached,
      totalAiTimeMs: val.aiTime,
    };
  });

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
      /** 缓存命中 step 数（通过 hitBy.from === "Cache" 检测，命中时 SDK 不调用 AI） */
      hitByCacheCount,
      finishedSteps: passCount,
      failCount,
      skipCount,
      /** 断言步骤数 */
      assertCount,
      modelBreakdown,
      /** 估算节省 token（缓存命中时 SDK 不调用 AI，每次 Locate 约 2836 tokens） */
      estimatedSavedTokens,
      /** Token 消耗结构分解 */
      tokenPerLocate,
      tokenPerAssert,
      locateCallCount,
      /** 仅 step 执行耗时（分步 wallTime 相加），不含 CLI 启动 / 浏览器启动 / 页面加载等开销 */
      totalExecutionWallTimeMs,
      /** 总进程耗时中的非执行开销（totalWallTimeMs - totalExecutionWallTimeMs） */
      overheadMs,
    },
    steps,
  };
}

/** YAML flow 条目原始类型 */
interface RawYamlFlowItem {
  [key: string]: unknown;
}
