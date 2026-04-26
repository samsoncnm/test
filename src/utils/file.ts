/**
 * 文件系统工具函数
 */

import * as fs from "node:fs";
import * as path from "node:path";

/**
 * 确保目录存在（递归创建），若已存在则不操作
 */
export function ensureDirSync(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * 写入文件（自动创建父目录）
 */
export function writeFileSync(
  filePath: string,
  content: string,
  encoding: BufferEncoding = "utf-8",
): void {
  ensureDirSync(path.dirname(filePath));
  fs.writeFileSync(filePath, content, encoding);
}
