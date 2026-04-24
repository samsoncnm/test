---
来源: llms-full.txt (12627行) + 更新日志 v0.1 ~ v1.7
快照日期: 2026-04-25
用途: Midscene 开发速查手册，后续开发必须优先参考本文件，禁止凭记忆编造 API
当前版本: v1.7.x
---

# Midscene 开发速查指南

## 1. 核心概念：两类操作模式

| 模式 | API | 模型职责 | 特点 |
|------|-----|---------|------|
| **自动规划 (Auto Planning)** | `agent.aiAct()` / `agent.ai()` | 规划 + 定位 + 执行 | 智能，支持复合指令，模型自动拆步骤 |
| **即时操作 (Instant Action)** | `aiTap`, `aiInput`, `aiHover`, `aiScroll`, `aiKeyboardPress`, `aiClearInput`, `aiDoubleClick`, `aiRightClick`, `aiLongPress`, `aiPinch` | 仅定位 | 快速、可靠，你明确知道要做什么时用 |

> **关键机制**：`aiAct` 内部使用 AI 模型将指令拆解为多个步骤（Planning），然后逐步执行。最大 replanning 循环次数默认 20 次（UI-TARS 40 次）。

## 2. API 速查表

### 2.1 交互方法

```typescript
// ===== 自动规划 =====
await agent.aiAct('在搜索框中输入 "Headphones"，点击搜索按钮');  // 复合指令
await agent.ai('点击登录按钮');  // 简写

// 高级选项
await agent.aiAct('填写注册表单', {
  deepThink: true,        // 深度思考，适合复杂表单
  deepLocate: true,       // 深度定位，复杂界面下提升准确率
  cacheable: true,        // 启用缓存
  abortSignal: controller.signal,  // 超时控制
});

// ===== 即时操作 =====
await agent.aiTap('登录按钮');
await agent.aiTap('提交按钮', { xpath: '//button[@id="submit"]' }); // 支持 xpath 精确定位
await agent.aiInput('testrole', '用户名输入框');
await agent.aiInput('内容', '输入框', { append: true }); // 追加输入
await agent.aiClearInput('搜索框');
await agent.aiHover('头像');
await agent.aiScroll({ scrollType: 'untilBottom' }, '列表区域');
await agent.aiKeyboardPress('Enter');
await agent.aiDoubleClick('文件名');
await agent.aiRightClick('联系人'); // 右键菜单
await agent.aiLongPress('图标');    // 长按
await agent.aiPinch({ scale: 2 }); // 双指放大
```

### 2.2 数据提取方法

```typescript
// 结构化查询
const items = await agent.aiQuery<{title: string, price: number}[]>(
  '获取商品标题和价格'
);

// 含 DOM 信息（提取 UI 不可见属性如 href、data-id）
const data = await agent.aiQuery('获取链接地址', { domIncluded: true });

// 简单类型提取
const exists = await agent.aiBoolean('页面是否有登录按钮');
const count = await agent.aiNumber('购物车商品数量');
const title = await agent.aiString('页面标题是什么');

// 元素定位
const loc = await agent.aiLocate('搜索框');

// 自由问答
const answer = await agent.aiAsk('这个页面是做什么用的');
```

### 2.3 断言 & 等待

```typescript
// 断言（失败会抛错）
await agent.aiAssert('页面显示登录成功');

// 等待条件满足
await agent.aiWaitFor('搜索结果已加载', { timeoutMs: 5000 });
```

### 2.4 报告 & 调试

```typescript
// 记录自定义截图到报告
await agent.recordToReport('登录页面', { content: '描述信息' });

// 获取执行过程数据
const logContent = agent._unstableLogContent();
```

## 3. Playwright 集成（本项目主要方式）

### 3.1 直接脚本方式

```typescript
import { chromium } from 'playwright';
import { PlaywrightAgent } from '@midscene/web/playwright';
import 'dotenv/config';

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
await page.goto('https://target-site.com');

const agent = new PlaywrightAgent(page, {
  aiActContext: '如果出现弹窗，先关闭',  // 全局上下文提示
  // modelConfig: { ... },             // 可选：代码内配置模型
});

await agent.aiAct('执行操作');
await browser.close();
```

### 3.2 Playwright Test 集成方式

