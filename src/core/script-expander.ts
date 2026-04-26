/**
 * Delta Freeze 预处理器
 *
 * 在脚本运行前，将 YAML 中 baseScript 引用展开为完整 flow。
 *
 * 工作原理：
 * 1. 解析 YAML，找到 tasks 中含有 baseScript 的 task
 * 2. 根据 baseScript 名称加载对应脚本的 YAML 内容
 * 3. 递归展开被引用脚本（支持链式引用 A→B→C）
 * 4. 将 baseScript 的 flow 拼接在当前 task 的 flow 前面
 * 5. 删除 baseScript 字段，展开后的 YAML 是标准 Midscene 格式
 *
 * 关键约束（基于 Midscene 官方文档验证）：
 * - Midscene 仅处理已知动作键（ai/aiTap/aiInput/aiAssert 等）
 * - 未知字段静默忽略，展开后删除 baseScript 字段即可
 * - callTask/include 功能尚未实现（Issue #2215），所以在 run.ts 层预处理
 */

import { parse } from "yaml";
import type { YamlScript } from "../types/index.js";
import { log } from "../utils/logger.js";

export interface ScriptLoaderResult {
  content: string;
  yamlPath: string;
}

/**
 * 展开 baseScript 引用为完整 flow
 *
 * @param doc          解析后的 YamlScript 对象
 * @param visited      已访问的 baseScript 名称集合（用于循环引用检测）
 * @param loadScript   按名称加载脚本 YAML 内容的回调
 */
export async function expandScriptReferences(
  doc: YamlScript,
  visited?: Set<string>,
  loadScript?: (name: string) => Promise<ScriptLoaderResult>,
): Promise<YamlScript> {
  const visitedSet = visited ?? new Set<string>();
  const tasks = doc.tasks;

  for (const task of tasks) {
    if (!task.baseScript) continue;

    const refName = task.baseScript;
    log("info", `[Delta Freeze] 检测到 baseScript 引用: ${refName}，正在展开...`);

    // 循环引用检测
    if (visitedSet.has(refName)) {
      const chain = [...visitedSet].join(" → ");
      throw new Error(`循环引用检测失败: "${refName}"（引用链: ${chain} → ${refName}）`);
    }
    visitedSet.add(refName);

    // 加载被引用脚本
    if (!loadScript) {
      throw new Error("loadScript 回调未提供，无法展开 baseScript 引用");
    }
    const { content: baseContent, yamlPath } = await loadScript(refName);
    log("debug", `已加载基础脚本: ${refName}（${yamlPath}）`);

    // 递归展开被引用脚本（支持链式引用）
    const baseDoc = parse(baseContent) as YamlScript;
    const expandedBase = await expandScriptReferences(baseDoc, visitedSet, loadScript);

    // 取被引用脚本的第一个 task 的 flow 作为基础 flow
    const baseFlow = expandedBase.tasks[0]?.flow ?? [];
    const currentFlow = task.flow ?? [];

    // 拼接：baseScript.flow + 当前 flow
    task.flow = [...baseFlow, ...currentFlow];
    const baseStepCount = baseFlow.length;
    const addedStepCount = currentFlow.length;
    log(
      "info",
      `[Delta Freeze] baseScript "${refName}" 已展开：基础 flow ${baseStepCount} 步 + 当前 flow ${addedStepCount} 步 → 合并后 ${task.flow.length} 步`,
    );

    // 删除 baseScript 字段，Midscene 不识别此字段
    task.baseScript = undefined;
  }

  return doc;
}
