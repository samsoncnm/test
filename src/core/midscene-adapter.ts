/**
 * Midscene 适配器
 * 封装 Playwright + PlaywrightAgent 的初始化和生命周期管理
 *
 * 单模型架构：主模型（qwen3-vl-plus）同时负责视觉定位和任务规划。
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
  /** 步骤计数器（用于历史压缩间隔控制） */
  stepCount: number;
}

export async function createExplorationSession(
  initialUrl: string,
  maxSteps = 20,
  headless = true,
  deepLocate = false,
  replanningCycleLimit = 20,
): Promise<ExplorationSession> {
  const config = getMidsceneConfig();
  const warnings = checkOptionalEnvVars();
  for (const warning of warnings) {
    log("warn", warning);
  }

  log("info", `主模型: ${config.modelName} (${config.modelFamily})，兼任规划`);

  log("info", `正在启动 Chromium 浏览器...${headless ? "(headless)" : "(headful 有头模式)"}`);
  const browser = await chromium.launch({
    headless,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 768 });

  log("info", `正在访问: ${initialUrl}`);
  await page.goto(initialUrl, { waitUntil: "networkidle" });

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
    cache: { id: "nl-script-explore", strategy: "read-write" },
    // P1 优化：截图缩放 3 倍（2880x1536 → 960x512），Qwen3-VL token 预计从 ~2800 → ~420
    screenshotShrinkFactor: SCREENSHOT_SHRINK_FACTOR,
    // explore 模式默认 20（对齐 SDK 默认值），run 模式在 run.ts 中独立设为 1
    replanningCycleLimit,
  });

  log("success", "Midscene Agent 初始化完成");

  return {
    agent,
    page,
    browser,
    headless,
    deepLocate,
    latestReportFile: undefined,
    stepCount: 0,
    log: {
      startUrl,
      steps: [],
    },
  };
}

/** 截图压缩：Qwen3-VL token 公式 ceil(W/28)*ceil(H/28)，shrink=3 将 2880x1536 → 960x512，预计 token 从 ~2800 → ~420 */
const SCREENSHOT_SHRINK_FACTOR = 3;

export async function executeAndLog(session: ExplorationSession, action: string): Promise<void> {
  const start = Date.now();
  session.stepCount++;

  // P2 优化：每 5 步压缩一次历史，避免上下文无限增长
  if (session.stepCount > 0 && session.stepCount % 5 === 0) {
    try {
      await (
        session.agent as unknown as {
          compressHistory?: (threshold: number, keepCount: number) => Promise<void>;
        }
      ).compressHistory?.(3000, 3);
    } catch {
      // compressHistory 失败静默跳过
    }
  }

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
  // 尝试 flush 缓存（最佳实践：会话结束前持久化缓存）
  try {
    await session.agent.flushCache?.({ cleanUnused: true });
  } catch {
    // flushCache 失败静默跳过，不影响清理流程
  }
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
