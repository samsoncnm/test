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
import { parseReportFile } from "../utils/report-parser.js";
/**
 * 动作类型映射表（Midscene 原生动作类型 → YAML key）
 */
const ACTION_TYPE_MAP = {
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
function normalizeActionType(type) {
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
export async function freezeToYaml(params) {
    const { explorationLog, reportHtmlPath } = params;
    const flow = [];
    // 优先从报告 JSON 解析 yamlFlow
    if (reportHtmlPath) {
        const executions = parseReportFile(reportHtmlPath);
        for (const exec of executions) {
            if (exec.status !== "finished")
                continue;
            // 跳过 Locate 任务（只有 param.prompt，无 userInstruction）
            if (!exec.userInstruction) {
                continue;
            }
            // 策略 1：Plan 任务有 yamlFlow → 放入动作 + 末尾追加断言
            if (exec.subType === "Plan" && exec.yamlFlow?.length) {
                for (const item of exec.yamlFlow) {
                    flow.push(item);
                }
                // 最后一个 Plan 任务的 outputOutput 才是断言
                if (exec.shouldContinuePlanning === false && exec.outputOutput?.trim()) {
                    flow.push({ aiAssert: exec.outputOutput.trim() });
                }
                continue;
            }
            // 策略 2：yamlFlow 为空但 outputOutput 有值 → 纯断言（Plan 任务）
            if (exec.subType === "Plan" && !exec.yamlFlow?.length && exec.outputOutput?.trim()) {
                flow.push({ aiAssert: exec.outputOutput.trim() });
                continue;
            }
            // ✅ ActionSpace 任务（Input / Tap / DoubleClick 等）：从 actions[] 提取
            // yamlFlow 格式：{ aiTap: "", locate: "..." } 或 { aiInput: "", value: "...", locate: "..." }
            if (exec.actions && exec.actions.length > 0) {
                for (const action of exec.actions) {
                    const normalizedType = normalizeActionType(action.type);
                    // aiInput / aiTap / aiDoubleClick 等的 action type 小写不含 "ai" 前缀
                    const actionSuffix = normalizedType.replace(/^ai/, "").toLowerCase();
                    const param = action.param ?? {};
                    if (param.value !== undefined) {
                        // 有 value → aiInput 类型（带输入值）
                        const item = { [normalizedType]: "", value: param.value };
                        if (param.locate)
                            item.locate = param.locate;
                        flow.push(item);
                    }
                    else {
                        // 无 value → aiTap / aiDoubleClick 等
                        // 从 yamlFlow 中找 locate 描述（yamlFlow 只存在于 Plan 任务中，与 ActionSpace 并行）
                        const locateValue = (() => {
                            if (exec.yamlFlow && exec.yamlFlow.length > 0) {
                                const found = exec.yamlFlow.find((f) => {
                                    const key = Object.keys(f)[0] ?? "";
                                    return key.replace(/^ai/, "").toLowerCase() === actionSuffix;
                                });
                                if (found && "locate" in found)
                                    return found.locate;
                            }
                            return param.locate ?? exec.userInstruction;
                        })();
                        flow.push({ [normalizedType]: "", locate: locateValue });
                    }
                }
                continue;
            }
            // 策略 4：降级为 ai 字符串（无法解析时兜底）
            if (exec.userInstruction) {
                flow.push({ ai: exec.userInstruction });
            }
        }
    }
    // 最终 fallback：从原始步骤列表降级生成（无报告文件时）
    if (flow.length === 0) {
        for (const step of explorationLog.steps) {
            if (step.result !== "success")
                continue;
            const action = step.action.trim();
            if (/等待|wait|sleep/i.test(action)) {
                flow.push({ sleep: 3000 });
            }
            else {
                flow.push({ ai: action });
            }
        }
    }
    const yamlScript = {
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
