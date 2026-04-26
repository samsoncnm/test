/**
 * report 命令
 * 从已保存的 MetricsReport JSON 渲染 HTML 报告
 */

import * as fs from "node:fs";
import * as path from "node:path";
import pc from "picocolors";
import { findScriptByFuzzyName } from "../../storage/script-store.js";
import type { MetricsReport, ReportTheme } from "../../types/index.js";
import { log } from "../../utils/logger.js";
import { renderReport } from "../../utils/report-renderer.js";

const METRICS_DIR = "midscene_run/output/metrics";

function findLatestMetrics(scriptName: string): string | null {
  const modeDirs = ["run", "explore"];
  let latest: { mtime: number; path: string } | null = null;

  for (const mode of modeDirs) {
    const dir = path.join(METRICS_DIR, mode);
    if (!fs.existsSync(dir)) continue;

    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      // 检查文件名是否包含脚本名（不区分大小写）
      if (file.toLowerCase().includes(scriptName.toLowerCase())) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (!latest || stat.mtimeMs > latest.mtime) {
          latest = { mtime: stat.mtimeMs, path: filePath };
        }
      }
    }
  }
  return latest?.path ?? null;
}

export async function renderReportCommand(
  scriptName: string,
  options?: { theme?: ReportTheme; open?: boolean },
): Promise<void> {
  // 查找脚本
  const result = await findScriptByFuzzyName(scriptName);
  if (!result.script) {
    console.error(`${pc.red("[ERROR]")} 未找到脚本: ${scriptName}`);
    process.exit(1);
  }

  const actualName = result.script.name;
  const metricsPath = findLatestMetrics(actualName);

  if (!metricsPath) {
    console.error(`${pc.red("[ERROR]")} 未找到报告文件: ${actualName}`);
    console.error(`${pc.yellow("[提示]")} 请先运行该脚本：pnpm dev run ${actualName}`);
    process.exit(1);
  }

  // 读取 metrics JSON
  let report: MetricsReport;
  try {
    const raw = fs.readFileSync(metricsPath, "utf-8");
    report = JSON.parse(raw) as MetricsReport;
  } catch (e) {
    console.error(`${pc.red("[ERROR]")} 读取报告失败: ${(e as Error).message}`);
    process.exit(1);
  }

  // 渲染 HTML
  try {
    const htmlPath = renderReport(report, { theme: options?.theme ?? "datadog" });
    console.log(`${pc.green("[成功]")} HTML 报告已生成: ${htmlPath}`);

    if (options?.open) {
      log("info", `请手动在浏览器中打开: ${htmlPath}`);
    }
  } catch (e) {
    console.error(`${pc.red("[ERROR]")} 报告渲染失败: ${(e as Error).message}`);
    process.exit(1);
  }
}
