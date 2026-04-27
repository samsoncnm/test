/**
 * 历史报告存储（每个脚本独立索引文件）
 * 存储路径：midscene_run/output/history/{scriptName}.json
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { HistoryEntry, HistoryIndex, MetricsReport } from "../types/index.js";
import { ensureDirSync } from "./file.js";

const HISTORY_DIR = "midscene_run/output/history";

function historyPath(scriptName: string): string {
  const safeName = scriptName.replace(/[/\\:*?"<>|]/g, "_");
  return path.join(HISTORY_DIR, `${safeName}.json`);
}

function readIndex(scriptName: string): HistoryIndex {
  const p = historyPath(scriptName);
  if (!fs.existsSync(p)) {
    return { version: 1, scriptName, runs: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as HistoryIndex;
  } catch {
    return { version: 1, scriptName, runs: [] };
  }
}

function writeIndex(idx: HistoryIndex): void {
  ensureDirSync(HISTORY_DIR);
  const p = historyPath(idx.scriptName);
  fs.writeFileSync(p, JSON.stringify(idx, null, 2), "utf-8");
}

/**
 * 从 MetricsReport 生成 HistoryEntry
 */
export function entryFromReport(report: MetricsReport, reportPath: string): HistoryEntry {
  const { summary } = report;
  const passRate =
    summary.totalSteps > 0 ? Math.round((summary.finishedSteps / summary.totalSteps) * 100) : 100;

  const failedStep = report.steps.find((s) => s.status === "failed");
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    scriptName: report.scriptName,
    generatedAt: report.generatedAt,
    mode: report.mode,
    status: summary.failCount > 0 ? "failed" : "passed",
    durationMs: summary.totalWallTimeMs,
    finishedSteps: summary.finishedSteps,
    failCount: summary.failCount,
    skipCount: summary.skipCount,
    assertCount: summary.assertCount,
    passRate,
    reportPath,
    errorType: failedStep?.errorType,
  };
}

/**
 * 追加一条历史记录
 */
export function append(entry: HistoryEntry): void {
  const idx = readIndex(entry.scriptName);
  idx.runs.unshift(entry);
  writeIndex(idx);
}

/**
 * 查询最近 N 条历史（默认 10 条）
 */
export function getRecent(scriptName: string, limit = 10): HistoryEntry[] {
  const idx = readIndex(scriptName);
  return idx.runs.slice(0, limit);
}

/**
 * 清理历史记录，保留最近 keep 条（默认 50 条）
 */
export function prune(scriptName: string, keep = 50): void {
  const idx = readIndex(scriptName);
  if (idx.runs.length <= keep) return;
  idx.runs = idx.runs.slice(0, keep);
  writeIndex(idx);
}

/**
 * 回填 HTML 报告路径到指定历史条目
 */
export function updateHtmlPath(scriptName: string, entryId: string, htmlPath: string): void {
  const idx = readIndex(scriptName);
  const entry = idx.runs.find((e) => e.id === entryId);
  if (entry) {
    entry.reportHtmlPath = htmlPath;
    writeIndex(idx);
  }
}
