/**
 * Linear 深色风格 HTML 模板
 * 侧边导航 + 全屏深色 + 可折叠步骤行 + 模型详情卡
 */

import type { HistoryEntry, MetricsReport, StepMetrics } from "../../types/index.js";

// ── 工具函数 ─────────────────────────────────────────────────────────────────

function msToSec(ms: number): string {
  return (ms / 1000).toFixed(1);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function tokensToStr(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function escapeHtml(s: string | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return iso;
  }
}

// ── 步骤渲染 ─────────────────────────────────────────────────────────────────

function renderStepItem(step: StepMetrics, idx: number): string {
  const n = idx + 1;
  const statusIcon =
    step.status === "finished"
      ? `<i data-lucide="check" class="w-4 h-4 text-[#26de81]"></i>`
      : step.status === "failed"
        ? `<i data-lucide="x" class="w-4 h-4 text-[#f93e3e]"></i>`
        : `<i data-lucide="minus" class="w-4 h-4 text-[#6b7280]"></i>`;

  const statusBadge =
    step.status === "finished"
      ? `<span class="px-2 py-0.5 bg-[var(--status-pass-bg)] text-[var(--status-pass)] text-xs font-medium rounded">已完成</span>`
      : step.status === "failed"
        ? `<span class="px-2 py-0.5 bg-[var(--status-fail-bg)] text-[var(--status-fail)] text-xs font-medium rounded">失败</span>`
        : `<span class="px-2 py-0.5 bg-[var(--status-skip-bg)] text-[var(--status-skip)] text-xs font-medium rounded">跳过</span>`;

  const stepClass =
    step.status === "failed"
      ? "step-failed"
      : step.status === "skipped" || step.status === "cancelled"
        ? "step-unknown"
        : "step-finished";

  const isClickable = step.status !== "failed";
  const clickAttr = isClickable ? 'onclick="toggleStep(this)"' : "";
  const timeClass = step.status === "failed" ? "text-[#f93e3e]" : "";

  let details = "";
  if (step.status === "failed") {
    const errMsg = step.errorMessage
      ? `<div class="font-mono text-xs text-[#f93e3e] bg-black/30 rounded-lg p-3 border border-[#f93e3e]/20">${escapeHtml(step.errorType ?? "错误")}: ${escapeHtml(step.errorMessage)}</div>`
      : "";
    const screenshot = step.screenshots?.length
      ? `<img src="${escapeHtml(step.screenshots[step.screenshots.length - 1])}" alt="screenshot" class="w-full rounded-lg border border-white/10">`
      : "";
    details = `
      <div class="mt-4 ml-12">
        ${errMsg}
        ${screenshot ? `<div class="mt-3">${screenshot}</div>` : ""}
      </div>`;
  } else if (step.status !== "skipped" && step.status !== "cancelled") {
    const tokens = step.usage?.totalTokens;
    const model = step.usage?.modelName;
    details = `
      <div class="collapse-content">
        <div class="mt-4 ml-12 grid grid-cols-3 gap-4 text-xs">
          <div class="bg-black/20 rounded-lg p-3">
            <div class="text-[#6b7280] mb-1">子任务</div>
            <div class="text-white font-medium">${step.subTasks}</div>
          </div>
          <div class="bg-black/20 rounded-lg p-3">
            <div class="text-[#6b7280] mb-1">Token</div>
            <div class="text-white font-medium">${tokens ? tokens.toLocaleString() : "--"}</div>
          </div>
          <div class="bg-black/20 rounded-lg p-3">
            <div class="text-[#6b7280] mb-1">模型</div>
            <div class="text-white font-medium truncate">${model ?? "--"}</div>
          </div>
        </div>
      </div>`;
  } else {
    details = `<div class="collapse-content"><div class="mt-4 ml-12 text-xs text-[#6b7280]">因前置步骤失败，此步骤未执行</div></div>`;
  }

  return `
    <div class="step-item ${stepClass} p-4 border-b border-[#27272a] cursor-pointer" ${clickAttr}>
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-4">
          <div class="w-8 h-8 rounded-full ${step.status === "finished" ? "bg-[#26de81]/20" : step.status === "failed" ? "bg-[#f93e3e]/20" : "bg-[#6b7280]/20"} flex items-center justify-center shrink-0">
            ${statusIcon}
          </div>
          <div>
            <div class="flex items-center gap-2 mb-1">
              <span class="text-xs text-[#6b7280]">第 ${n} 步</span>
              ${statusBadge}
            </div>
            <p class="text-sm text-white">${escapeHtml(step.userInstruction)}</p>
          </div>
        </div>
        <div class="text-right shrink-0 ml-4">
          <div class="text-sm font-medium ${timeClass}">${step.wallTimeMs > 0 ? formatDuration(step.wallTimeMs) : "-"}</div>
          <div class="text-xs text-[#6b7280]">${step.aiTimeMs > 0 ? `${formatDuration(step.aiTimeMs)} AI` : "--"}</div>
        </div>
      </div>
      ${details}
    </div>`;
}

// ── 主渲染函数 ────────────────────────────────────────────────────────────────

export function renderLinearReport(report: MetricsReport, history: HistoryEntry[]): string {
  const { summary } = report;
  const passRate =
    summary.totalSteps > 0 ? Math.round((summary.passCount / summary.totalSteps) * 100) : 0;
  const statusBadge =
    summary.failCount > 0
      ? `<span class="px-3 py-1 bg-[var(--status-fail-bg)] text-[var(--status-fail)] text-xs font-medium rounded-full">失败</span>`
      : `<span class="px-3 py-1 bg-[var(--status-pass-bg)] text-[var(--status-pass)] text-xs font-medium rounded-full">通过</span>`;

  const cacheRate =
    summary.totalTokens > 0
      ? Math.round((summary.totalCachedTokens / summary.totalTokens) * 100)
      : 0;

  const stepsHtml = report.steps.map((s, i) => renderStepItem(s, i)).join("");

  // 历史对比卡片
  const recent = history.slice(0, 3).reverse();
  const historyCards =
    recent.length > 0
      ? recent
          .map((h, i) => {
            const isCurrent = i === 0;
            const borderColor = h.status === "failed" ? "var(--status-fail)" : "var(--status-pass)";
            const icon =
              h.status === "failed"
                ? `<i data-lucide="x-circle" class="w-5 h-5 text-[var(--status-fail)]"></i>`
                : `<i data-lucide="check-circle-2" class="w-5 h-5 text-[var(--status-pass)]"></i>`;
            const label = isCurrent ? "当前" : "历史";
            const labelColor =
              h.status === "failed"
                ? "bg-[var(--status-fail-bg)] text-[var(--status-fail)]"
                : "bg-[var(--status-pass-bg)] text-[var(--status-pass)]";
            return `
            <div class="history-run ${isCurrent ? "current" : "passed"} bg-[var(--bg-raised)] rounded-xl p-4" style="border: 2px solid ${borderColor}; ${isCurrent ? "box-shadow: 0 0 0 2px var(--status-fail-bg)" : ""}">
              <div class="flex items-center justify-between mb-3">
                <span class="text-xs text-[var(--text-muted)]">${formatDate(h.generatedAt)}</span>
                ${isCurrent ? `<span class="px-2 py-0.5 ${h.status === "failed" ? "bg-[var(--status-fail-bg)] text-[var(--status-fail)]" : "bg-[var(--status-pass-bg)] text-[var(--status-pass)]"} text-xs rounded font-medium">${label}</span>` : ""}
              </div>
              <div class="flex items-center gap-2 mb-3">${icon}<span class="text-xl font-semibold ${h.status === "failed" ? "text-[var(--status-fail)]" : "text-[var(--status-pass)]"}">${h.status === "failed" ? "失败" : "通过"}</span></div>
              <div class="text-xs text-[var(--text-muted)]"><div>${h.passCount}/${h.passCount + h.failCount + h.skipCount} 通过</div></div>
            </div>`;
          })
          .join("")
      : `<div class="text-sm text-[#6b7280] italic">暂无历史数据</div>`;

  // 模型详情
  const modelCards = summary.modelBreakdown
    .map(
      (m) => `
      <div class="bg-[#18181b] rounded-xl border border-[#27272a] p-4">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 bg-[#5e6ad2]/20 rounded-xl flex items-center justify-center">
            <i data-lucide="brain" class="w-6 h-6 text-[#5e6ad2]"></i>
          </div>
          <div class="flex-1">
            <div class="font-medium">${escapeHtml(m.modelName)}</div>
            <div class="text-sm text-[#6b7280]">意图: ${escapeHtml(m.intent)} · ${m.steps} 步</div>
          </div>
          <div class="text-right">
            <div class="text-xl font-bold">${tokensToStr(m.totalTokens)}</div>
            <div class="text-xs text-[#6b7280]">总 Token</div>
          </div>
        </div>
      </div>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>回归测试报告 - ${escapeHtml(report.scriptName)}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/lucide@latest"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    /* ── Design Tokens (Linear dark theme) ── */
    :root {
      --bg-base: #09090b;
      --bg-raised: #18181b;
      --bg-overlay: #1f1f23;
      --border: #27272a;
      --border-subtle: rgba(39, 39, 42, 0.5);

      --text-primary: #ffffff;
      --text-secondary: #a1a1aa;
      --text-muted: #6b7280;

      --status-pass: #26de81;
      --status-pass-bg: rgba(38, 222, 129, 0.12);
      --status-fail: #f93e3e;
      --status-fail-bg: rgba(249, 62, 62, 0.12);
      --status-skip: #6b7280;
      --status-skip-bg: rgba(107, 114, 128, 0.12);

      --brand: #5e6ad2;
      --brand-muted: rgba(94, 106, 210, 0.15);

      --focus-ring: 0 0 0 2px #5e6ad2;
    }

    * { box-sizing: border-box; }
    body { font-family: 'Inter', system-ui, sans-serif; background: var(--bg-base); color: var(--text-primary); }
    .step-item:hover { background-color: var(--bg-overlay); }
    .step-failed { background-color: var(--status-fail-bg); border-left: 3px solid var(--status-fail); }
    .step-unknown { background-color: var(--status-skip-bg); border-left: 3px solid var(--status-skip); }
    .step-finished { border-left: 3px solid transparent; }
    .collapse-content { max-height: 0; overflow: hidden; transition: max-height 0.3s ease-out; }
    .collapse-content.open { max-height: 600px; }
    .history-run.current { border: 2px solid var(--status-fail); box-shadow: 0 0 0 2px var(--status-fail-bg); }
    .history-run.passed { border: 1px solid var(--status-pass); }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: var(--bg-raised); }
    ::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: #52525b; }
    *:focus-visible { outline: none; box-shadow: var(--focus-ring); border-radius: 3px; }
  </style>
</head>
<body class="min-h-screen">
  <div class="flex h-screen overflow-hidden">
    <!-- Sidebar -->
    <aside class="w-56 bg-[#18181b] border-r border-[#27272a] flex flex-col shrink-0">
      <div class="p-4 border-b border-[#27272a]">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 bg-[#5e6ad2] rounded-lg flex items-center justify-center">
            <i data-lucide="play" class="w-4 h-4 text-white"></i>
          </div>
          <span class="font-semibold text-sm">回归测试</span>
        </div>
      </div>
      <nav class="flex-1 p-2">
        <a href="#" class="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#1f1f23] text-white text-sm mb-1">
          <i data-lucide="file-text" class="w-4 h-4"></i> 当前报告
        </a>
        <a href="#" class="flex items-center gap-3 px-3 py-2 rounded-lg text-[#6b7280] text-sm hover:bg-[#1f1f23] hover:text-white transition-colors mb-1">
          <i data-lucide="clock" class="w-4 h-4"></i> 历史记录
        </a>
      </nav>
      <div class="p-4 border-t border-[#27272a]">
        <div class="text-xs text-[#6b7280]">
          <div class="font-medium text-white mb-1">${escapeHtml(report.environment.sdkVersion)}</div>
          <div>${formatDate(report.generatedAt)}</div>
        </div>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="flex-1 overflow-y-auto">
      <div class="max-w-5xl mx-auto p-8">
        <!-- Header -->
        <header class="mb-8">
          <div class="flex items-center justify-between mb-2">
            <h1 class="text-2xl font-semibold">${escapeHtml(report.scriptName)}</h1>
            ${statusBadge}
          </div>
          <div class="flex items-center gap-4 text-sm text-[#6b7280]">
            <span class="flex items-center gap-1"><i data-lucide="calendar" class="w-4 h-4"></i> ${formatDate(report.generatedAt)}</span>
          </div>
        </header>

        <!-- Summary Cards -->
        <section class="grid grid-cols-4 gap-4 mb-8">
          <div class="bg-[#18181b] rounded-xl p-5 border border-[#27272a]">
            <div class="flex items-center justify-between mb-3">
              <span class="text-[#6b7280] text-sm">通过率</span>
              <i data-lucide="percent" class="w-4 h-4 text-[#6b7280]"></i>
            </div>
            <div class="text-3xl font-bold text-[#f7c948]">${passRate}%</div>
            <div class="text-xs text-[#6b7280] mt-1">${summary.passCount} / ${summary.totalSteps} 步骤通过</div>
          </div>
          <div class="bg-[#18181b] rounded-xl p-5 border border-[#27272a]">
            <div class="flex items-center justify-between mb-3">
              <span class="text-[#6b7280] text-sm">总耗时</span>
              <i data-lucide="clock" class="w-4 h-4 text-[#6b7280]"></i>
            </div>
            <div class="text-3xl font-bold">${msToSec(summary.totalWallTimeMs)}s</div>
            <div class="text-xs text-[#6b7280] mt-1">wall time</div>
          </div>
          <div class="bg-[#18181b] rounded-xl p-5 border border-[#27272a]">
            <div class="flex items-center justify-between mb-3">
              <span class="text-[#6b7280] text-sm">Token 消耗</span>
              <i data-lucide="cpu" class="w-4 h-4 text-[#6b7280]"></i>
            </div>
            <div class="text-3xl font-bold">${tokensToStr(summary.totalTokens)}</div>
            <div class="text-xs text-[#6b7280] mt-1">${summary.modelBreakdown[0]?.modelName ?? ""}</div>
          </div>
          <div class="bg-[#18181b] rounded-xl p-5 border border-[#27272a]">
            <div class="flex items-center justify-between mb-3">
              <span class="text-[#6b7280] text-sm">缓存命中率</span>
              <i data-lucide="database" class="w-4 h-4 text-[#6b7280]"></i>
            </div>
            <div class="text-3xl font-bold text-[#6b7280]">${cacheRate}%</div>
            <div class="text-xs text-[#6b7280] mt-1">${summary.hitByCacheCount} 次缓存命中</div>
          </div>
        </section>

        <!-- Failed Step Alert -->
        ${report.steps
          .filter((s) => s.status === "failed")
          .map((s) => {
            const idx = report.steps.indexOf(s);
            return `
        <section class="mb-8">
          <div class="bg-[#3f0d0d] rounded-xl border border-[#7f1d1d] overflow-hidden">
            <div class="p-4 border-b border-[#7f1d1d]/50 flex items-center justify-between">
              <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-full bg-[#f93e3e]/20 flex items-center justify-center">
                  <i data-lucide="alert-circle" class="w-4 h-4 text-[#f93e3e]"></i>
                </div>
                <div>
                  <h3 class="font-medium text-[#f93e3e]">第 ${idx + 1} 步失败</h3>
                  <p class="text-sm text-white/80">${escapeHtml(s.userInstruction)}</p>
                </div>
              </div>
              <span class="px-3 py-1 bg-[#f93e3e] text-white text-xs font-medium rounded-full">失败</span>
            </div>
            <div class="p-4">
              ${s.errorMessage ? `<div class="mb-4"><div class="text-xs text-white/50 uppercase tracking-wider mb-2">错误</div><div class="font-mono text-sm text-white/90 bg-black/30 rounded-lg p-3 border border-white/5">${escapeHtml(s.errorType ?? "错误")}: ${escapeHtml(s.errorMessage)}</div></div>` : ""}
              ${s.screenshots?.length ? `<div><div class="text-xs text-white/50 uppercase tracking-wider mb-2">截图</div><div class="rounded-lg overflow-hidden border border-white/10"><img src="${escapeHtml(s.screenshots[s.screenshots.length - 1])}" alt="screenshot" class="w-full"></div></div>` : ""}
            </div>
          </div>
        </section>`;
          })
          .join("")}

        <!-- Steps Timeline -->
        <section class="mb-8">
          <h2 class="text-lg font-semibold mb-4">执行步骤</h2>
          <div class="bg-[#18181b] rounded-xl border border-[#27272a] overflow-hidden">
            ${stepsHtml}
          </div>
        </section>

        <!-- History -->
        <section class="mb-8">
          <h2 class="text-lg font-semibold mb-4">执行历史</h2>
          <div class="grid grid-cols-3 gap-4">${historyCards}</div>
        </section>

        <!-- Model Details -->
        ${
          modelCards
            ? `
        <section class="mb-8">
          <h2 class="text-lg font-semibold mb-4">模型使用</h2>
          <div class="space-y-3">${modelCards}</div>
        </section>`
            : ""
        }
      </div>
    </main>
  </div>

  <script>
    lucide.createIcons();
    function toggleStep(el) {
      const content = el.querySelector('.collapse-content');
      if (content) content.classList.toggle('open');
    }
  </script>
</body>
</html>`;
}
