/**
 * run 命令
 * 加载 YAML 脚本并通过 midscene CLI 执行
 *
 * 报告解析在主进程内同步完成（增量路径只需 ~12ms CPU），
 * 避免 detached 子进程的 tsx 启动开销和 Windows 文件 I/O 延迟。
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse, stringify } from "yaml";
import { findScriptByFuzzyName, getScriptPath } from "../../storage/script-store.js";
import { saveMetrics, printMetricsSummary } from "../../storage/metrics-store.js";
import type { MetricsReport } from "../../types/index.js";
import { append, entryFromReport, prune } from "../../utils/history-store.js";
import { log } from "../../utils/logger.js";
import {
  parseMetricsFromExecutions,
  parseReportFile,
} from "../../utils/report-parser.js";
import { renderReport } from "../../utils/report-renderer.js";

export async function runScript(
  scriptName: string,
  options?: { headful?: boolean; keepWindow?: boolean; noCache?: boolean },
): Promise<void> {
  const result = await findScriptByFuzzyName(scriptName);

  if (!result.script) {
    throw new Error(`脚本 "${scriptName}" 不存在，请先使用 explore 命令创建`);
  }

  const yamlPath = await getScriptPath(result.script.name);
  const actualName = result.script.name;

  if (result.matchedBy === "pinyin") {
    log(
      "warn",
      `脚本 "${scriptName}" 未找到，已自动纠正为 "${actualName}"（拼音匹配）？继续执行...`,
    );
  } else if (result.matchedBy === "typo") {
    log(
      "warn",
      `脚本 "${scriptName}" 未找到，已自动纠正为 "${actualName}"（错别字容忍）？继续执行...`,
    );
  } else if (result.matchedBy !== "exact") {
    log("warn", `脚本 "${scriptName}" 未找到，猜测你想运行 "${actualName}"？继续执行...`);
  }

  log("info", `脚本路径: ${yamlPath}`);

  if (!yamlPath) {
    throw new Error(`脚本 "${actualName}" 的文件已丢失`);
  }
  const absoluteYamlPath = resolve(yamlPath);
  const projectRoot = process.cwd();

  // 幂等锁：防止外部触发源（npm 重试 / CI 重试 / debugger re-run）导致重复调用
  const lockPath = join(projectRoot, "midscene_run", ".running");

  if (existsSync(lockPath)) {
    const lockPid = readFileSync(lockPath, "utf-8").trim().split("\n")[0] ?? "";
    try {
      process.kill(Number(lockPid), 0);
      throw new Error("already_running");
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ESRCH") {
        // ESRCH = 进程不存在，锁文件已过期，直接删除
        unlinkSync(lockPath);
      } else {
        // 进程存在（EPERM）或未知错误，视为冲突
        throw new Error(
          `检测到已有运行中的脚本 (PID ${lockPid})，请先终止后再试。提示：在任务管理器中结束进程 ${lockPid}，或删除 midscene_run/.running 文件`,
        );
      }
    }
  }

  // 创建锁文件
  writeFileSync(lockPath, `${process.pid}`, "utf-8");

  // ── Delta Freeze 预处理器：展开 baseScript 引用 ─────────────────────────
  const { expandScriptReferences } = await import("../../core/script-expander.js");
  const loadScriptByName = async (name: string) => {
    const result = await findScriptByFuzzyName(name);
    if (!result.script) {
      throw new Error(`baseScript "${name}" 不存在，请检查脚本名称`);
    }
    const path = await getScriptPath(result.script.name);
    if (!path) throw new Error(`baseScript "${name}" 文件已丢失`);
    return { content: readFileSync(path, "utf8"), yamlPath: path };
  };

  const originalYamlContent = readFileSync(absoluteYamlPath, "utf8");
  const doc = parse(originalYamlContent) as Record<string, unknown>;
  const yamlDoc = doc as unknown as Parameters<typeof expandScriptReferences>[0];
  const hasBaseScript = (yamlDoc.tasks ?? []).some((t: Record<string, unknown>) => !!t.baseScript);

  if (hasBaseScript) {
    const expandedDoc = await expandScriptReferences(yamlDoc, undefined, loadScriptByName);
    writeFileSync(absoluteYamlPath, stringify(expandedDoc));
  }

  const needsInject = options?.headful || options?.keepWindow || options?.noCache;
  if (!hasBaseScript) {
    if (!doc.agent) doc.agent = {};
    const agent = doc.agent as Record<string, unknown>;
    if (options.headful) agent.headed = true;
    if (options.keepWindow) agent.keepWindow = true;
    if (options.noCache) agent.cache = false;
    // P1 优化：截图缩放 3 倍（2880x1536 → 960x512），token 预计从 ~2800 → ~420
    agent.screenshotShrinkFactor = 3;
    // P1 优化：限制重规划次数，避免多次重复 AI 调用
    agent.replanningCycleLimit = 1;
    writeFileSync(absoluteYamlPath, stringify(doc));
  }
  // ── 预处理器结束 ─────────────────────────────────────────────────────────

  try {
    try {
      await runMidscene(projectRoot, absoluteYamlPath, actualName, options);
    } finally {
      // 恢复原始 YAML：无论 baseScript 展开还是 agent 注入，都恢复原文件
      writeFileSync(absoluteYamlPath, originalYamlContent);
    }
  } finally {
    // 无论成功还是失败，都要释放锁
    if (existsSync(lockPath)) {
      try {
        unlinkSync(lockPath);
      } catch {
        // 忽略删除锁文件时的错误
      }
    }
  }
}

async function runMidscene(
  projectRoot: string,
  yamlPath: string,
  actualName: string,
  options?: { headful?: boolean; keepWindow?: boolean },
): Promise<void> {
  const midsceneBin = join(projectRoot, "node_modules", "@midscene", "cli", "bin", "midscene");
  const scriptStartTime = Date.now();

  const cliFlags: string[] = [];
  if (options?.headful) cliFlags.push("--headed");
  if (options?.keepWindow) cliFlags.push("--keep-window");

  let cmd: string;
  let midsceneArgs: string[];

  if (existsSync(midsceneBin)) {
    cmd = "node";
    midsceneArgs = [midsceneBin, ...cliFlags, yamlPath];
  } else {
    cmd = "npx";
    midsceneArgs = ["midscene", ...cliFlags, yamlPath];
  }

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, midsceneArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: projectRoot,
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      const lines = chunk.toString().split("\n");
      for (const line of lines) {
        if (line.trim() === "") continue;
        process.stdout.write(`${line}\n`);
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const lines = chunk.toString().split("\n");
      for (const line of lines) {
        if (line.trim() === "") continue;
        process.stderr.write(`${line}\n`);
      }
    });

    child.on("close", async (code) => {
      const scriptEndTime = Date.now();
      if (code === 0) {
        log("success", "脚本执行完成");
      } else {
        log("warn", `脚本执行失败，退出码: ${code}，仍尝试解析已有报告`);
      }

      // 主进程内同步解析报告（增量路径 ~12ms，无需子进程）
      try {
        const htmlFileName = `${actualName}.html`;
        const reportDir = join(projectRoot, "midscene_run", "report");
        const htmlPath = join(reportDir, htmlFileName);

        if (existsSync(htmlPath)) {
          const { executions, sdkVersion } = parseReportFile(htmlPath, { scriptStartTime });

          if (executions.length > 0) {
            const metricsData = parseMetricsFromExecutions({
              executions,
              scriptStartTime,
              scriptEndTime,
              sdkVersion,
            });

            const metricsReport: MetricsReport = {
              version: 1,
              scriptName: actualName,
              generatedAt: new Date().toISOString(),
              mode: "run",
              ...metricsData,
            };

            const metricsPath = await saveMetrics(metricsReport);
            printMetricsSummary(metricsReport, { reportDir });
            log("info", `指标报告: ${metricsPath}`);

            try {
              const entry = entryFromReport(metricsReport, metricsPath);
              const htmlReportPath = renderReport(metricsReport);
              entry.reportHtmlPath = htmlReportPath;
              append(entry);
              prune(metricsReport.scriptName, 50);
              log("info", `HTML 报告: ${htmlReportPath}`);
            } catch (e) {
              log("warn", `HTML 报告生成失败: ${(e as Error).message}`);
            }
          }
        }
      } catch (e) {
        log("warn", `指标收集失败: ${(e as Error).message}`);
      }

      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`脚本执行失败，退出码: ${code}`));
      }
    });

    child.on("error", (err) => {
      reject(new Error(`无法执行 midscene: ${err.message}`));
    });
  });
}
