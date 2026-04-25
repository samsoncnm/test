/**
 * ANSI 转义码过滤器
 * 移除用户输入中的终端控制字符（光标移动、颜色序列等）
 * 解决 Windows PowerShell 发送的光标移动 ANSI 序列（如 \e[D ← ←）被记录到 YAML 的问题
 */

// 逐字符拼接避免 Biome linter 报错（不允许正则中直接写控制字符）
const ESC = "\x1b";
const BEL = "\x07";

// C0 控制字符范围（0x00-0x1f）加上 DEL（0x7f）
const C0 = "[\x00-\x1f\x7f]";

const ANSI_PATTERN = new RegExp(
  [
    `${ESC}\\[[0-9;?]*[a-zA-Z]`, // CSI sequences: ESC [ ... X（光标移动、清除等）
    `${ESC}\\][^${BEL}]*(?:${BEL}|${ESC}\\\\)`, // OSC sequences: ESC ] ... BEL
    `${ESC}[()][AB012]`, // RIS / SCUS / SCKCUS / SSU
    `${ESC}[A-G]`, // Single-byte CSI-like
    C0, // C0 control characters
  ].join("|"),
  "g",
);

/**
 * 移除字符串中的所有 ANSI 转义序列和控制字符
 * @param str 原始字符串（可能包含 ANSI 序列）
 * @returns 清理后的字符串
 */
export function stripAnsi(str: string): string {
  return str.replace(ANSI_PATTERN, "");
}
