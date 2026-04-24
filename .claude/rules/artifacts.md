# 工件与迭代

> 核心：最小化成本，Git 追踪变化，简洁即可靠。

## 原则 7：迭代成本决定行为 (Iteration Cost Shapes Behavior)

- **最小化成本**：减少不必要的文件读写、避免大范围重写、优先增量修改
- **批处理优化**：多个独立操作合并为一次 shell 调用（如 `uv add a b c`）

## 原则 8：Git 即记忆与审计链 (Git as Memory)

- **Commit 先行**：每次变更在验证前 commit，支持零成本回滚
- **历史回读**：每次迭代开始前读取 `git log --oneline -10`，避免重复已 revert 的失败尝试
- **格式规范**：commit message 遵循 `experiment(<scope>): <一句话描述>`
- **Revert 优先**：失败时使用 `git revert HEAD` 而非 `git reset --hard`

## 原则 9：简洁即可靠 (Simplicity = Reliability)

> 代码不会因为"更复杂"而更好，只会因为"更简洁"而更可靠。

- **KISS 优先**：每新增一个抽象层必须问"不加这个能跑吗？"，答不上来就不加
- **over-engineering 信号**：嵌套超过 3 层、超过 5 个泛型参数、超过 200 行的函数 — 立即触发重构
- **迭代器优于手写循环**：`collect().iter().filter().map()` 链优于手动 push 循环 *(仅适用于 Rust 项目)*
- **早期返回优于深度嵌套**：提前 `return None`，减少嵌套分支
- **&str 优于 String**：`fn(&str)` 优于 `fn(String)`，避免不必要的 clone *(仅适用于 Rust 项目)*
- **约束不简化**：lazy_static、.context()、exit code 传播、fallback 命令等硬约束禁止"优化"掉 *(仅适用于 Rust 项目)*
- **验证命令**：`cargo fmt && cargo clippy && cargo test` — 任何代码变更后必须运行 *(仅适用于 Rust 项目；TS/Python 项目参照 CLAUDE.MD 规则 5)*

## 原则 10：依赖必须可复现 (Reproducible Dependencies)

- **Lock 文件优先**：依赖变更必须更新 lock 文件（`uv.lock` / `requirements-lock.txt`），禁止裸 `uv add` 不提交 lock
- **禁止直装**：`pip install <package>` 或 `cargo add <package>` 后必须验证 lock 文件变更
- **环境一致性**：每次迭代前检查 lock 文件是否与上次一致，有差异立即上报

## 原则 11：回滚链必须有收口 (Rollback Chain Closure)

> 状态机 revert 后必须明确收口，不能无限重试或不了了之。

- **最大重试上限**：revert 后重做最多 2 次；2 次失败后上报完整历史，附每步失败原因
- **失败报告模板**：路径 / 失败次数 / 每次失败原因 / 建议方向 — 缺一不可
- **禁止静默丢弃**：revert 后不得假装"已经修好了"，必须如实报告状态
