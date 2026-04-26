/**
 * 脚本名称自动生成器
 *
 * 优先使用 LLM（Midscene 当前配置的模型）生成简短中文名称；
 * 失败时 fallback 到规则引擎，保证始终能返回名称。
 */

import { getMidsceneConfig } from "../utils/config.js";
import { log } from "../utils/logger.js";

/** LLM 调用超时（毫秒） */
const LLM_TIMEOUT_MS = 10_000;

/** 名称最大字符数 */
const MAX_NAME_LENGTH = 15;

const NAME_PROMPT_TEMPLATE = `你是一个脚本命名助手。请根据以下自然语言指令，生成一个简短的中文脚本名称。

要求：
- 15 个中文字符以内，言简意赅
- 直接返回名称，不要解释，不要加引号

示例：
- 输入："登录系统，用户名admin密码123" → 输出：系统登录
- 输入："搜索商品并加入购物车" → 输出：商品搜索加购

输入：{instruction}
输出：`;

/**
 * 生成脚本名称
 *
 * @param instruction 自然语言指令
 * @returns 生成的脚本名称（已做文件名安全处理）
 */
export async function generateScriptName(instruction: string): Promise<string> {
  const config = getMidsceneConfig();

  // 1. 优先尝试 LLM 生成
  try {
    const name = await callLlmForName(config, instruction);
    if (name && name.trim().length > 0) {
      return sanitizeFileName(name.trim());
    }
  } catch (err) {
    log("warn", `LLM 命名失败，使用规则引擎: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 2. Fallback: 规则引擎
  return ruleBasedName(instruction);
}

/**
 * 调用 LLM 生成名称
 */
async function callLlmForName(
  config: { modelBaseUrl: string; modelApiKey: string; modelName: string },
  instruction: string,
): Promise<string> {
  const url = `${config.modelBaseUrl.replace(/\/$/, "")}/chat/completions`;
  const prompt = NAME_PROMPT_TEMPLATE.replace("{instruction}", instruction);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.modelApiKey}`,
      },
      body: JSON.stringify({
        model: config.modelName,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 30,
        temperature: 0.3,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = data.choices?.[0]?.message?.content ?? "";
    return content.trim();
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/**
 * 规则引擎：根据关键词拼接名称
 *
 * 策略：
 * 1. 从指令中提取中文/英文关键词（2 字以上）
 * 2. 取前 3 个拼接，上限 15 字
 * 3. 仍失败则用 "未命名脚本" + 时间戳后 6 位
 */
function ruleBasedName(instruction: string): string {
  // 提取有效词：中文 2+ 字，或英文 3+ 字符
  const chineseWords = instruction.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  const englishWords = instruction.match(/[a-zA-Z]{3,}/g) ?? [];

  const allWords = [...chineseWords, ...englishWords];

  if (allWords.length > 0) {
    // 取前 3 个词拼接
    const joined = allWords.slice(0, 3).join("");
    if (joined.length <= MAX_NAME_LENGTH) {
      return joined;
    }
    // 超长则截断到 15 字
    return joined.slice(0, MAX_NAME_LENGTH);
  }

  // 兜底：时间戳
  const ts = Date.now().toString().slice(-6);
  return `未命名脚本${ts}`;
}

/**
 * 将名称转换为安全的文件名
 * - 移除不安全字符
 * - 空格替换为下划线
 * - 限制最大长度
 */
export function sanitizeFileName(name: string): string {
  return (
    name
      .replace(/[<>:"/\\|?*\x00-\x1f\s]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, MAX_NAME_LENGTH) || `fallback_${Date.now().toString().slice(-6)}`
  );
}
