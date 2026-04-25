/**
 * run 命令
 * 加载 YAML 脚本并通过 midscene CLI 执行
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse, stringify } from "yaml";
import { printMetricsSummary, saveMetrics } from "../../storage/metrics-store.js";
import { getScriptPath } from "../../storage/script-store.js";
import type { MetricsReport } from "../../types/index.js";
import { log, logRun } from "../../utils/logger.js";
import {
  parseMetricsFromExecutions,
  parseReportFile,
  waitForExecutionJson,
} from "../../utils/report-parser.js";

export async function runScript(
  scriptName: string,
  options?: { headful?: boolean; keepWindow?: boolean },
): Promise<void> {
  const yamlPath = await getScriptPath(scriptName);

  if (!yamlPath) {
    throw new Error(`脚本 "${scriptName}" 不存在，请先使用 explore 命令创建`);
  }

  logRun(scriptName);
  log("info", `脚本路径: ${yamlPath}`);

  const absoluteYamlPath = resolve(yamlPath);
  const projectRoot = process.cwd();

  const needsInject = options?.headful || options?.keepWindow;
  const originalContent = needsInject ? readFileSync(absoluteYamlPath, "utf8") : null;

  if (needsInject && originalContent !== null) {
    const doc = parse(originalContent) as Record<string, unknown>;
    if (!doc.agent) doc.agent = {};
    const agent = doc.agent as Record<string, unknown>;
    if (options.headful) agent.headed = true;
    if (options.keepWindow) agent.keepWindow = true;
    writeFileSync(absoluteYamlPath, stringify(doc));
  }

  try {
    await runMidscene(projectRoot, absoluteYamlPath, scriptName);
  } finally {
    if (needsInject && originalContent !== null) {
      writeFileSync(absoluteYamlPath, originalContent);
    }
  }
}

async function runMidscene(
  projectRoot: string,
  yamlPath: string,
  scriptName: string,
): Promise<void> {
  const midsceneBin = join(projectRoot, "node_modules", "@midscene", "cli", "bin", "midscene");

  let cmd: string;
  let args: string[];

  if (existsSync(midsceneBin)) {
    cmd = "node";
    args = [midsceneBin, yamlPath];
  } else {
    cmd = "npx";
    args = ["midscene", yamlPath];
  }

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
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
      if (code === 0) {
        log("success", "脚本执行完成");

        try {
          const htmlFileName = `${scriptName}.html`;
          const reportDir = join(projectRoot, "midscene_run", "report");
          const htmlPath = join(reportDir, htmlFileName);

          if (existsSync(htmlPath)) {
            await waitForExecutionJson(reportDir, htmlFileName, 3000);

            const executions = parseReportFile(htmlPath);
            if (executions.length > 0) {
              const metricsData = parseMetricsFromExecutions({ executions });

              const metricsReport: MetricsReport = {
                version: 1,
                scriptName,
                generatedAt: new Date().toISOString(),
                mode: "run",
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
