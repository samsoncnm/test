/**
 * Blueprint 暖白风格 HTML 模板
 * 暖白背景 + 时间线样式 + 稳定性分析卡
 */

import type { HistoryEntry, MetricsReport, StepMetrics } from "../../types/index.js";

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
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return iso;
  }
}

function renderTimelineItem(step: StepMetrics, idx: number, total: number): string {
  const n = idx + 1;
  const isFirst = idx === 0;
  const isLast = idx === total - 1;

  const statusColor =
    step.status === "finished"
      ? {
          dot: "var(--status-pass)",
          line: "var(--status-pass-bg)",
          text: "text-[var(--status-pass-text)]",
          bg: "bg-[var(--status-pass-bg)]",
          border: "border-[var(--status-pass-border)]",
        }
      : step.status === "failed"
        ? {
            dot: "var(--status-fail)",
            line: "var(--status-fail-bg)",
            text: "text-[var(--status-fail-text)]",
            bg: "bg-[var(--status-fail-bg)]",
            border: "border-[var(--status-fail-border)]",
          }
        : {
            dot: "var(--status-skip)",
            line: "var(--status-skip-bg)",
            text: "text-[var(--status-skip-text)]",
            bg: "bg-[var(--status-skip-bg)]",
            border: "border-[var(--status-skip-border)]",
          };

  const statusLabel =
    step.status === "finished"
      ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--status-pass-bg)] text-[var(--status-pass-text)] text-xs font-medium"><span class="w-1.5 h-1.5 rounded-full bg-[var(--status-pass)]"></span> 通过</span>`
      : step.status === "failed"
        ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--status-fail-bg)] text-[var(--status-fail-text)] text-xs font-medium"><span class="w-1.5 h-1.5 rounded-full bg-[var(--status-fail)]"></span> 失败</span>`
        : `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--status-skip-bg)] text-[var(--status-skip-text)] text-xs font-medium"><span class="w-1.5 h-1.5 rounded-full bg-[var(--status-skip)]"></span> 跳过</span>`;

  const icon =
    step.status === "finished"
      ? `<svg class="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>`
      : step.status === "failed"
        ? `<svg class="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>`
        : `<svg class="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4" /></svg>`;

  const borderColor =
    step.status === "failed"
      ? "border-[var(--status-fail-border)]"
      : step.status === "skipped" || step.status === "cancelled"
        ? "border-[var(--status-skip-border)]"
        : "border-[var(--border)]";

  const cardBg =
    step.status === "failed"
      ? "bg-[var(--status-fail-bg)]"
      : step.status === "skipped" || step.status === "cancelled"
        ? "bg-[var(--status-skip-bg)]"
        : "bg-[var(--bg-raised)]";

  return `
    <div class="flex gap-4">
      <!-- Timeline dot + line -->
      <div class="flex flex-col items-center">
        <div class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 z-10" style="background-color: ${statusColor.dot}">
          ${icon}
        </div>
        ${!isLast ? `<div class="w-0.5 flex-1 min-h-[80px]" style="background-color: ${statusColor.line}"></div>` : ""}
      </div>

      <!-- Card -->
      <div class="flex-1 pb-6">
        <div class="${cardBg} rounded-xl border ${borderColor} shadow-sm overflow-hidden">
          <div class="px-4 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between">
            <div class="flex items-center gap-3">
              <span class="text-xs text-[var(--text-muted)] font-mono">#${n}</span>
              ${statusLabel}
            </div>
            <div class="flex items-center gap-3 text-xs text-[var(--text-muted)]">
              ${step.wallTimeMs > 0 ? `<span>${formatDuration(step.wallTimeMs)}</span>` : ""}
              ${step.aiTimeMs > 0 ? `<span>AI: ${formatDuration(step.aiTimeMs)}</span>` : ""}
            </div>
          </div>
          <div class="p-4">
            <p class="text-sm font-medium text-[var(--text-primary)] mb-3">${escapeHtml(step.userInstruction)}</p>

            ${
              step.status === "failed"
                ? `
            <div class="bg-[var(--bg-raised)] rounded-lg border border-[var(--status-fail-border)] p-3 mb-3">
              ${
                step.errorMessage
                  ? `<p class="font-mono text-xs text-[var(--status-fail-text)]">${escapeHtml(step.errorType ?? "错误")}: ${escapeHtml(step.errorMessage)}</p>`
                  : `<p class="text-xs text-[var(--text-muted)] italic">无错误信息</p>`
              }
              ${step.errorStack ? `<details class="mt-2"><summary class="text-xs text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-secondary)]">堆栈跟踪</summary><pre class="mt-1 p-2 bg-[var(--bg-overlay)] rounded text-xs font-mono text-[var(--text-secondary)] overflow-x-auto max-h-32">${escapeHtml(step.errorStack)}</pre></details>` : ""}
            </div>`
                : ""
            }

            <div class="flex items-center gap-4 text-xs text-[var(--text-muted)]">
              ${step.subTasks > 0 ? `<span>${step.subTasks} 子任务</span>` : ""}
              ${step.usage?.totalTokens ? `<span>${step.usage.totalTokens.toLocaleString()} Token</span>` : ""}
              ${step.usage?.modelName ? `<span class="font-mono">${escapeHtml(step.usage.modelName)}</span>` : ""}
              ${step.hitByCache ? `<span class="text-[var(--status-skip-text)]">已缓存</span>` : ""}
              ${step.isAssert ? `<span class="text-[var(--brand)]">assert</span>` : ""}
            </div>

            ${
              step.screenshots?.length
                ? `
            <div class="mt-3">
              <img src="${escapeHtml(step.screenshots[step.screenshots.length - 1])}" alt="screenshot" class="w-full max-w-xs rounded-lg border border-[var(--border)]">
            </div>`
                : ""
            }
          </div>
        </div>
      </div>
    </div>`;
}

