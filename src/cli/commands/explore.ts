/**
 * explore 命令
 * 交互式探索模式：aiAct 驱动 + save/abort/继续 处理
 */

import * as fs from "node:fs";
import { EOL } from "node:os";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import {
  closeSession,
  createExplorationSession,
  executeAndLog,
} from "../../core/midscene-adapter.js";
import { generateScriptName } from "../../core/name-generator.js";
import { freezeToYaml } from "../../core/yaml-freezer.js";
import { printMetricsSummary, saveMetrics } from "../../storage/metrics-store.js";
import { saveScript, scriptExists } from "../../storage/script-store.js";
import type { MetricsReport } from "../../types/index.js";
import { stripAnsi } from "../../utils/ansi-strip.js";
import { log, logAbort, logExplore, logSave, logSection } from "../../utils/logger.js";
import { parseMetricsFromExecutions, parseReportFile } from "../../utils/report-parser.js";

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    output.write(question);
    const chunks: Buffer[] = [];
    let resolved = false;
    const flush = () => {
      if (resolved) return;
      resolved = true;
      const raw = Buffer.concat(chunks).toString("utf8");
      // 移除 ANSI 转义码（PowerShell 光标移动序列等），防止凝固进 YAML
      const line = stripAnsi(raw)
        .replace(/\r?\n$/, "")
        .trim();
      output.write(EOL);
      resolve(line);
    };
    input.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      if (chunk.includes("\n") || chunk.includes("\r")) {
        flush();
      }
    });
  });
}

/**
 * 扫描 midscene_run/report/ 目录，找到与当前会话最匹配的报告文件
 * deepLocate 时 agent.reportFile 可能为空，但报告已写入磁盘
 */
function findLatestReport(lastReportHint?: string): string | undefined {
  const reportDir = path.join(process.cwd(), "midscene_run", "report");
  if (!fs.existsSync(reportDir)) return undefined;

  // 如果有上一步的报告路径提示，优先用它
  if (lastReportHint) {
    const absHint = path.isAbsolute(lastReportHint)
      ? lastReportHint
      : path.resolve(process.cwd(), lastReportHint);
    if (fs.existsSync(absHint)) return absHint;
  }

  // 否则找最新的 nl-script-*.html 文件（基于我们的 reportFileName）
  const nlScriptPattern = /^nl-script-\d+\.html/;
  let latestMtime = 0;
  let latestFile: string | undefined;

  for (const file of fs.readdirSync(reportDir)) {
    if (nlScriptPattern.test(file)) {
      const fullPath = path.join(reportDir, file);
      const stat = fs.statSync(fullPath);
      if (stat.mtimeMs > latestMtime) {
        latestMtime = stat.mtimeMs;
        latestFile = fullPath;
      }
    }
  }

  return latestFile;
}