**fixture.ts**:
```typescript
import { test as base } from '@playwright/test';
import type { PlayWrightAiFixtureType } from '@midscene/web/playwright';
import { PlaywrightAiFixture } from '@midscene/web/playwright';

export const test = base.extend<PlayWrightAiFixtureType>(
  PlaywrightAiFixture({ waitForNetworkIdleTimeout: 2000 })
);
```

**测试用例**:
```typescript
import { test } from './fixture';

test('示例', async ({ ai, aiQuery, aiAssert, aiInput, aiTap, aiWaitFor, recordToReport }) => {
  await aiInput('关键词', '搜索框');
  await aiTap('搜索按钮');
  await aiWaitFor('结果已加载');
  const items = await aiQuery<{title: string}[]>('获取搜索结果');
  await aiAssert('有搜索结果');
});
```

**playwright.config.ts**:
```typescript
export default defineConfig({
  testDir: './e2e',
  timeout: 90 * 1000,
  reporter: [["list"], ["@midscene/web/playwright-reporter", { type: "merged" }]],
});
```

## 4. 模型配置

### 4.1 环境变量方式（.env 文件）

```bash
# 基础配置（所有意图共用）
MIDSCENE_MODEL_NAME=qwen3-vl-plus
MIDSCENE_MODEL_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
MIDSCENE_MODEL_API_KEY=sk-xxx
MIDSCENE_MODEL_FAMILY=qwen3-vl

# 可选：为不同意图配置不同模型
MIDSCENE_PLANNING_MODEL_NAME=gpt-5.1        # 规划用更强模型
MIDSCENE_PLANNING_MODEL_API_KEY=sk-xxx
MIDSCENE_INSIGHT_MODEL_NAME=qwen-vl-plus     # 洞察/定位用快模型
```

### 4.2 本项目当前配置（.env）

```
MIDSCENE_MODEL_NAME=qwen3-vl-plus
MIDSCENE_MODEL_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
MIDSCENE_MODEL_API_KEY=sk-705cf18e...
MIDSCENE_MODEL_FAMILY=qwen3-vl

DEEPSEEK_API_KEY=sk-c093234c...
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL_NAME=deepseek-v4-flash
```

### 4.3 已适配的模型（v1.7）

| 模型 | family 值 | 特点 |
|------|-----------|------|
| **Qwen3-VL / Qwen3.5 / Qwen3.6** | `qwen3-vl` | 支持 deepThink，有开源版本可私有化 |
| **GPT-5 / GPT-5.4** | `gpt-5` | 强 Planning 能力 |
| **Doubao Seed 1.6 / 2.0** | `doubao-seed` | 支持 deepThink |
| **GLM-V** | 参见文档 | 智谱 AI 开源视觉模型 |
| **AutoGLM** | 参见文档 | 移动端自动化专用 |
| **UI-TARS** | `ui-tars` | Seed 团队开源 GUI agent 模型，replanning 上限 40 |

### 4.4 关键配置参数

```bash
MIDSCENE_REPLANNING_CYCLE_LIMIT=20       # aiAct 最大重规划次数
MIDSCENE_MODEL_REASONING_ENABLED=true    # 模型推理/深度思考开关
MIDSCENE_MODEL_REASONING_EFFORT=medium   # 推理强度
MIDSCENE_MODEL_EXTRA_BODY_JSON='{}'      # 额外请求参数
PW_TEST_SCREENSHOT_NO_FONTS_READY=1      # 解决字体等待超时
```

## 5. 构造器通用参数速查

```typescript
new PlaywrightAgent(page, {
  generateReport: true,          // 生成报告
  reportFileName: 'my-report',   // 报告文件名
  aiActContext: '背景知识',       // 全局上下文
  cacheId: 'login-cache',        // 缓存 ID
  replanningCycleLimit: 20,      // 重规划上限
  waitAfterAction: 300,          // 每步后等待 ms
  screenshotShrinkFactor: 1,     // 截图缩放比（移动端可设 2）
  forceSameTabNavigation: true,  // 拦截新标签页（默认 true）
  modelConfig: { ... },         // 代码内模型配置
  outputFormat: 'single-html',  // 报告格式
});
```

## 6. YAML 脚本方式

Midscene 原生支持 YAML 脚本自动化，无需自建编排层：

