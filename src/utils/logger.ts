/**
 * 流式日志工具
 * 带时间戳和颜色的终端输出
 */

import pc from "picocolors";

export type LogLevel = "info" | "success" | "warn" | "error" | "debug";

const LEVEL_STYLES: Record<LogLevel, (msg: string) => string> = {
  info: (msg) => `${pc.cyan("[INFO]")} ${msg}`,
  success: (msg) => `${pc.green("[OK]")} ${msg}`,
  warn: (msg) => `${pc.yellow("[WARN]")} ${msg}`,
  error: (msg) => `${pc.red("[ERROR]")} ${msg}`,
  debug: (msg) => `${pc.gray("[DEBUG]")} ${msg}`,
};

function formatTime(): string {
  return new Date().toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
}

export function log(level: LogLevel, message: string): void {
  const ts = pc.gray(`[${formatTime()}]`);
  console.log(`${ts} ${LEVEL_STYLES[level](message)}`);
}

export function logStep(step: number, action: string): void {
  log("info", `${pc.bold(pc.white(`步骤 ${step}`))} ${action}`);
}

export function logExplore(action: string): void {
  log("info", `${pc.cyan("▶ AI 执行:")} ${action}`);
}

export function logSave(name: string, path: string): void {
  log("success", `脚本已保存: ${pc.bold(name)} → ${pc.dim(path)}`);
}

export function logRun(name: string): void {
  log("info", `正在运行脚本: ${pc.bold(name)}`);
}

export function logAbort(): void {
  log("warn", "用户终止探索会话");
}

export function logSection(title: string): void {
  console.log(`\n${pc.bold(pc.underline(pc.white(title)))}\n`);
}

export function logError(error: unknown): void {
  const msg = error instanceof Error ? error.message : String(error);
  log("error", msg);
}
