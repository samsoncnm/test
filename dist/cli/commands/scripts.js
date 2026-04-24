/**
 * scripts 命令
 * 脚本管理：list / rm
 */
import { createInterface } from "node:readline";
import pc from "picocolors";
import { deleteScript, loadAllScripts } from "../../storage/script-store.js";
import { log, logSection } from "../../utils/logger.js";
const rl = createInterface({ input: process.stdin, output: process.stdout });
function prompt(question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => resolve(answer.trim()));
    });
}
export async function listScripts() {
    const scripts = await loadAllScripts();
    logSection("📋 脚本列表");
    if (scripts.length === 0) {
        log("warn", "暂无脚本，请先使用 explore 命令创建");
        return;
    }
    for (const script of scripts) {
        const created = new Date(script.createdAt).toLocaleDateString("zh-CN");
        const updated = script.updatedAt !== script.createdAt
            ? ` (更新: ${new Date(script.updatedAt).toLocaleDateString("zh-CN")})`
            : "";
        console.log(`  ${pc.cyan(pc.bold(script.name))} ${pc.gray(`- 创建于 ${created}${updated}`)}`);
        if (script.description) {
            console.log(`    ${script.description}`);
        }
        console.log(`    ${pc.dim(`路径: ${script.yamlPath}`)}`);
        console.log();
    }
}
export async function removeScript(name) {
    const confirm = await prompt(`确定要删除脚本 "${name}" 吗？(此操作不可撤销) [y/N]: `);
    if (confirm.toLowerCase() !== "y") {
        log("info", "已取消删除");
        rl.close();
        return;
    }
    const deleted = await deleteScript(name);
    if (!deleted) {
        log("error", `脚本 "${name}" 不存在`);
    }
    rl.close();
}
