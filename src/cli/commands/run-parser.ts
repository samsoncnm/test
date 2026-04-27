/**
 * 报告解析子进程入口（TypeScript）
 * 由主进程通过 tsx fork 启动，独立完成耗时的 metrics/HTML 报告生成
 *
 * 通过 fork() + tsx 启动，与主进程完全隔离
 * 解析结果写入 JSON 文件供主进程读取（stdout 传路径）
 */

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { saveMetrics } from "../../storage/metrics-store.js";
import { printMetricsSummary } from "../../storage/metrics-store.js";
import type { MetricsReport } from "../../types/index.js";
import { append, entryFromReport, prune } from "../../utils/history-store.js";
import { log } from "../../utils/logger.js";
import {
  parseMetricsFromExecutions,
  parseReportFile,
  waitForExecutionJson,
} from "../../utils/report-parser.js";
import { renderReport } from "../../utils/report-renderer.js";

async function main(): Promise<void> {
  const [scriptName, scriptStartTimeStr, scriptEndTimeStr, projRoot] = process.argv.slice(2);

  if (!scriptName || !scriptStartTimeStr || !scriptEndTimeStr || !projRoot) {
    console.error(
      "[ERROR] 报告解析子进程参数不足，需要: scriptName scriptStartTime scriptEndTime projectRoot",
    );
    process.exit(1);
  }

  const scriptStartTime = Number.parseInt(scriptStartTimeStr, 10);
  const scriptEndTime = Number.parseInt(scriptEndTimeStr, 10);
  const htmlFileName = `${scriptName}.html`;
  const reportDir = join(projRoot, "midscene_run", "report");
  const htmlPath = join(reportDir, htmlFileName);

  try {
    if (!existsSync(htmlPath)) {
      log("warn", `HTML 报告不存在: ${htmlPath}，跳过解析`);
      writeResultJson({ ok: false, reason: "html_not_found" });
      process.exit(0);
    }

    // 等待 .execution.json 稳定（Midscene CLI 退出后文件可能还在写入）
    await waitForExecutionJson(reportDir, htmlFileName, 10000);

    // 从 HTML 报告解析 metrics 数据
    const { executions, sdkVersion } = parseReportFile(htmlPath, { scriptStartTime });

    if (executions.length === 0) {
      log("warn", "未找到有效的 execution 数据，跳过报告生成");
      writeResultJson({ ok: false, reason: "no_executions" });
      process.exit(0);
    }

    const metricsData = parseMetricsFromExecutions({
      executions,
      scriptStartTime,
      scriptEndTime,
      sdkVersion,
    });

    const metricsReport: MetricsReport = {
      version: 1,
      scriptName,
      generatedAt: new Date().toISOString(),
      mode: "run",
      ...metricsData,
    };

    // 保存 metrics JSON
    const metricsPath = await saveMetrics(metricsReport);
    printMetricsSummary(metricsReport, { reportDir });
    log("info", `指标报告: ${metricsPath}`);

    // 生成 HTML 报告并追加历史记录
    let htmlReportPath: string | null = null;
    try {
      const entry = entryFromReport(metricsReport, metricsPath);
      htmlReportPath = renderReport(metricsReport);
      entry.reportHtmlPath = htmlReportPath;
      append(entry);
      prune(metricsReport.scriptName, 50);
      log("info", `HTML 报告: ${htmlReportPath}`);
    } catch (e) {
      log("warn", `HTML 报告生成失败: ${(e as Error).message}`);
    }

    writeResultJson({ ok: true, metricsPath, htmlReportPath });
    process.exit(0);
  } catch (e) {
    log("warn", `指标收集失败: ${(e as Error).message}`);
    writeResultJson({ ok: false, reason: "error", error: (e as Error).message });
    process.exit(1);
  }
}

function writeResultJson(data: Record<string, unknown>): void {
  const scriptName = process.argv[2] ?? "unknown";
  const projRoot = process.argv[5] ?? "";
  const resultJsonPath = join(
    projRoot,
    "midscene_run",
    "report",
    `__parser_result__${scriptName}.json`,
  );
  try {
    writeFileSync(resultJsonPath, JSON.stringify(data, null, 2), "utf-8");
  } catch (_) {
    // 忽略写入错误
  }
}

main();
