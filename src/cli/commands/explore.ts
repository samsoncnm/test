/**
 * explore 命令
 * 交互式探索模式：aiAct 驱动 + save/abort/继续 处理
 */

import { EOL } from "node:os";
import { stdin as input, stdout as output } from "node:process";
import {
  closeSession,
  createExplorationSession,
  executeAndLog,
} from "../../core/midscene-adapter.js";
import { freezeToYaml } from "../../core/yaml-freezer.js";
import { saveScript, scriptExists } from "../../storage/script-store.js";
import { log, logAbort, logExplore, logSave, logSection } from "../../utils/logger.js";

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    output.write(question);
    const chunks: Buffer[] = [];
    let resolved = false;
    const flush = () => {
      if (resolved) return;
      resolved = true;
      const raw = Buffer.concat(chunks).toString("utf8");
      const line = raw.replace(/\r?\n$/, "").trim();
      output.write(EOL);
      resolve(line);
    };
    input.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      if (chunk.includes("\n") || chunk.includes("\r")) {
        flush();
      }
    });
  });
}

export async function runExplore(params: {
  target: string;
  maxSteps?: number;
  headless?: boolean;
}): Promise<void> {
  const { target, maxSteps = 20 } = params;

  logSection("🧭 探索模式");
  log("info", `目标: ${target}`);
  log("info", `最大步数: ${maxSteps}`);

  // 解析 URL：如果用户输入的是域名，自动补全 https://
  let url = target;
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = `https://${url}`;
  }

  let session: Awaited<ReturnType<typeof createExplorationSession>> | null = null;
  let stepCount = 0;
  let aborted = false;
  let saved = false;

  // 注册清理函数
  async function cleanup(): Promise<void> {
    if (session) {
      await closeSession(session);
      session = null;
    }
    input.pause();
  }

  // SIGINT 处理
  process.on("SIGINT", async () => {
    if (!aborted && !saved) {
      aborted = true;
      logAbort();
      await cleanup();
    }
    process.exit(130);
  });

  try {
    session = await createExplorationSession(url, maxSteps, params.headless ?? true);

    logSection("💬 探索会话");
    log("info", "可用命令:");
    log("info", "  - 直接输入自然语言指令 → 让 AI 执行");
    log("info", "  - save <名称> → 保存脚本");
    log("info", "  - abort → 退出");
    log("info", "  - 直接回车 → 继续下一步\n");

    while (stepCount < maxSteps) {
      stepCount++;
      log("info", `--- 步骤 ${stepCount}/${maxSteps} ---`);

      const userInput = await prompt("\n请输入指令: ");

      if (!userInput) {
        log("info", "跳过此步骤");
        continue;
      }

      if (userInput.toLowerCase() === "abort") {
        aborted = true;
        logAbort();
        break;
      }

      if (userInput.toLowerCase().startsWith("save ")) {
        const name = userInput.slice(5).trim();
        if (!name) {
          log("warn", "请提供脚本名称: save <名称>");
          stepCount--;
          continue;
        }

        const exists = await scriptExists(name);
        if (exists) {
          const confirm = await prompt(`脚本 "${name}" 已存在，是否覆盖？(y/N): `);
          if (confirm.toLowerCase() !== "y") {
            stepCount--;
            continue;
          }
        }

        const description = await prompt("请输入脚本描述（直接回车跳过）: ");

        if (!session) break;
        const yamlContent = freezeToYaml({
          name,
          description,
          explorationLog: session.log,
        });

        const meta = await saveScript({ name, description, yamlContent });
        logSave(name, meta.yamlPath);
        saved = true;
        break;
      }

      if (!session) break;

      logExplore(userInput);
      await executeAndLog(session, userInput);

      // 显示当前探索进度
      if (session.log.steps.length > 0) {
        log("info", `已执行步骤: ${session.log.steps.length}`);
      }
    }

    if (stepCount >= maxSteps) {
      log("warn", `已达到最大步数限制 (${maxSteps})`);
    }

    if (!aborted && !saved) {
      log("warn", "探索会话结束，请使用 save <名称> 保存脚本");
    }
  } catch (err) {
    log("error", `探索失败: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  } finally {
    if (session) {
      await cleanup();
    }
  }
}
