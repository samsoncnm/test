/**
 * Midscene 模型配置读取
 * 优先级：环境变量 > dotenv（.env 文件）
 *
 * 单模型架构：主模型（qwen3-vl-plus）同时负责视觉定位和任务规划。
 */

import { config as dotenvConfig } from "dotenv";
import type { MidsceneConfig } from "../types/index.js";

dotenvConfig();

const REQUIRED_ENV_VARS = [
  "MIDSCENE_MODEL_BASE_URL",
  "MIDSCENE_MODEL_API_KEY",
  "MIDSCENE_MODEL_NAME",
  "MIDSCENE_MODEL_FAMILY",
] as const;

export function getMidsceneConfig(): MidsceneConfig {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    const hint =
      missing.includes("MIDSCENE_MODEL_BASE_URL") || missing.includes("MIDSCENE_MODEL_API_KEY")
        ? "\n\n提示：将 .env.example 复制为 .env 并填写配置："
        : "";

    const values = missing
      .map((key) => {
        const example = key.replace("MIDSCENE_MODEL_", "").toLowerCase();
        return `  ${key}=https://...  # 示例值请参考 .env.example`;
      })
      .join("\n");

    throw new Error(
      `[nl-script] 缺少必要的环境变量：\n${missing.map((k) => `  - ${k}`).join("\n")}${hint}\n${values}`,
    );
  }

  return {
    modelBaseUrl: process.env["MIDSCENE_MODEL_BASE_URL"]!,
    modelApiKey: process.env["MIDSCENE_MODEL_API_KEY"]!,
    modelName: process.env["MIDSCENE_MODEL_NAME"]!,
    modelFamily: process.env["MIDSCENE_MODEL_FAMILY"]!,
  };
}

export function checkOptionalEnvVars(): string[] {
  const warnings: string[] = [];

  if (!process.env["PW_TEST_SCREENSHOT_NO_FONTS_READY"]) {
    warnings.push("建议设置 PW_TEST_SCREENSHOT_NO_FONTS_READY=1 以避免截图字体缺失问题");
  }

  return warnings;
}
