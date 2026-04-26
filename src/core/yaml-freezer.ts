/**
 * YAML 凝固器
 * 将探索会话日志转换为 Midscene 原生 YAML 格式
 *
 * 升级点（Phase 1）：
 * - 优先从报告 JSON 的 output.yamlFlow[] 提取原生动作类型
 * - fallback 到 output.actions[] 映射
 * - 最终降级为 ai: 原始指令字符串
 */

import { stringify } from "yaml";
import type { ExplorationLog, YamlFlowItem, YamlScript } from "../types/index.js";
import { log } from "../utils/logger.js";
import { parseReportFile } from "../utils/report-parser.js";

/**
 * 动作类型映射表（Midscene 原生动作类型 → YAML key）
 */
const ACTION_TYPE_MAP: Record<string, string> = {
  input: "aiInput",
  tap: "aiTap",
  click: "aiTap",
  doubleclick: "aiDoubleClick",
  rightclick: "aiRightClick",
  hover: "aiHover",
  scroll: "aiScroll",
  sleep: "sleep",
  wait: "sleep",
  keyboardpress: "aiKeyboardPress",
  clearinput: "aiClearInput",
  longpress: "aiLongPress",
  pinch: "aiPinch",
  draganddrop: "aiDragAndDrop",
};

/**
 * 将原始 action type 字符串归一化为 Midscene YAML 动作 key
 */
function normalizeActionType(type: string): string {
  const key = type.toLowerCase();
  return ACTION_TYPE_MAP[key] ?? "ai";
}

/**
 * 从 Midscene Plan task 的原始响应 XML 中提取 <log>...</log> 标签内容
 * rawResponse 格式如: <!-- Step 1: Observe -->\n<thought>...</thought>\n<log>在密码输入框中输入 admin123</log>
 */
function extractLogFromRawResponse(rawResponse: string): string {
  const match = rawResponse.match(/<log>([\s\S]*?)<\/log>/);
  if (match) {
    return match[1]!.trim();
  }
  return "";
}

/**
 * 将探索会话凝固为 Midscene YAML 脚本
 *
 * @param params.name - 脚本名称
 * @param params.description - 脚本描述
 * @param params.explorationLog - 探索会话日志
 * @param params.reportHtmlPath - 可选：最新报告 HTML 路径，优先从 yamlFlow 提取动作
 */