export async function runExplore(params: {
  target: string;
  maxSteps?: number;
  headless?: boolean;
  deepLocate?: boolean;
  /** 非交互模式：传入初始指令，跳过交互提示直接执行 */
  instruction?: string;
  /** 自动保存：执行完成后自动生成名称并保存脚本 */
  autoSave?: boolean;
  /** 最大重规划次数，默认 20（对齐 SDK 默认值） */
  replanningLimit?: number;
}): Promise<void> {
  const { target, maxSteps = 20, deepLocate = false, instruction, autoSave = false, replanningLimit = 20 } = params;

  logSection("🧭 探索模式");
  log("info", `目标: ${target}`);
  log("info", `最大步数: ${maxSteps}`);
  if (deepLocate) {
    log("info", "深度定位: 启用（deepLocate）");
  }

  // 解析 URL：如果用户输入的是域名，自动补全 https://
  let url = target;
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = `https://${url}`;
  }

  let session: Awaited<ReturnType<typeof createExplorationSession>> | null = null;
  let stepCount = 0;
  let aborted = false;
  let saved = false;

  // 注册清理函数
  async function cleanup(): Promise<void> {
    if (session) {
      await closeSession(session);
      session = null;
    }
    input.pause();
  }

  // SIGINT 处理
  process.on("SIGINT", async () => {
    if (!aborted && !saved) {
      aborted = true;
      logAbort();
      await cleanup();
    }
    process.exit(130);
  });

  try {
    session = await createExplorationSession(url, maxSteps, params.headless ?? true, deepLocate, replanningLimit);

    // --- 非交互模式（传入 instruction 时跳过交互循环） ---
    if (instruction) {
      await runNonInteractive({ session, instruction, autoSave, url, deepLocate });
      return;
    }

    logSection("💬 探索会话");
    log("info", "可用命令:");
    log("info", "  - 直接输入自然语言指令 → 让 AI 执行");
    log("info", "  - save <名称> → 保存脚本");
    log("info", "  - abort → 退出");
    log("info", "  - 直接回车 → 继续下一步\n");

    while (stepCount < maxSteps) {
      stepCount++;
      log("info", `--- 步骤 ${stepCount}/${maxSteps} ---`);

      const userInput = await prompt("\n请输入指令: ");

      if (!userInput) {
        log("info", "跳过此步骤");
        continue;
      }

      if (userInput.toLowerCase() === "abort") {
        aborted = true;
        logAbort();
        break;
      }

      if (userInput.toLowerCase().startsWith("save ")) {
        const name = userInput.slice(5).trim();
        if (!name) {
          log("warn", "请提供脚本名称: save <名称>");
          stepCount--;
          continue;
        }

        const exists = await scriptExists(name);
        if (exists) {
          const confirm = await prompt(`脚本 "${name}" 已存在，是否覆盖？(y/N): `);
          if (confirm.toLowerCase() !== "y") {
            stepCount--;
            continue;
          }
        }

        const description = await prompt("请输入脚本描述（直接回车跳过）: ");

        if (!session) break;
        // 获取报告文件路径（优先用 agent.reportFile，fallback 到扫描最近报告）
        let reportHtmlPath =
          session.latestReportFile || findLatestReport(session.log.steps.at(-1)?.reportFile);
        if (reportHtmlPath && !path.isAbsolute(reportHtmlPath)) {
          reportHtmlPath = path.resolve(process.cwd(), reportHtmlPath);
        }
        const yamlContent = await freezeToYaml({
          name,
          description,
          explorationLog: session.log,
          reportHtmlPath,
          currentUrl: session.page.url(),
        });

        const meta = await saveScript({ name, description, yamlContent });
        logSave(name, meta.yamlPath);
        log("info", `提示: pnpm dev run ${name} --headful`);

        // 收集并保存 metrics（静默失败，不影响主流程）
        try {
          if (reportHtmlPath) {
            // 等待 500ms 确保 .execution.json 写入完成
            await new Promise((r) => setTimeout(r, 500));

            const { executions, sdkVersion: realSdkVersion } = parseReportFile(reportHtmlPath);
            if (executions.length > 0) {
              const metricsData = parseMetricsFromExecutions({
                executions,
                sdkVersion: realSdkVersion,
                startUrl: session?.log.startUrl,
              });

              const metricsReport: MetricsReport = {
                version: 1,
                scriptName: name,
                generatedAt: new Date().toISOString(),
                mode: "explore",
                ...metricsData,
              };

              const metricsPath = await saveMetrics(metricsReport);
              printMetricsSummary(metricsReport);
              log("info", `指标报告: ${metricsPath}`);
            }
          }
        } catch {
          // metrics 收集失败静默跳过
        }

        saved = true;
        break;
      }

      if (!session) break;

      logExplore(userInput);
      await executeAndLog(session, userInput);

      // 显示当前探索进度
      if (session.log.steps.length > 0) {
        log("info", `已执行步骤: ${session.log.steps.length}`);
      }
    }

    if (stepCount >= maxSteps) {
      log("warn", `已达到最大步数限制 (${maxSteps})`);
    }

    if (!aborted && !saved) {
      log("warn", "探索会话结束，请使用 save <名称> 保存脚本");
    }
  } catch (err) {
    log("error", `探索失败: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  } finally {
    if (session) {
      await cleanup();
    }
  }
}

/**
 * 非交互模式：执行单条指令后自动保存（--auto-save）或退出
 */
async function runNonInteractive(ctx: {
  session: NonNullable<Awaited<ReturnType<typeof createExplorationSession>>>;
  instruction: string;
  autoSave: boolean;
  url: string;
  deepLocate: boolean;
}): Promise<void> {
  const { session, instruction, autoSave, url, deepLocate } = ctx;

  logSection("⚡ 非交互模式");
  log("info", `目标: ${url}`);
  log("info", `指令: ${instruction}`);
  if (deepLocate) {
    log("info", "深度定位: 启用（deepLocate）");
  }

  // 注册清理函数
  async function cleanup(): Promise<void> {
    await closeSession(session);
    input.pause();
  }

  // SIGINT 处理
  process.on("SIGINT", async () => {
    log("warn", "收到中断信号，正在清理...");
    await cleanup();
    process.exit(130);
  });

  try {
    logExplore(instruction);
    await executeAndLog(session, instruction);
    log("info", "已执行步骤: 1");

    if (!autoSave) {
      log("info", "探索完成（无 --auto-save 标志，不保存脚本）");
      await cleanup();
      return;
    }

    // --- 自动保存 ---
    log("info", "正在生成脚本名称...");

    const generatedName = await generateScriptName(instruction);
    log("info", `生成的脚本名称: ${generatedName}`);

    // 获取报告文件路径
    let reportHtmlPath =
      session.latestReportFile || findLatestReport(session.log.steps.at(-1)?.reportFile);
    if (reportHtmlPath && !path.isAbsolute(reportHtmlPath)) {
      reportHtmlPath = path.resolve(process.cwd(), reportHtmlPath);
    }

    // 等待 .execution.json 写入完成
    await new Promise((r) => setTimeout(r, 500));

    const yamlContent = await freezeToYaml({
      name: generatedName,
      description: instruction,
      explorationLog: session.log,
      reportHtmlPath,
      currentUrl: session.page.url(),
    });

    const meta = await saveScript({ name: generatedName, description: instruction, yamlContent });
    logSave(generatedName, meta.yamlPath);

    // metrics 收集（静默失败）
    try {
      if (reportHtmlPath) {
        const { executions: freezeExecutions, sdkVersion: freezeSdkVersion } =
          parseReportFile(reportHtmlPath);
        if (freezeExecutions.length > 0) {
          const metricsData = parseMetricsFromExecutions({
            executions: freezeExecutions,
            sdkVersion: freezeSdkVersion,
            startUrl: session.log.startUrl,
          });

          const metricsReport: MetricsReport = {
            version: 1,
            scriptName: generatedName,
            generatedAt: new Date().toISOString(),
            mode: "explore",
            ...metricsData,
          };

          const metricsPath = await saveMetrics(metricsReport);
          printMetricsSummary(metricsReport);
          log("info", `指标报告: ${metricsPath}`);
        }
      }
    } catch {
      // metrics 收集失败静默跳过
    }

    log("info", `提示: pnpm dev run ${generatedName} --headful`);
    await cleanup();
  } catch (err) {
    log("error", `探索失败: ${err instanceof Error ? err.message : String(err)}`);
    await cleanup();
    throw err;
  }
}
