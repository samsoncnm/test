/**
 * run 命令
 * 加载 YAML 脚本并通过 midscene CLI 执行
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { getScriptPath } from "../../storage/script-store.js";
import { log, logRun } from "../../utils/logger.js";

export async function runScript(scriptName: string): Promise<void> {
  const yamlPath = await getScriptPath(scriptName);

  if (!yamlPath) {
    throw new Error(`脚本 "${scriptName}" 不存在，请先使用 explore 命令创建`);
  }

  logRun(scriptName);
  log("info", `脚本路径: ${yamlPath}`);

  // 解析为绝对路径，确保 midscene CLI 能找到文件
  const absoluteYamlPath = resolve(yamlPath);
  const projectRoot = process.cwd();

  return new Promise((resolve, reject) => {
    const midsceneBin = join(projectRoot, "node_modules", "@midscene", "cli", "bin", "midscene");

    // 尝试本地 midscene CLI，fallback 到 npx
    let cmd: string;
    let args: string[];

    if (existsSync(midsceneBin)) {
      cmd = "node";
      args = [midsceneBin, absoluteYamlPath];
    } else {
      cmd = "npx";
      args = ["midscene", absoluteYamlPath];
    }

    const child = spawn(cmd, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      cwd: projectRoot,
    });

    child.on("close", (code) => {
      if (code === 0) {
        log("success", "脚本执行完成");
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
