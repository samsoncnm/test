/**
 * Midscene 报告解析器
 * 使用 splitReportFile 解析 HTML 报告，提取 execution JSON 中的 yamlFlow 数据
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { splitReportFile } from "@midscene/core";
/**
 * 解析 Midscene HTML 报告文件，提取所有 execution 数据
 *
 * @param htmlPath - Midscene HTML 报告文件路径
 * @returns 解析后的 execution 列表
 */
export function parseReportFile(htmlPath) {
    if (!fs.existsSync(htmlPath)) {
        return [];
    }
    const outputDir = path.dirname(htmlPath);
    // splitReportFile 是同步函数，会在 outputDir 下生成 .execution.json 文件
    const result = splitReportFile({ htmlPath, outputDir });
    const executions = [];
    for (const jsonFile of result.executionJsonFiles) {
        if (!fs.existsSync(jsonFile)) {
            continue;
        }
        const raw = JSON.parse(fs.readFileSync(jsonFile, "utf-8"));
        const executionList = raw.executions ?? [];
        for (const exec of executionList) {
            const taskList = exec.tasks ?? [];
            for (const task of taskList) {
                const output = task.output ?? {};
                const param = task.param ?? {};
                // 跳过 Plan 类型（只有 yamlFlow 非空时才记录）
                // 优先提取 yamlFlow，其次提取 actions，最后降级
                const yamlFlow = output.yamlFlow;
                const actions = output.actions;
                executions.push({
                    taskName: exec.name ?? "",
                    subType: task.subType ?? "",
                    userInstruction: param.userInstruction ?? "",
                    status: task.status ?? "",
                    durationMs: task.timing?.cost ?? 0,
                    actions,
                    yamlFlow: yamlFlow?.length ? yamlFlow : undefined,
                    outputOutput: output.output ?? undefined,
                    shouldContinuePlanning: output.shouldContinuePlanning ?? undefined,
                });
            }
        }
    }
    return executions;
}
