---
name: code-review
description: 对代码变更进行结构化 review，发现 bug、安全隐患和可维护性问题。触发时机：用户请求 review、审查 PR、提交代码检查，或修改代码后自我检查。
---

# Code Review

## 触发时机

- 用户说"review"、"审查"、"检查这段代码"、"帮我看看这个 PR"
- 修改代码后自我检查
- 提交前检查

## 核心检查维度

按以下 5 个维度逐一检查，每个维度给出结论。

| 维度 | 检查什么 |
|------|---------|
| **正确性** | 逻辑是否正确，边界条件是否处理，错误是否被吞掉 |
| **安全性** | 注入风险、凭证泄露、路径遍历、不安全依赖 |
| **性能** | N+1 查询、内存泄漏、同步阻塞、不必要的循环 |
| **可维护性** | 重复代码、过长函数、魔法数字、缺乏注释的关键逻辑 |
| **项目一致性** | 是否符合本项目编码规范（TypeScript、非空断言慎用、console 输出规范） |

## 反馈格式

每条意见标注严重级别：

- 🔴 **必须修复**：逻辑 bug、安全漏洞、会导致运行时错误
- 🟡 **建议修改**：可维护性问题、性能隐患、违反项目规范
- 🟢 **可以更好**：重构建议、代码风格优化

若没有问题，直接说"代码检查通过，无问题"。

## 快速检查清单

### 正确性
- [ ] 函数返回值是否全部被处理（特别是 `async` 函数）
- [ ] 错误是否被 `catch` 且有有意义的处理（不是空 `catch {}`）
- [ ] 边界条件：`length === 0`、`null`、`undefined` 是否处理
- [ ] 类型断言（`as`）是否有业务含义支撑，不是为了绕过类型检查

### 安全性
- [ ] 没有硬编码凭证、密钥、Token（搜 `password`、`secret`、`token`、`key`）
- [ ] 没有 `eval()`、`new Function()`、`innerHTML` 等危险操作
- [ ] 用户输入是否经过校验或转义

### 性能
- [ ] 没有在循环中调用异步操作（Promise.all 替代串行 await）
- [ ] 没有不必要的 `JSON.parse`/`JSON.stringify`
- [ ] 大数据集合操作是否用了流式处理

### 项目规范
- [ ] 新增 `console.log` 是否必要（调试用完后应删除）
- [ ] 异常输出用 `console.error`，不要用 `console.log`
- [ ] 中文输出（项目要求，见 CLAUDE.md）

## 审查流程

1. **理解改动**：先读 diff 全貌，搞清楚改了什么、为什么改
2. **逐文件检查**：按检查清单过每个修改的文件
3. **给出结论**：
   - 有问题 → 按 🔴🟡🟢 格式列出每条意见，附文件路径和行号
   - 无问题 → "代码检查通过，无问题"
4. **如果用户要求**，给出修复建议的代码片段

## 典型问题模式（TypeScript/Node.js）

```
// 🔴 危险：硬编码密钥
const token = "sk-xxx-xxx";

// 🔴 危险：吞掉错误
try { ... } catch {}

// 🔴 危险：循环中串行 await
for (const item of items) {
  await fetch(item); // 慢，应该 Promise.all
}

// 🟡 问题：空断言掩盖类型错误
const val = maybeNull!.property;

// 🟡 问题：魔法数字
await page.waitForTimeout(5000); // 应该用常量

// 🟡 问题：调试 console.log 未清理
console.log("debug:", val);

// 🟢 改进：Promise.all 并行
const results = await Promise.all(items.map(item => fetch(item)));
```

## 与 GitHub PR 集成

用户请求审查 PR 时：

1. 用 `gh pr view <pr-number> --json title,body,files` 了解 PR 概要
2. 用 `gh pr diff <pr-number>` 获取变更
3. 用 `gh api repos/{owner}/{repo}/pulls/{pr}/files` 获取文件列表
4. 按上方清单审查
5. 用 `gh pr comment <pr-number> --body "..."` 提交 review 意见
