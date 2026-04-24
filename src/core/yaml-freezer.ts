/**
 * YAML 凝固器
 * 将探索会话日志转换为 Midscene 原生 YAML 格式
 */

import { stringify } from "yaml";
import type { ExplorationLog, YamlScript } from "../types/index.js";

export function freezeToYaml(params: {
  name: string;
  description: string;
  explorationLog: ExplorationLog;
}): string {
  const { explorationLog } = params;

  // 将成功执行的步骤转换为 YAML flow
  const flow = explorationLog.steps
    .filter((s) => s.result === "success")
    .map((s) => {
      // 如果用户输入包含明确的等待意图，插入 sleep
      const action = s.action.trim();

      if (action.includes("等待") || action.includes("wait")) {
        return { sleep: 3000 };
      }

      return { ai: action };
    });

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

  return stringify(yamlScript, { indent: 2, lineWidth: 0 });
}
