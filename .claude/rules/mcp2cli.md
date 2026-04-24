# 系统验证与自动化 (mcp2cli)

> [!CODE] 前置校验
> 1. 校验 `mcp2cli --version`，若缺失则自动执行 `uv tool install mcp2cli`。
> 2. 校验 `mcp2cli` Skill 是否加载。
> 3. 校验 `PATH` 是否包含工具路径。

## 自动化规则

### 格式决策

- **统一对象数组**：强制使用 `--toon`（仅在扁平化场景下）。
- **深层嵌套**：优先使用 `JSON compact`。
- **纯表格**：使用 `CSV`。

### Token 优化

- `TOON` 调用必须配合 `--jq` 过滤字段。
- 大量数据默认追加 `--head 10`。
- 远程 spec 启用 `--cache-ttl 86400`。
