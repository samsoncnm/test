/**
 * CLI 入口
 * 注册 explore / run / scripts 三个子命令
 */

import { Command } from "commander";
import pc from "picocolors";
import { logSection } from "../utils/logger.js";
import { runExplore } from "./commands/explore.js";
import { runScript } from "./commands/run.js";
import { listScripts, removeScript } from "./commands/scripts.js";

const program = new Command();

program.name("nl-script").description("自然语言脚本探索与固定脚本执行系统").version("0.1.0");

// explore 子命令
program
  .command("explore")
  .description("启动探索模式，交互式执行自然语言指令")
  .argument("<target>", "目标 URL 或自然语言描述")
  .option("--max-steps <number>", "最大探索步数", "20")
  .option("--headful", "使用有头模式（显示浏览器窗口），方便录制和调试")
  .option("--deep-locate", "启用深度定位（deepLocate），适合复杂页面，精确度更高但速度较慢")
  .action(async (target, options) => {
    try {
      await runExplore({
        target,
        maxSteps: Number.parseInt(options.maxSteps, 10),
        headless: !options.headful,
        deepLocate: options.deepLocate ?? false,
      });
    } catch (err) {
      console.error(`${pc.red("[ERROR]")} ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// run 子命令
program
  .command("run")
  .description("运行已保存的脚本")
  .argument("<script-name>", "脚本名称")
  .action(async (scriptName) => {
    try {
      await runScript(scriptName);
    } catch (err) {
      console.error(`${pc.red("[ERROR]")} ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// scripts 子命令
const scriptsCmd = program.command("scripts").description("脚本管理");

scriptsCmd
  .command("list")
  .description("列出所有脚本")
  .action(async () => {
    try {
      await listScripts();
    } catch (err) {
      console.error(`${pc.red("[ERROR]")} ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

scriptsCmd
  .command("rm")
  .description("删除脚本")
  .argument("<script-name>", "脚本名称")
  .action(async (scriptName) => {
    try {
      await removeScript(scriptName);
    } catch (err) {
      console.error(`${pc.red("[ERROR]")} ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// 打印 banner
function printBanner(): void {
  console.log(
    pc.cyan(`
  ██╗   ██╗██████╗ ███████╗██╗███████╗██╗
  ██║   ██║██╔══██╗██╔════╝██║██╔════╝██║
  ██║   ██║██████╔╝███████╗██║███████╗██║
  ╚██╗ ██╔╝██╔═══╝ ╚════██║██║╚════██║██║
   ╚████╔╝ ██║     ███████║██║███████║██║
    ╚═══╝  ╚═╝     ╚══════╝╚═╝╚══════╝╚═╝
  `),
  );
  console.log(pc.dim("  自然语言脚本探索与固定脚本执行系统\n"));
}

printBanner();
program.parse();
