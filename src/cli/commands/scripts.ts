/**
 * scripts 命令
 * 脚本管理：list / rm
 */

import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import pc from "picocolors";
import { deleteScript, loadAllScripts } from "../../storage/script-store.js";
import { log, logSection } from "../../utils/logger.js";

const rl = createInterface({ input: process.stdin, output: process.stdout });

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

export async function listScripts(): Promise<void> {
  const scripts = await loadAllScripts();

  logSection("📋 脚本列表");
  if (scripts.length === 0) {
    log("warn", "暂无脚本，请先使用 explore 命令创建");
    return;
  }

  for (const script of scripts) {
    const created = new Date(script.createdAt).toLocaleDateString("zh-CN");
    const updated =
      script.updatedAt !== script.createdAt
        ? ` (更新: ${new Date(script.updatedAt).toLocaleDateString("zh-CN")})`
        : "";

    console.log(`  ${pc.cyan(pc.bold(script.name))} ${pc.gray(`- 创建于 ${created}${updated}`)}`);
    if (script.description) {
      console.log(`    ${script.description}`);
    }
    console.log(`    ${pc.dim(`路径: ${script.yamlPath}`)}`);
    console.log();
  }
}

export async function removeScript(name: string): Promise<void> {
  const confirm = await prompt(`确定要删除脚本 "${name}" 吗？(此操作不可撤销) [y/N]: `);

  if (confirm.toLowerCase() !== "y") {
    log("info", "已取消删除");
    rl.close();
    return;
  }

  const deleted = await deleteScript(name);
  if (!deleted) {
    log("error", `脚本 "${name}" 不存在`);
  }

  rl.close();
}

function getCacheDir(): string {
  return resolve(process.cwd(), "midscene_run", "cache");
}

function getCacheFilePath(name: string): string {
  return join(getCacheDir(), `${name}.cache.yaml`);
}

export async function listCache(): Promise<void> {
  const cacheDir = getCacheDir();

  if (!existsSync(cacheDir)) {
    log("info", "缓存目录不存在，尚无缓存文件");
    return;
  }

  const files = readdirSync(cacheDir).filter((f) => f.endsWith(".cache.yaml"));

  if (files.length === 0) {
    log("info", "缓存目录为空，尚无缓存文件");
    return;
  }

  logSection("💾 缓存列表");
  log("info", `共 ${files.length} 个缓存文件：\n`);

  for (const file of files) {
    const cacheId = file.replace(".cache.yaml", "");
    const cachePath = join(cacheDir, file);
    const stat = statSync(cachePath);
    const sizeKb = (stat.size / 1024).toFixed(1);
    const mtime = stat.mtime.toLocaleDateString("zh-CN");

    console.log(`  ${pc.cyan(pc.bold(cacheId))}`);
    console.log(`    ${pc.dim(`文件: ${file}`)}`);
    console.log(`    ${pc.dim(`大小: ${sizeKb} KB | 修改: ${mtime}`)}`);
    console.log();
  }
}

export async function cleanCache(name: string): Promise<void> {
  const cachePath = getCacheFilePath(name);

  if (!existsSync(cachePath)) {
    log("warn", `缓存文件不存在: ${cachePath}`);
    return;
  }

  const confirm = await prompt(`确定要删除脚本 "${name}" 的缓存吗？(y/N): `);

  if (confirm.toLowerCase() !== "y") {
    log("info", "已取消");
    rl.close();
    return;
  }

  rmSync(cachePath);
  log("success", `已删除缓存: ${cachePath}`);
  rl.close();
}

export async function clearAllCache(): Promise<void> {
  const cacheDir = getCacheDir();

  if (!existsSync(cacheDir)) {
    log("info", "缓存目录不存在，无需清理");
    rl.close();
    return;
  }

  const files = readdirSync(cacheDir).filter((f) => f.endsWith(".cache.yaml"));

  if (files.length === 0) {
    log("info", "缓存目录为空，无需清理");
    rl.close();
    return;
  }

  logSection("🗑 清理全部缓存");
  log("info", `发现 ${files.length} 个缓存文件:`);
  for (const f of files) {
    console.log(`  ${pc.dim(f)}`);
  }

  const confirm = await prompt(
    `\n确定要删除全部 ${files.length} 个缓存文件吗？(此操作不可撤销) [y/N]: `,
  );

  if (confirm.toLowerCase() !== "y") {
    log("info", "已取消");
    rl.close();
    return;
  }

  rmSync(cacheDir, { recursive: true, force: true });
  log("success", `已删除缓存目录: ${cacheDir}`);
  rl.close();
}
