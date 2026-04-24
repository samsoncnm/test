/**
 * Midscene 模型配置读取
 * 优先级：环境变量 > dotenv（.env 文件）
 *
 * 多模型支持：
 * - 主模型（视觉定位）：MIDSCENE_MODEL_* 必填
 * - Planning 模型（规划决策）：MIDSCENE_PLANNING_MODEL_* 可选
 * - Insight 模型（页面理解）：MIDSCENE_INSIGHT_MODEL_* 可选
 *
 * 已在 .env 中配置 PLANNING/INSIGHT 模型时，
 * 系统会自动将对应环境变量注入 Midscene 进程，完成多模型注入。
 */
import { config as dotenvConfig } from "dotenv";
dotenvConfig();
const REQUIRED_ENV_VARS = [
    "MIDSCENE_MODEL_BASE_URL",
    "MIDSCENE_MODEL_API_KEY",
    "MIDSCENE_MODEL_NAME",
    "MIDSCENE_MODEL_FAMILY",
];
function readModelConfig(prefix) {
    const baseUrl = process.env[`${prefix}_BASE_URL`];
    const apiKey = process.env[`${prefix}_API_KEY`];
    const name = process.env[`${prefix}_NAME`];
    const family = process.env[`${prefix}_FAMILY`];
    if (!baseUrl || !apiKey || !name || !family) {
        return undefined;
    }
    return {
        modelBaseUrl: baseUrl,
        modelApiKey: apiKey,
        modelName: name,
        modelFamily: family,
    };
}
/**
 * 注入模型环境变量到 process.env
 * Midscene 通过 process.env 读取模型配置，
 * 将 PLANNING/INSIGHT 配置映射为 Midscene 期望的环境变量名。
 */
function injectModelEnvVar(prefix, config) {
    process.env[`MIDSCENE_${prefix}_MODEL_BASE_URL`] = config.modelBaseUrl;
    process.env[`MIDSCENE_${prefix}_MODEL_API_KEY`] = config.modelApiKey;
    process.env[`MIDSCENE_${prefix}_MODEL_NAME`] = config.modelName;
    process.env[`MIDSCENE_${prefix}_MODEL_FAMILY`] = config.modelFamily;
}
export function getMidsceneConfig() {
    const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
    if (missing.length > 0) {
        const hint = missing.includes("MIDSCENE_MODEL_BASE_URL") || missing.includes("MIDSCENE_MODEL_API_KEY")
            ? "\n\n提示：将 .env.example 复制为 .env 并填写配置："
            : "";
        const values = missing
            .map((key) => {
            const example = key.replace("MIDSCENE_MODEL_", "").toLowerCase();
            return `  ${key}=https://...  # 示例值请参考 .env.example`;
        })
            .join("\n");
        throw new Error(`[nl-script] 缺少必要的环境变量：\n${missing.map((k) => `  - ${k}`).join("\n")}${hint}\n${values}`);
    }
    const defaultConfig = {
        modelBaseUrl: process.env["MIDSCENE_MODEL_BASE_URL"],
        modelApiKey: process.env["MIDSCENE_MODEL_API_KEY"],
        modelName: process.env["MIDSCENE_MODEL_NAME"],
        modelFamily: process.env["MIDSCENE_MODEL_FAMILY"],
    };
    const planningConfig = readModelConfig("MIDSCENE_PLANNING_MODEL");
    const insightConfig = readModelConfig("MIDSCENE_INSIGHT_MODEL");
    if (planningConfig) {
        injectModelEnvVar("PLANNING", planningConfig);
    }
    if (insightConfig) {
        injectModelEnvVar("INSIGHT", insightConfig);
    }
    return {
        default: defaultConfig,
        planning: planningConfig,
        insight: insightConfig,
    };
}
export function checkOptionalEnvVars() {
    const warnings = [];
    if (!process.env["PW_TEST_SCREENSHOT_NO_FONTS_READY"]) {
        warnings.push("建议设置 PW_TEST_SCREENSHOT_NO_FONTS_READY=1 以避免截图字体缺失问题");
    }
    return warnings;
}
