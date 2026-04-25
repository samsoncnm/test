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
    const executions = parseReportFile(reportHtmlPath);

    for (const exec of executions) {
      if (exec.status !== "finished") continue;

      // 跳过 Locate 任务（无 yamlFlow，无 actions，只有 param.prompt）
      if (exec.subType === "Locate") {
        continue;
      }

      // ✅ ActionSpace 任务不单独处理（Plan 任务的 yamlFlow 已包含完整动作信息）

      // ✅ Plan 任务：提取 yamlFlow 条目（记录 locate 信息）
      if (exec.subType === "Plan") {
        if (exec.yamlFlow?.length) {
          for (const item of exec.yamlFlow) {
            const serialized = serializeYamlFlowItem(item);
            if (serialized) {
              // 跳过空条目（空 ai: "" 等）
              flow.push(serialized);
            }
          }
        }
        // 最后一个 Plan：shouldContinuePlanning=false 时，outputOutput 是断言结果
        if (exec.shouldContinuePlanning === false && exec.outputOutput?.trim()) {
          flow.push({ aiAssert: exec.outputOutput.trim() });
        }
        continue;
      }

      // ActionSpace 任务不单独处理（Plan 任务的 yamlFlow 已包含完整动作信息）

      // 降级兜底（只有非 Plan/Locate 的其他 subType）
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

  const yamlScript: YamlScript = {
    web: {
      url: explorationLog.startUrl,
    },
    tasks: [
      {
        name: params.description || params.name,
        flow,
      },
    ],
  };

  // 检查是否有任意一步启用了 deepLocate
  const hasDeepLocate = explorationLog.steps.some((s) => s.deepLocate === true);
  if (hasDeepLocate) {
    yamlScript.agent = {
      deepLocate: true,
    };
  }

  return stringify(yamlScript, { indent: 2, lineWidth: 0 });
}