```yaml
# 通过 CLI 运行
# npx midscene run script.yaml

target:
  url: https://example.com
tasks:
  - aiAct: '在搜索框中输入 Headphones'
  - aiAct: '点击搜索按钮'
  - aiWaitFor: '搜索结果已加载'
  - aiQuery:
      prompt: '获取商品列表'
      output: items
```

CLI 命令：
```bash
npx @midscene/cli --headed --url https://example.com --action "操作描述"
npx @midscene/cli --url https://example.com --query-output result.json --query "提取数据"
```

## 7. 缓存机制

```typescript
// 启用缓存
const agent = new PlaywrightAgent(page, {
  cacheId: 'my-flow',  // 设置后自动启用
});

// 单个 API 控制缓存
await agent.aiTap('按钮', { cacheable: false }); // 本次不缓存
```

缓存模式（环境变量）：
- `MIDSCENE_CACHE=true` — 启用读写缓存
- 支持 read-only / write-only / read-write 策略

## 8. 自定义动作（扩展 Action Space）

```typescript
import { getMidsceneLocationSchema, z } from '@midscene/core';
import { defineAction } from '@midscene/core/device';

const MyAction = defineAction({
  name: 'myAction',
  description: '自定义动作描述',
  paramSchema: z.object({
    locate: getMidsceneLocationSchema(),
    // 更多参数...
  }),
  async call(param) {
    // 实现逻辑
  },
});

const agent = new PlaywrightAgent(page, {
  customActions: [MyAction],
});
```

## 9. 超时配置

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `waitForNetworkIdleTimeout` | 2000ms | 操作后等待网络空闲 |
| `waitForNavigationTimeout` | 5000ms | 页面跳转等待 |
| `waitAfterAction` | 300ms | 每步操作后等待 |
| `replanningCycleLimit` | 20 | aiAct 最大重规划次数 |
| Playwright `timeout` | 建议 90s | 测试整体超时 |

## 10. 版本重要变更摘要

| 版本 | 关键变更 |
|------|---------|
| **v1.7** | 报告文件解析 + Qwen 3.6 适配 |
| **v1.6** | CDP 连接模式 + 双指缩放 + GPT-5/5.4 |
| **v1.5** | 鸿蒙支持 + Qwen3.5 + doubao-seed 2.0 |
| **v1.4** | Skills 技能包（Claude Code 集成）+ 桌面 MCP |
| **v1.3** | PC 桌面自动化 + deepThink 增强规划 |
| **v1.2** | GLM-V + AutoGLM + 文件上传 |
| **v1.1** | aiAct deepThink + MCP SDK 开放 |
| **v1.0** | 纯视觉路线 + 多模型组合 + MCP 重构 + aiAct 改名 |
| **v0.28** | 与任意界面集成 |
| **v0.16** | MCP 支持 |
| **v0.15** | Android 自动化 |
| **v0.13** | Instant Action API + deepThink |

### API 改名记录（向后兼容）

| 旧名 | 新名 | 版本 |
|------|------|------|
| `aiAction()` | `aiAct()` | v1.0 |
| `logScreenshot()` | `recordToReport()` | v1.0 |
| `OPENAI_API_KEY` | `MIDSCENE_MODEL_API_KEY` | v1.0 |
| `OPENAI_BASE_URL` | `MIDSCENE_MODEL_BASE_URL` | v1.0 |
| `deepThink`（定位参数） | `deepLocate` | v1.6 |
| `aiActionContext` | `aiActContext` | v1.0+ |

## 11. 常见问题速查

| 问题 | 解决方案 |
|------|---------|
| 浏览器界面闪动 | 设置 `deviceScaleFactor` 匹配 `window.devicePixelRatio` |
| 截图字体等待超时 | `PW_TEST_SCREENSHOT_NO_FONTS_READY=1` |
| aiAct 复合指令失败 | 尝试 `deepThink: true`，或拆为多条 Instant Action |
| 文件上传 | `aiTap('上传按钮', { fileChooserAccept: '/path/to/file' })` |
| 新标签页处理 | 设置 `forceSameTabNavigation: false`，需为新标签页新建 Agent |
| Windows 下 export 不可用 | 使用 `.env` 文件 + `dotenv/config`，或 `$env:VAR="value"` |
| 大报告加载慢 | 使用 `outputFormat: 'html-and-external-assets'` |
