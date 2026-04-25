/**
 * Metrics 报告持久化和终端打印
 * 负责将 MetricsReport 保存到 JSON 文件，并在终端输出彩色摘要
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import pc from "picocolors";
import type { MetricsReport } from "../types/index.js";
import { log } from "../utils/logger.js";

const METRICS_DIR = path.resolve(process.cwd(), "midscene_run", "output", "metrics");

/**
 * 将 MetricsReport 保存到 JSON 文件
 * 路径格式：midscene_run/output/metrics/{mode}/{日期时间}-{脚本名}.json
 */
export async function saveMetrics(report: MetricsReport): Promise<string> {
  const subDir = path.join(METRICS_DIR, report.mode);
  await fs.mkdir(subDir, { recursive: true });

  const date = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  // 清理文件名中的非法字符（Windows 文件系统不允许的字符）
  const illegal = ["<", ">", ":", '"', "|", "?", "*"];
  const sanitizedName =
    report.scriptName
      .normalize("NFC")
      .split("")
      .filter((c) => {
        const code = c.charCodeAt(0);
        return code >= 32 && !illegal.includes(c);
      })
      .join("")
      .slice(0, 100) || "unnamed";
  const fileName = `${date}-${sanitizedName}.json`;
  const filePath = path.join(subDir, fileName);

  await fs.writeFile(filePath, JSON.stringify(report, null, 2), "utf-8");
  return filePath;
}

/**
 * 在终端打印彩色指标摘要
 */
export function printMetricsSummary(report: MetricsReport): void {
  const { summary } = report;
  const wallTimeS = (summary.totalWallTimeMs / 1000).toFixed(1);
  const aiTimeS = (summary.totalAiTimeMs / 1000).toFixed(1);

  console.log();
  console.log(pc.bold(pc.underline("📊 执行指标")));
  console.log();

  if (report.passInfo?.detected) {
    console.log(
      pc.yellow(
        `  ⚠ SDK 检测到 double-pass（执行了 ${report.passInfo.passCount} 遍），指标为所有 pass 合计`,
      ),
    );
    console.log();
  }

  console.log(`  脚本名称    ${pc.dim(":")} ${report.scriptName}`);
  console.log(`  执行模式    ${pc.dim(":")} ${report.mode}`);
  console.log(`  步骤数      ${pc.dim(":")} ${summary.totalSteps}`);
  console.log(`  墙钟耗时    ${pc.dim(":")} ${wallTimeS}s`);
  console.log(`  AI 推理耗时 ${pc.dim(":")} ${aiTimeS}s`);
  console.log(`  总 Token    ${pc.dim(":")} ${summary.totalTokens.toLocaleString()}`);
  console.log(`  缓存节省    ${pc.dim(":")} ${summary.totalCachedTokens.toLocaleString()}`);
  if (summary.totalCachedTokens > 0) {
    const savings =
      summary.totalTokens > 0
        ? ((summary.totalCachedTokens / summary.totalTokens) * 100).toFixed(1)
        : "0";
    console.log(pc.green(`  ${pc.dim("→")} 缓存命中！节省 ${savings}% Token，减少 AI 推理耗时`));
  }
  console.log();

  if (summary.modelBreakdown.length > 0) {
    console.log(`  ${pc.dim("按模型分组:")}`);
    for (const m of summary.modelBreakdown) {
      const pct =
        summary.totalTokens > 0 ? ((m.totalTokens / summary.totalTokens) * 100).toFixed(0) : "0";
      console.log(`    ${m.modelName} (${m.intent})`);
      console.log(
        `      调用 ${m.steps} 次 | Token ${m.totalTokens.toLocaleString()} (${pct}%) | AI耗时 ${(m.totalAiTimeMs / 1000).toFixed(1)}s`,
      );
    }
    console.log();
  }

  if (report.steps.length > 0) {
    console.log(`  ${pc.dim("步骤明细:")}`);
    const maxShow = 10;
    for (let i = 0; i < Math.min(report.steps.length, maxShow); i++) {
      const step = report.steps[i];
      if (!step) continue;
      const truncated =
        step.userInstruction.slice(0, 30) + (step.userInstruction.length > 30 ? "..." : "");
      const tokens = (step.usage?.totalTokens ?? 0) + (step.locateUsage?.totalTokens ?? 0);
      const statusColor = step.status === "finished" ? pc.green("✓") : pc.red("✗");
      const durationS = (step.wallTimeMs / 1000).toFixed(1);
      console.log(
        `    ${statusColor} ${String(i + 1).padStart(2)} | ${truncated.padEnd(32)} | ${durationS.padStart(6)}s | ${String(tokens).padStart(6)} tokens`,
      );
    }
    if (report.steps.length > maxShow) {
      console.log(
        `    ${pc.dim(`... 还有 ${report.steps.length - maxShow} 个步骤，详见 JSON 报告`)}`,
      );
    }
    console.log(`    ${pc.dim("截图路径和完整动作详见 JSON 报告")}`);
    console.log();
  }

  log("info", "指标报告已保存");
}
