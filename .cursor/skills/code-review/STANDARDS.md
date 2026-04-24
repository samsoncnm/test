# 项目编码规范

本项目的编码约束，code-review 时参照执行。

## 强制规则

### 中文输出
所有输出必须中文。`console.log` 内容、注释、文档、错误信息一律中文。

```typescript
// ✅ 正确
console.log(`[CLI] 重试: 开启`);

// ❌ 错误
console.log(`[CLI] Retry: enabled`);
```

### 错误处理
- `try/catch` 必须有有意义的处理，禁止空 `catch {}`
- 异步错误必须 `.catch()` 或 `try/catch`
- `process.exit(1)` 用于明确失败场景

```typescript
// ✅ 正确
try {
  const data = await fetchData();
} catch (err) {
  console.error(`[CLI] 数据获取失败: ${err.message}`);
  process.exit(1);
}

// ❌ 错误：吞掉错误
try { ... } catch {}
```

### 类型安全
- 非空断言 `!` 仅在**业务逻辑保证非空**时使用，禁止用来绕过类型检查
- `as` 类型断言必须附带说明注释

```typescript
// ✅ 正确：业务逻辑上 page 一定存在
const title = page!.title();

// ❌ 错误：掩盖了潜在的 null 问题
const title = (resp as any).data;
```

### Shell 命令
- 所有命令必须有超时
- Windows PowerShell 中使用 `cmd /c` 包装 `start /affinity` 等 cmd 内置命令

## 建议规则

### 命名
- CLI 选项用 kebab-case（`--max-retries`），代码中用 camelCase（`options.maxRetries`）
- 接口定义与实际传递的键名保持一致

### 脚本执行
- 临时文件执行后清理（`--save` 控制是否保留）
- `spawn` 在 Windows 上加 `shell: true`

## 输出格式规范

| 场景 | 格式 |
|------|------|
| 命令行日志前缀 | `[CLI]`、`[ScriptGenerator]`、`[executor]` |
| 成功标识 | ✓（可直接接中文描述） |
| 进度/状态 | 纯中文，不加 emoji |
| 错误输出 | `console.error(...)`，不用 `console.log` |

```typescript
// ✅ 正确
console.log(`[CLI] 重试: 开启（最多 ${maxRetries} 次）`);
console.log(`✓ 脚本已生成`);

// ❌ 错误
console.log("[CLI] Retrying...");
console.error("error: " + err.message); // 冒号多余
```

## 禁止模式

| 禁止写法 | 正确写法 | 原因 |
|---------|---------|------|
| `try {} catch {}` | `catch (err) { console.error(...); process.exit(1); }` | 吞掉所有错误 |
| `console.log("debug: " + val)` | 直接删除调试输出，或用日志框架 | 调试输出未清理 |
| `options['cache-id']` | `options.cacheId` | Commander 将 kebab 转为 camelCase |
| 无超时的 shell 命令 | 所有命令加 `block_until_ms` 或 `timeout` | 可能永久阻塞 |
