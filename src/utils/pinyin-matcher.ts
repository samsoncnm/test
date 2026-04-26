/**
 * 拼音 + 编辑距离混合匹配器
 *
 * 匹配策略（从快到慢）：
 * 1. 精确匹配 → 2. 前缀匹配 → 3. 包含匹配 → 4. 拼音匹配 → 5. 编辑距离匹配
 *
 * 拼音匹配解决：用户输入拼音选错字的问题（如 "denglu" → "登录"）
 * 编辑距离匹配解决：真正的手误错字（如 "验正" → "验证"）
 *
 * 设计原则：实时计算，无状态。不修改 ScriptMeta 存储结构。
 */

import { pinyin } from "pinyin";
import type { ScriptMeta } from "../types/index.js";

/** 拼音风格：0 = 无声调（"denglu"），与 pinyin@4.0.0 API 一致 */
const STYLE_NORMAL = 0;

/** 将中文转无声调拼音（style: 0） */
export function toPinyin(str: string): string {
  return pinyin(str, { style: STYLE_NORMAL })
    .map((seg) => seg[0] ?? "")
    .join("");
}

/** 编辑距离（纯 TypeScript，无外部依赖） */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const prevDiag = dp[i - 1]![j - 1]!;
      const up = dp[i - 1]![j]!;
      const left = dp[i]![j - 1]!;
      dp[i]![j] = a[i - 1] === b[j - 1] ? prevDiag : 1 + Math.min(up, left, prevDiag);
    }
  }
  return dp[m]![n]!;
}

export interface MatchResult {
  script: ScriptMeta;
  score: number;
}

/** 综合得分 = 0.6 × 拼音相似度 + 0.4 × 字符相似度，阈值 > 0.5 */
export function findByPinyin(query: string, candidates: ScriptMeta[]): MatchResult | null {
  const queryPy = toPinyin(query);
  let best: MatchResult | null = null;

  for (const candidate of candidates) {
    const candPy = toPinyin(candidate.name);
    if (!candPy) continue;

    const pySim =
      1 - levenshteinDistance(queryPy, candPy) / Math.max(queryPy.length, candPy.length);
    const charSim =
      1 -
      levenshteinDistance(query, candidate.name) / Math.max(query.length, candidate.name.length);
    const score = 0.6 * pySim + 0.4 * charSim;

    if (score > 0.5 && (!best || score > best.score)) {
      best = { script: candidate, score };
    }
  }
  return best;
}

/** 编辑距离匹配：容忍真正的手误，maxDistance = 2 */
export function findByEditDistance(
  query: string,
  candidates: ScriptMeta[],
  options: { maxDistance?: number } = {},
): MatchResult | null {
  const { maxDistance = 2 } = options;
  let best: MatchResult | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const dist = levenshteinDistance(query, candidate.name);
    if (dist <= maxDistance && dist < bestScore) {
      bestScore = dist;
      best = { script: candidate, score: 1 - dist / Math.max(query.length, candidate.name.length) };
    }
  }
  return best;
}
