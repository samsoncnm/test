/**
 * 脚本存储管理
 * 负责 scripts-index.json 索引和 YAML 文件的 CRUD
 */

import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { v4 as uuidv4 } from "uuid";
import type { ScriptMeta, ScriptsIndex } from "../types/index.js";
import { log } from "../utils/logger.js";

const SCRIPTS_DIR = resolve(process.cwd(), "scripts", "templates");
const INDEX_FILE = join(SCRIPTS_DIR, "scripts-index.json");
const PROJECT_ROOT = process.cwd();

const DEFAULT_INDEX: ScriptsIndex = { version: 1, scripts: [] };

async function ensureDir(): Promise<void> {
  try {
    await fs.mkdir(SCRIPTS_DIR, { recursive: true });
  } catch {
    // 目录已存在，忽略
  }
}

async function loadIndex(): Promise<ScriptsIndex> {
  try {
    const content = await fs.readFile(INDEX_FILE, "utf-8");
    return JSON.parse(content) as ScriptsIndex;
  } catch {
    return DEFAULT_INDEX;
  }
}

async function saveIndex(index: ScriptsIndex): Promise<void> {
  await ensureDir();
  await fs.writeFile(INDEX_FILE, JSON.stringify(index, null, 2), "utf-8");
}

export async function loadAllScripts(): Promise<ScriptMeta[]> {
  const index = await loadIndex();
  return index.scripts;
}

export async function getScript(name: string): Promise<ScriptMeta | null> {
  const index = await loadIndex();
  return index.scripts.find((s) => s.name === name) ?? null;
}

export async function getScriptPath(name: string): Promise<string | null> {
  const script = await getScript(name);
  if (!script) return null;
  return join(PROJECT_ROOT, script.yamlPath);
}

export async function saveScript(params: {
  name: string;
  description: string;
  yamlContent: string;
}): Promise<ScriptMeta> {
  await ensureDir();

  const yamlFileName = `${params.name}.yaml`;
  const yamlPath = join("scripts", "templates", yamlFileName);
  const fullPath = join(PROJECT_ROOT, yamlPath);

  await fs.writeFile(fullPath, params.yamlContent, "utf-8");

  const index = await loadIndex();
  const existing = index.scripts.findIndex((s) => s.name === params.name);
  const now = new Date().toISOString();

  const meta: ScriptMeta = {
    id: existing >= 0 ? (index.scripts[existing]?.id ?? uuidv4()) : uuidv4(),
    name: params.name,
    description: params.description,
    yamlPath,
    createdAt: existing >= 0 ? (index.scripts[existing]?.createdAt ?? now) : now,
    updatedAt: now,
  };

  if (existing >= 0) {
    index.scripts[existing] = meta;
  } else {
    index.scripts.push(meta);
  }

  await saveIndex(index);

  log("success", `脚本 "${params.name}" 已保存`);
  return meta;
}

export async function deleteScript(name: string): Promise<boolean> {
  const index = await loadIndex();
  const existing = index.scripts.find((s) => s.name === name);
  if (!existing) return false;

  const fullPath = join(PROJECT_ROOT, existing.yamlPath);
  await fs.unlink(fullPath).catch(() => {
    // 文件不存在也视为删除成功
  });

  index.scripts = index.scripts.filter((s) => s.name !== name);
  await saveIndex(index);

  log("success", `脚本 "${name}" 已删除`);
  return true;
}

export async function scriptExists(name: string): Promise<boolean> {
  const script = await getScript(name);
  return script !== null;
}

export interface ScriptSearchResult {
  script: ScriptMeta | null;
  matchedBy?: "exact" | "prefix" | "fuzzy";
}

/**
 * 模糊查找脚本：精确 → 前缀 → 包含
 * 单 token 场景（如 "densave"）可以找到 "densave 登录流程"
 */
export async function findScriptByFuzzyName(name: string): Promise<ScriptSearchResult> {
  const scripts = await loadAllScripts();

  // 1. 精确匹配
  const exact = scripts.find((s) => s.name === name);
  if (exact) return { script: exact, matchedBy: "exact" };

  // 2. 前缀匹配（以 name + 空格 开头，防止 densave 匹配到 densaveX）
  const prefix = scripts.find((s) => s.name.startsWith(`${name} `));
  if (prefix) return { script: prefix, matchedBy: "prefix" };

  // 3. 包含匹配（脚本名中包含输入串）
  const includes = scripts.find((s) => s.name.includes(name));
  if (includes) return { script: includes, matchedBy: "fuzzy" };

  return { script: null };
}