export async function freezeToYaml(params: {
  name: string;
  description: string;
  explorationLog: ExplorationLog;
  reportHtmlPath?: string;
  /**
   * save 时刻的当前页面 URL。
   * 若与 explorationLog.startUrl 不同，说明页面已跳转，
   * 凝固的 xpath 可能属于跳转后页面，不适用于从 startUrl 开始的 run 模式。
   */
  currentUrl?: string;
}): Promise<string> {
  /**
   * 将 locate 字段规范化为字符串
   * param.locate 可能是 {description: "..."} 对象，也可能是字符串
   */
  function normalizeLocate(locate: unknown): string | undefined {
    if (!locate) return undefined;
    if (typeof locate === "string") return locate;
    if (typeof locate === "object") {
      const obj = locate as Record<string, unknown>;
      if (typeof obj.description === "string") return obj.description;
    }
    return undefined;
  }

  /**
   * 将单个 yamlFlow 条目序列化（处理 locate 对象 → 字符串）
   * 返回 undefined 如果条目全为空（空 ai: "" 等）
   */
  function serializeYamlFlowItem(item: YamlFlowItem): Record<string, unknown> | undefined {
    const result: Record<string, unknown> = {};
    let hasActionKey = false;

    for (const [key, val] of Object.entries(item)) {
      if (key === "locate") {
        result[key] = normalizeLocate(val) ?? "";
      } else if (key === "ai" && (val === "" || val === undefined)) {
        // 空 ai: "" 跳过（通用指令无实质内容）
      } else if (val === "" || val === undefined) {
        // 其他非空动作类型键（如 aiInput/aiTap）保留，值设为空字符串
        hasActionKey = true;
        result[key] = "";
      } else {
        hasActionKey = true;
        result[key] = val;
      }
    }

    return hasActionKey ? result : undefined;
  }

  const { explorationLog, reportHtmlPath } = params;
  const flow: Record<string, unknown>[] = [];

  // 优先从报告 JSON 解析 yamlFlow
  if (reportHtmlPath) {
    const { executions } = parseReportFile(reportHtmlPath);

    // 1. 扁平化所有 Plan task 的 yamlFlow 为一个完整序列，同时记录来自哪个 exec
    // 以及 Plan task 的 log（自然语言动作描述，用于 aiInput 无 locate 时的 fallback）
    const flatFlow: Array<{ item: YamlFlowItem; execIndex: number }> = [];
    for (const exec of executions) {
      if (exec.status !== "finished") continue;
      if (exec.subType !== "Plan") continue;
      if (exec.yamlFlow?.length) {
        const execIndex = executions.indexOf(exec);
        for (const item of exec.yamlFlow) {
          flatFlow.push({ item, execIndex });
        }
      }
    }

    // 2. locate 推断：aiInput 无 locate 时，只看紧邻前序 Tap
    // - 前序是 aiTap（有 locate）：继承 locate
    // - 前序是 aiInput（无 locate）：Midscene 依赖 ActionSpace 上下文，跳过不推断
    for (let i = 0; i < flatFlow.length; i++) {
      const { item } = flatFlow[i]!;
      const actionKey = Object.keys(item).find(
        (k) => k !== "locate" && k !== "value" && k !== "timeout",
      );
      if (actionKey === "aiInput" && !item.locate && item.value) {
        const prev = flatFlow[i - 1];
        if (prev) {
          const prevKey = Object.keys(prev.item).find(
            (k) => k !== "locate" && k !== "value" && k !== "timeout",
          );
          if (prevKey === "aiTap" && prev.item.locate) {
            item.locate = prev.item.locate;
          }
        }
      }
    }

    // 3. 收集断言条目（最后一个 Plan 的 outputOutput）
    const assertItems: Record<string, unknown>[] = [];
    for (const exec of executions) {
      if (exec.status !== "finished") continue;
      if (
        exec.subType === "Plan" &&
        exec.shouldContinuePlanning === false &&
        exec.outputOutput?.trim()
      ) {
        assertItems.push({ aiAssert: exec.outputOutput.trim() });
      }
    }

    // 4. 序列化推断后的 flatFlow 条目
    // - aiInput 有 locate：正常凝固
    // - aiInput 无 locate（推断后仍无）：降级为 ai: exec.log（自然语言描述）
    for (const { item, execIndex } of flatFlow) {
      const actionKey = Object.keys(item).find(
        (k) => k !== "locate" && k !== "value" && k !== "timeout",
      );
      const isAiInputWithoutLocate = actionKey === "aiInput" && !item.locate && item.value;
      if (isAiInputWithoutLocate) {
        const exec = executions[execIndex]!;
        const rawLog = exec._rawTask?.log?.rawResponse ?? "";
        const extractedLog = extractLogFromRawResponse(rawLog);
        if (extractedLog) {
          flow.push({ ai: extractedLog });
        } else {
          flow.push({ ai: item.value as string });
        }
        continue;
      }
      const serialized = serializeYamlFlowItem(item);
      if (serialized) {
        flow.push(serialized);
      }
    }

    // 5. 追加断言
    flow.push(...assertItems);

    // 6. 降级兜底（非 Plan/Locate 的其他 subType）
    for (const exec of executions) {
      if (exec.status !== "finished") continue;
      if (exec.subType === "Locate" || exec.subType === "Plan") continue;
      if (exec.userInstruction) {
        flow.push({ ai: exec.userInstruction });
      }
    }
  }

  // 最终 fallback：从原始步骤列表降级生成（无报告文件时）
  if (flow.length === 0) {
    for (const step of explorationLog.steps) {
      if (step.result !== "success") continue;
      const action = step.action.trim();
      if (!action) continue;

      if (/等待|wait|sleep/i.test(action)) {
        flow.push({ sleep: 3000 });
      } else {
        flow.push({ ai: action });
      }
    }
  }

  // ── B3: URL 跳转检测 ──────────────────────────────────────────────────────
  // 若凝固时刻的 currentUrl 与 startUrl 不同，说明页面已跳转，
  // 缓存的 xpath 可能属于跳转后页面，从 startUrl 重新 run 会找不到元素。
  const startUrl = explorationLog.startUrl;
  const currentPageUrl = params.currentUrl ?? startUrl;
  if (currentPageUrl !== startUrl) {
    log("warn", `⚠️ 页面 URL 已跳转：${startUrl} → ${currentPageUrl}`);
    log("warn", "   凝固的 xpath 可能属于跳转后页面，从起始页重新 run 会找不到元素！");
    log("warn", "   建议：先登出或重置到起始页面，再重新 explore 并 save。");
  }

  // ── A2: ai:/aiAct: 条目警告 ─────────────────────────────────────────────
  // ai:/aiAct: 会触发 AI 规划推理（慢），建议改为 aiInput/aiTap 等 instant action
  const hasAiEntry = flow.some((item) => "ai" in item || "aiAct" in item);
  if (hasAiEntry) {
    log("warn", "⚠️ flow 中存在 ai:/aiAct: 条目，会触发 AI 规划推理（~50s/次）");
    log("warn", "   建议改为 aiInput/aiTap 等 instant action 类型以提升执行速度");
  }

  const hasDeepLocate = explorationLog.steps.some((s) => s.deepLocate === true);
  const yamlScript: YamlScript = {
    web: {
      url: explorationLog.startUrl,
    },
    agent: {
      cache: { id: params.name, strategy: "read-write" },
      ...(hasDeepLocate ? { deepLocate: true } : {}),
    },
    tasks: [
      {
        name: params.description || params.name,
        flow,
      },
    ],
  };

  return stringify(yamlScript, { indent: 2, lineWidth: 0 });
}
