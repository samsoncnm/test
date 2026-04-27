/**
 * run 命令
 * 加载 YAML 脚本并通过 midscene CLI 执行
 *
 * 架构说明：
 * 主进程：负责启动 Midscene CLI，等待其退出后立即 resolve/reject（< 1s）
 * 报告解析子进程：通过 fork() 启动，独立完成耗时的 metrics/HTML 报告生成
 *   （包括 splitReportFile、parseMetricsFromExecutions、saveMetrics、
 *     printMetricsSummary、renderReport），与 Midscene CLI 并行执行
 *
 * 根因：原方案中 setImmediate 无法让同步阻塞代码（如 splitReportFile）异步化，
 *       进程会挂起等待解析完成才退出。fork() 彻底隔离重操作，
 *       主进程只需等待 Midscene CLI 完成即可退出。
 */

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import { findScriptByFuzzyName, getScriptPath } from "../../storage/script-store.js";
import { log } from "../../utils/logger.js";

// ESM 下 __dirname 的等价物（run.ts 与 run-parser.ts 同目录）
const __dirname = fileURLToPath(new URL(".", import.meta.url));

export async function runScript(
  scriptName: string,
  options?: { headful?: boolean; keepWindow?: boolean; noCache?: boolean },
): Promise<void> {
  const result = await findScriptByFuzzyName(scriptName);

  if (!result.script) {
    throw new Error(`脚本 "${scriptName}" 不存在，请先使用 explore 命令创建`);
  }

  const yamlPath = await getScriptPath(result.script.name);
  const actualName = result.script.name;

  if (result.matchedBy === "pinyin") {
    log(
      "warn",
      `脚本 "${scriptName}" 未找到，已自动纠正为 "${actualName}"（拼音匹配）？继续执行...`,
    );
  } else if (result.matchedBy === "typo") {
    log(
      "warn",
      `脚本 "${scriptName}" 未找到，已自动纠正为 "${actualName}"（错别字容忍）？继续执行...`,
    );
  } else if (result.matchedBy !== "exact") {
    log("warn", `脚本 "${scriptName}" 未找到，猜测你想运行 "${actualName}"？继续执行...`);
  }

  log("info", `脚本路径: ${yamlPath}`);

  if (!yamlPath) {
    throw new Error(`脚本 "${actualName}" 的文件已丢失`);
  }
  const absoluteYamlPath = resolve(yamlPath);
  const projectRoot = process.cwd();

  // 幂等锁：防止外部触发源（npm 重试 / CI 重试 / debugger re-run）导致重复调用
  const lockPath = join(projectRoot, "midscene_run", ".running");

  if (existsSync(lockPath)) {
    const lockPid = readFileSync(lockPath, "utf-8").trim().split("\n")[0] ?? "";
    try {
      process.kill(Number(lockPid), 0);
      throw new Error("already_running");
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ESRCH") {
        // ESRCH = 进程不存在，锁文件已过期，直接删除
        unlinkSync(lockPath);
      } else {
        // 进程存在（EPERM）或未知错误，视为冲突
        throw new Error(
          `检测到已有运行中的脚本 (PID ${lockPid})，请先终止后再试。提示：在任务管理器中结束进程 ${lockPid}，或删除 midscene_run/.running 文件`,
        );
      }
    }
  }

  // 创建锁文件
  writeFileSync(lockPath, `${process.pid}`, "utf-8");

  // ── Delta Freeze 预处理器：展开 baseScript 引用 ─────────────────────────
  const { expandScriptReferences } = await import("../../core/script-expander.js");
  const loadScriptByName = async (name: string) => {
    const result = await findScriptByFuzzyName(name);
    if (!result.script) {
      throw new Error(`baseScript "${name}" 不存在，请检查脚本名称`);
    }
    const path = await getScriptPath(result.script.name);
    if (!path) throw new Error(`baseScript "${name}" 文件已丢失`);
    return { content: readFileSync(path, "utf8"), yamlPath: path };
  };

  const originalYamlContent = readFileSync(absoluteYamlPath, "utf8");
  const doc = parse(originalYamlContent) as Record<string, unknown>;
  const yamlDoc = doc as unknown as Parameters<typeof expandScriptReferences>[0];
  const hasBaseScript = (yamlDoc.tasks ?? []).some((t: Record<string, unknown>) => !!t.baseScript);

  if (hasBaseScript) {
    const expandedDoc = await expandScriptReferences(yamlDoc, undefined, loadScriptByName);
    writeFileSync(absoluteYamlPath, stringify(expandedDoc));
  }

  const needsInject = options?.headful || options?.keepWindow || options?.noCache;
  if (!hasBaseScript) {
    if (!doc.agent) doc.agent = {};
    const agent = doc.agent as Record<string, unknown>;
    if (options.headful) agent.headed = true;
    if (options.keepWindow) agent.keepWindow = true;
    if (options.noCache) agent.cache = false;
    // P1 优化：截图缩放 3 倍（2880x1536 → 960x512），token 预计从 ~2800 → ~420
    agent.screenshotShrinkFactor = 3;
    // P1 优化：限制重规划次数，避免多次重复 AI 调用
    agent.replanningCycleLimit = 1;
    writeFileSync(absoluteYamlPath, stringify(doc));
  }
  // ── 预处理器结束 ─────────────────────────────────────────────────────────

  try {
    try {
      await runMidscene(projectRoot, absoluteYamlPath, actualName, options);
    } finally {
      // 恢复原始 YAML：无论 baseScript 展开还是 agent 注入，都恢复原文件
      writeFileSync(absoluteYamlPath, originalYamlContent);
    }
  } finally {
    // 无论成功还是失败，都要释放锁
    if (existsSync(lockPath)) {
      try {
        unlinkSync(lockPath);
      } catch {
        // 忽略删除锁文件时的错误
      }
    }
  }
}

async function runMidscene(
  projectRoot: string,
  yamlPath: string,
  actualName: string,
  options?: { headful?: boolean; keepWindow?: boolean },
): Promise<void> {
  const midsceneBin = join(projectRoot, "node_modules", "@midscene", "cli", "bin", "midscene");
  const scriptStartTime = Date.now();

  const cliFlags: string[] = [];
  if (options?.headful) cliFlags.push("--headed");
  if (options?.keepWindow) cliFlags.push("--keep-window");

  let cmd: string;
  let midsceneArgs: string[];

  if (existsSync(midsceneBin)) {
    cmd = "node";
    midsceneArgs = [midsceneBin, ...cliFlags, yamlPath];
  } else {
    cmd = "npx";
    midsceneArgs = ["midscene", ...cliFlags, yamlPath];
  }

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, midsceneArgs, {
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

    child.on("close", (code) => {
      const scriptEndTime = Date.now();
      if (code === 0) {
        log("success", "脚本执行完成");
      } else {
        log("warn", `脚本执行失败，退出码: ${code}，仍尝试解析已有报告`);
      }

      // spawn() 子进程：隔离耗时的报告解析，与主进程完全解耦
      // detached: true + stdio: inherit 让子进程独立于父进程，主进程立即 resolve/reject
      // process.execPath + --import tsx 是 tsx 官方推荐的子进程 TypeScript 运行方式
      const parserChild: ChildProcess = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          join(__dirname, "run-parser.js"),
          actualName,
          String(scriptStartTime),
          String(scriptEndTime),
          projectRoot,
        ],
        { detached: true, stdio: "inherit" },
      );

      // unref() 让父进程退出时不等待子进程
      parserChild.unref();

      if (code === 0) {
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
