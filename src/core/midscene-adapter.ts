/**
 * Midscene 适配器
 * 封装 Playwright + PlaywrightAgent 的初始化和生命周期管理
 *
 * 多模型支持：
 * - Planning 模型：用于复杂任务规划（通过 MIDSCENE_PLANNING_MODEL_* 配置）
 * - Insight 模型：用于深度页面理解（通过 MIDSCENE_INSIGHT_MODEL_* 配置）
 * - 主模型（视觉定位）：通过 MIDSCENE_MODEL_* 配置
 *
 * 当 PLANNING/INSIGHT 模型配置后，Midscene 会自动将复杂推理卸载到专用模型，
 * 主模型专注视觉定位，从而提升执行效率和准确性。
 */

import { PlaywrightAgent } from "@midscene/web/playwright";
import { type Browser, type Page, chromium } from "playwright";
import type { ExplorationLog, ExplorationStep } from "../types/index.js";
import { checkOptionalEnvVars, getMidsceneConfig } from "../utils/config.js";
import { log, logError } from "../utils/logger.js";

export interface ExplorationSession {
  agent: PlaywrightAgent;
  page: Page;
  browser: Browser;
  log: ExplorationLog;
  headless: boolean;
  /** 最近一次 aiAct 执行后的报告 HTML 文件路径（从 agent.reportFile 获取） */
  latestReportFile?: string;
  /** 是否启用深度定位（deepLocate） */
  deepLocate: boolean;
}

export async function createExplorationSession(
  initialUrl: string,
  maxSteps = 20,
  headless = true,
  deepLocate = false,
): Promise<ExplorationSession> {
  const config = getMidsceneConfig();
  const warnings = checkOptionalEnvVars();
  for (const warning of warnings) {
    log("warn", warning);
  }

  // 多模型配置提示
  if (config.planning) {
    log("info", `Planning 模型: ${config.planning.modelName} (${config.planning.modelFamily})`);
  } else {
    log("info", `主模型: ${config.default.modelName} (${config.default.modelFamily})，兼任规划`);
  }
  if (config.insight) {
    log("info", `Insight 模型: ${config.insight.modelName} (${config.insight.modelFamily})`);
  }

  log("info", `正在启动 Chromium 浏览器...${headless ? "(headless)" : "(headful 有头模式)"}`);
  const browser = await chromium.launch({
    headless,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 768 });

  log("info", `正在访问: ${initialUrl}`);
  await page.goto(initialUrl, { waitUntil: "domcontentloaded" });

  const startUrl = page.url();
  log("info", `页面已加载，当前 URL: ${startUrl}`);

  log("info", "正在初始化 Midscene Agent（等待 5 秒）...");
  await sleep(5000);

  // 生成唯一报告文件名，方便后续凝固时定位报告
  const reportFileName = `nl-script-${Date.now()}`;
  const agent = new PlaywrightAgent(page, {
    reportFileName,
    generateReport: true,
    autoPrintReportMsg: false,
    persistExecutionDump: true,
  });

  log("success", "Midscene Agent 初始化完成");

  return {
    agent,
    page,
    browser,
    headless,
    deepLocate,
    latestReportFile: undefined,
    log: {
      startUrl,
      steps: [],
    },
  };
}

export async function executeAndLog(session: ExplorationSession, action: string): Promise<void> {
  const start = Date.now();
  try {
    await session.agent.aiAct(action, { deepLocate: session.deepLocate });

    // 从 agent.reportFile 获取最新报告路径（非空时更新）
    const reportFile = (session.agent as unknown as { reportFile?: string }).reportFile;

    const step: ExplorationStep = {
      action,
      result: "success",
      durationMs: Date.now() - start,
      deepLocate: session.deepLocate,
      reportFile: reportFile,
    };

    if (reportFile) {
      session.latestReportFile = reportFile;
    }

    session.log.steps.push(step);
    log("success", `[${step.durationMs}ms] AI 执行完成`);
  } catch (err) {
    const reportFile = (session.agent as unknown as { reportFile?: string }).reportFile;

    const step: ExplorationStep = {
      action,
      result: "error",
      durationMs: Date.now() - start,
      deepLocate: session.deepLocate,
      reportFile: reportFile,
      errorMessage: err instanceof Error ? err.message : String(err),
    };

    if (reportFile) {
      session.latestReportFile = reportFile;
    }

    session.log.steps.push(step);
    logError(err);
  }
}

export async function closeSession(session: ExplorationSession): Promise<void> {
  try {
    await session.agent.destroy();
  } catch {
    // 忽略销毁错误
  }
  try {
    await session.browser.close();
  } catch {
    // 忽略关闭错误
  }
  log("info", "浏览器资源已释放");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { sleep };