export function renderBlueprintReport(report: MetricsReport, history: HistoryEntry[]): string {
  const { summary } = report;
  const passRate =
    summary.totalSteps > 0 ? Math.round((summary.passCount / summary.totalSteps) * 100) : 0;

  const overallStatus = summary.failCount > 0 ? "失败" : "通过";
  const statusBg =
    summary.failCount > 0
      ? "bg-[var(--status-fail-bg)] text-[var(--status-fail-text)]"
      : "bg-[var(--status-pass-bg)] text-[var(--status-pass-text)]";

  const timelineHtml = report.steps
    .map((s, i) => renderTimelineItem(s, i, report.steps.length))
    .join("");

  // 稳定性分析
  const recent = history.slice(0, 10);
  const passRates = recent.map((h) => h.passRate);
  const avgPassRate =
    passRates.length > 0
      ? Math.round(passRates.reduce((a, b) => a + b, 0) / passRates.length)
      : passRate;
  const consecutiveFails = (() => {
    let count = 0;
    for (const h of recent) {
      if (h.status === "failed") count++;
      else break;
    }
    return count;
  })();

  const stabilityLevel = avgPassRate >= 90 ? "高" : avgPassRate >= 70 ? "中" : "低";
  const stabilityColor =
    avgPassRate >= 90
      ? {
          bg: "bg-[var(--status-pass-bg)]",
          border: "border-[var(--status-pass-border)]",
          text: "text-[var(--status-pass-text)]",
          dot: "bg-[var(--status-pass)]",
        }
      : avgPassRate >= 70
        ? {
            bg: "bg-[var(--status-skip-bg)]",
            border: "border-[var(--status-skip-border)]",
            text: "text-[var(--status-skip-text)]",
            dot: "bg-[var(--status-skip)]",
          }
        : {
            bg: "bg-[var(--status-fail-bg)]",
            border: "border-[var(--status-fail-border)]",
            text: "text-[var(--status-fail-text)]",
            dot: "bg-[var(--status-fail)]",
          };

  const historyRows =
    recent.length > 0
      ? recent
          .slice(0, 5)
          .map((h) => {
            const statusDot =
              h.status === "failed"
                ? `<span class="w-2 h-2 rounded-full bg-[var(--status-fail)] inline-block mr-2"></span>`
                : `<span class="w-2 h-2 rounded-full bg-[var(--status-pass)] inline-block mr-2"></span>`;
            return `
            <tr class="border-b border-[var(--border-subtle)]">
              <td class="px-4 py-2 text-xs text-[var(--text-muted)]">${formatDate(h.generatedAt)}</td>
              <td class="px-4 py-2 text-xs">${statusDot}<span class="${h.status === "failed" ? "text-[var(--status-fail-text)]" : "text-[var(--status-pass-text)]"}">${h.status === "failed" ? "失败" : "通过"}</span></td>
              <td class="px-4 py-2 text-xs font-mono text-right">${h.passRate}%</td>
              <td class="px-4 py-2 text-xs text-right text-[var(--text-muted)]">${formatDuration(h.durationMs)}</td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="4" class="px-4 py-3 text-xs text-[var(--text-muted)] italic text-center">暂无历史数据</td></tr>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(report.scriptName)} - 测试报告</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/lucide@latest"></script>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    /* ── Blueprint Warm Design Tokens ── */
    :root {
      /* Surface */
      --bg-base: #fafaf9;
      --bg-raised: #ffffff;
      --bg-overlay: #f5f5f4;
      --border: #e7e5e4;
      --border-subtle: rgba(231, 229, 228, 0.6);

      /* Text */
      --text-primary: #1c1917;
      --text-secondary: #78716c;
      --text-muted: #a8a29e;

      /* Semantic status */
      --status-pass: #22c55e;
      --status-pass-bg: rgba(34, 197, 94, 0.08);
      --status-pass-text: #15803d;
      --status-pass-border: #bbf7d0;
      --status-fail: #ef4444;
      --status-fail-bg: rgba(239, 68, 68, 0.08);
      --status-fail-text: #b91c1c;
      --status-fail-border: #fecaca;
      --status-skip: #f59e0b;
      --status-skip-bg: rgba(245, 158, 11, 0.08);
      --status-skip-text: #b45309;
      --status-skip-border: #fde68a;

      /* Brand accent (Sky blue) */
      --brand: #0ea5e9;
      --brand-muted: rgba(14, 165, 233, 0.12);

      /* Focus ring */
      --focus-ring: 0 0 0 2px #0ea5e9;
    }

    * { box-sizing: border-box; }
    body { font-family: 'IBM Plex Sans', system-ui, sans-serif; background: var(--bg-base); color: var(--text-primary); }
    .font-mono { font-family: 'IBM Plex Mono', ui-monospace, monospace; }
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: var(--bg-overlay); }
    ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
    *:focus-visible { outline: none; box-shadow: var(--focus-ring); border-radius: 3px; }
  </style>
</head>
<body class="min-h-screen">

  <!-- Header -->
  <header class="bg-[var(--bg-raised)] border-b border-[var(--border)] px-6 py-4">
    <div class="max-w-5xl mx-auto flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-lg flex items-center justify-center" style="background-color: ${summary.failCount > 0 ? "var(--status-fail)" : "var(--status-pass)"}">
          ${
            summary.failCount > 0
              ? `<svg class="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>`
              : `<svg class="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>`
          }
        </div>
        <div>
          <h1 class="text-lg font-semibold text-[var(--text-primary)]">${escapeHtml(report.scriptName)}</h1>
          <div class="text-xs text-[var(--text-muted)] mt-0.5">
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${statusBg} text-xs font-medium">${overallStatus}</span>
            <span class="ml-2">${formatDate(report.generatedAt)}</span>
          </div>
        </div>
      </div>
      <div class="text-xs text-[var(--text-muted)] font-mono">${escapeHtml(report.environment.sdkVersion)}</div>
    </div>
  </header>

  <main class="max-w-5xl mx-auto px-6 py-8">
    <!-- Summary Bar -->
    <div class="grid grid-cols-5 gap-3 mb-8">
      <div class="bg-[var(--bg-raised)] rounded-xl border border-[var(--border)] p-4 text-center shadow-sm">
        <div class="text-2xl font-bold text-[var(--text-primary)] font-mono">${summary.totalSteps}</div>
        <div class="text-xs text-[var(--text-muted)] mt-1">总步骤</div>
      </div>
      <div class="bg-[var(--bg-raised)] rounded-xl border border-[var(--border)] p-4 text-center shadow-sm">
        <div class="text-2xl font-bold text-[var(--status-pass)] font-mono">${summary.passCount}</div>
        <div class="text-xs text-[var(--text-muted)] mt-1">通过</div>
      </div>
      <div class="bg-[var(--bg-raised)] rounded-xl border border-[var(--border)] p-4 text-center shadow-sm">
        <div class="text-2xl font-bold text-[var(--status-fail)] font-mono">${summary.failCount}</div>
        <div class="text-xs text-[var(--text-muted)] mt-1">失败</div>
      </div>
      <div class="bg-[var(--bg-raised)] rounded-xl border border-[var(--border)] p-4 text-center shadow-sm">
        <div class="text-2xl font-bold text-[var(--status-skip)] font-mono">${summary.skipCount}</div>
        <div class="text-xs text-[var(--text-muted)] mt-1">跳过</div>
      </div>
      <div class="bg-[var(--bg-raised)] rounded-xl border border-[var(--border)] p-4 text-center shadow-sm">
        <div class="text-2xl font-bold text-[var(--text-primary)] font-mono">${msToSec(summary.totalWallTimeMs)}s</div>
        <div class="text-xs text-[var(--text-muted)] mt-1">耗时</div>
      </div>
    </div>

    <!-- Two column layout -->
    <div class="grid grid-cols-3 gap-6">
      <!-- Main: Timeline -->
      <div class="col-span-2">
        <h2 class="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-4">执行时间线</h2>
        <div class="bg-[var(--bg-raised)] rounded-2xl border border-[var(--border)] shadow-sm p-6">
          ${timelineHtml}
        </div>
      </div>

      <!-- Sidebar -->
      <div class="space-y-6">
        <!-- Token Summary -->
        <div class="bg-[var(--bg-raised)] rounded-xl border border-[var(--border)] shadow-sm p-4">
          <h3 class="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">Token 消耗</h3>
          <div class="space-y-2">
            <div class="flex justify-between text-sm">
              <span class="text-[var(--text-secondary)]">总计</span>
              <span class="font-mono font-medium">${summary.totalTokens.toLocaleString()}</span>
            </div>
            <div class="flex justify-between text-sm">
              <span class="text-[var(--text-secondary)]">缓存</span>
              <span class="font-mono font-medium">${summary.totalCachedTokens.toLocaleString()}</span>
            </div>
            <div class="flex justify-between text-sm">
              <span class="text-[var(--text-secondary)]">AI 耗时</span>
              <span class="font-mono font-medium">${msToSec(summary.totalAiTimeMs)}s</span>
            </div>
            ${
              summary.modelBreakdown[0]
                ? `
            <div class="pt-2 border-t border-[var(--border)]">
              <div class="text-xs text-[var(--text-muted)] mb-1">模型</div>
              <div class="font-mono text-sm font-medium">${escapeHtml(summary.modelBreakdown[0].modelName)}</div>
            </div>`
                : ""
            }
          </div>
        </div>

        <!-- Stability Analysis -->
        <div class="${stabilityColor.bg} rounded-xl border ${stabilityColor.border} shadow-sm p-4">
          <h3 class="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">稳定性分析</h3>
          <div class="flex items-center gap-2 mb-3">
            <span class="w-3 h-3 rounded-full ${stabilityColor.dot}"></span>
            <span class="text-sm font-semibold ${stabilityColor.text}">${stabilityLevel} 稳定性</span>
          </div>
          <div class="space-y-2 text-xs text-[var(--text-secondary)]">
            <div class="flex justify-between">
              <span>平均通过率</span>
              <span class="font-mono font-medium">${avgPassRate}%</span>
            </div>
            ${
              consecutiveFails > 0
                ? `
            <div class="flex justify-between">
              <span>连续失败</span>
              <span class="font-mono font-medium text-[var(--status-fail)]">${consecutiveFails}</span>
            </div>`
                : ""
            }
          </div>
        </div>

        <!-- History -->
        <div class="bg-[var(--bg-raised)] rounded-xl border border-[var(--border)] shadow-sm overflow-hidden">
          <div class="px-4 py-3 border-b border-[var(--border-subtle)]">
            <h3 class="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">最近运行</h3>
          </div>
          <table class="w-full">
            <tbody>
              ${historyRows}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </main>

  <footer class="border-t border-[var(--border)] px-6 py-4 mt-8">
    <div class="max-w-5xl mx-auto flex items-center justify-between text-xs text-[var(--text-muted)]">
      <span>Generated by Midscene AI</span>
      <span class="font-mono">${escapeHtml(report.environment.sdkVersion)}</span>
    </div>
  </footer>

  <script>
    lucide.createIcons();
  </script>
</body>
</html>`;
}
