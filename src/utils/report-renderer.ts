/**
 * HTML 报告渲染器
 * 接受 MetricsReport + HistoryEntry[] + ReportTheme，渲染并写入 HTML 文件
 */

import * as path from "node:path";
import type { HistoryEntry, MetricsReport, ReportTheme } from "../types/index.js";
import { ensureDirSync, writeFileSync } from "./file.js";
import { getRecent } from "./history-store.js";
import { renderBlueprintReport } from "./templates/blueprint.js";
import { renderDatadogReport } from "./templates/datadog.js";
import { renderLinearReport } from "./templates/linear.js";

const OUTPUT_DIR = "midscene_run/output/reports";

export interface RenderOptions {
  /** 主题风格，默认 datadog */
  theme?: ReportTheme;
  /** 是否在生成后自动打开浏览器（electron 环境下） */
  open?: boolean;
}

/**
 * 渲染报告为 HTML 并写入磁盘
 * @param report MetricsReport 数据
 * @param opts 渲染选项
 * @returns 生成的 HTML 文件路径
 */
export function renderReport(report: MetricsReport, opts: RenderOptions = {}): string {
  const { theme = "datadog" } = opts;
  const history = getRecent(report.scriptName, 10);

  let html: string;
  switch (theme) {
    case "linear":
      html = renderLinearReport(report, history);
      break;
    case "blueprint":
      html = renderBlueprintReport(report, history);
      break;
    default:
      html = renderDatadogReport(report, history);
      break;
  }

  const mode = report.mode === "explore" ? "explore" : "run";
  const dir = path.join(OUTPUT_DIR, mode);
  ensureDirSync(dir);

  const dateStr = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const safeName = report.scriptName.replace(/[/\\:*?"<>|]/g, "_");
  const fileName = `${dateStr}-${safeName}-${theme}.html`;
  const filePath = path.join(dir, fileName);

  writeFileSync(filePath, html);
  return filePath;
}
