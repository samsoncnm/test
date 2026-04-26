/**
 * Metrics 报告持久化和终端打印
 * 负责将 MetricsReport 保存到 JSON 文件，并在终端输出彩色摘要
 */

import { promises as fs, existsSync, readFileSync } from "node:fs";
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
 * 统计 Explore 脚本缓存命中数
 *
 * 策略：直接读 midscene_run/cache/{scriptName}.cache.yaml 文件。
 * - 若 cache 文件存在且包含 locate xpath 数据 → 脚本缓存已激活
 * - 命中数 = locate 类型缓存条目数（每个 locate prompt 算一个元素）
 *
 * 这是最可靠的检测方式，不依赖 execution JSON 的 hitBy 字段（该字段
 * 在某些 midscene 版本中不总是写入）。
 */
function countExploreCacheHits(scriptName: string): number {
  try {
    const cacheDir = path.resolve(process.cwd(), "midscene_run", "cache");
    // Midscene 将空格替换为连字符来存储 cache 文件
    const sanitizedName = scriptName
      .normalize("NFC")
      .replace(/\s+/g, "-")
      .split("")
      .filter((c) => {
        const code = c.charCodeAt(0);
        return (
          code >= 32 &&
          c !== "<" &&
          c !== ">" &&
          c !== ":" &&
          c !== '"' &&
          c !== "|" &&
          c !== "?" &&
          c !== "*"
        );
      })
      .join("");
    const cacheFileName = `${sanitizedName}.cache.yaml`;
    const cachePath = path.join(cacheDir, cacheFileName);

    if (!existsSync(cachePath)) {
      return 0;
    }

    const content = readFileSync(cachePath, "utf-8");
    // 统计 locate 类型缓存条目数
    const locateMatches = content.match(/^\s+-\s+type:\s+locate$/gm);
    return locateMatches ? locateMatches.length : 0;
  } catch {
    return 0;
  }
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

  // Explore 脚本缓存：直接从 cache 目录读 .cache.yaml 文件
  const exploreCacheHits = countExploreCacheHits(report.scriptName);

  if (exploreCacheHits > 0) {
    console.log(
      pc.green(
        `  脚本缓存    ${pc.dim(":")} 命中 ${exploreCacheHits} 个元素定位（xpath 复用，跳过 AI 规划）`,
      ),
    );
  }

  if (summary.totalCachedTokens > 0) {
    const savings =
      summary.totalTokens > 0
        ? ((summary.totalCachedTokens / summary.totalTokens) * 100).toFixed(1)
        : "0";
    console.log(
      pc.green(
        `  KV 缓存    ${pc.dim(":")} 节省 ${summary.totalCachedTokens.toLocaleString()} Token（命中 ${savings}%）`,
      ),
    );
  }

  if (exploreCacheHits === 0 && summary.totalCachedTokens === 0) {
    console.log(pc.dim(`  缓存节省    ${pc.dim(":")} 0`));
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
