/**
 * Datadog 深色风格 HTML 模板
 * 聚焦失败诊断：自动展开失败步骤，展示前后上下文
 * 设计系统：CSS 变量 + Datadog 琥珀橙品牌色
 */

import type { HistoryEntry, MetricsReport, StepMetrics } from "../../types/index.js";

// ── 工具函数 ─────────────────────────────────────────────────────────────────

function msToSec(ms: number): string {
  return (ms / 1000).toFixed(2);
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
  }
  catch {
    return iso;
  }
}

// ── 步骤行渲染 ────────────────────────────────────────────────────────────────

function renderStepRow(
  step: StepMetrics,
  idx: number,
  isExpanded: boolean,
  prevStep: StepMetrics | null,
  nextStep: StepMetrics | null,
): string {
  const n = idx + 1;
  const statusBadge = renderStatusBadge(step.status);
  const rowClass =
    step.status === "failed"
      ? "bg-red-950/30 border-l-4 border-red-500"
      : step.status === "skipped" || step.status === "cancelled"
        ? "opacity-70"
        : "row-hover";
  const idxClass =
    step.status === "failed" ? "text-red-400 font-semibold" : "text-[var(--text-muted)]";
  const instrClass =
    step.status === "failed" ? "font-medium text-red-200" : "text-sm";
  const timeClass = step.status === "failed" ? "text-red-300" : "";
  const chevron = isExpanded
    ? `<i data-lucide="chevron-down" class="w-4 h-4 ${step.status === "failed" ? "text-red-400" : "text-[var(--text-muted)]"}"></i>`
    : `<i data-lucide="chevron-right" class="w-4 h-4 text-[var(--text-muted)]"></i>`;

  const actionTags = step.actions
    ? step.actions
        .slice(0, 3)
        .map(
          (a) =>
            `<span class="inline-block px-1.5 py-0.5 bg-[var(--brand-muted)] text-[var(--brand)] text-xs rounded mr-1">${escapeHtml(a.type)}</span>`,
        )
        .join("")
    : "";

  const cacheWarning = step.hitByCache
    ? `<span class="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 bg-yellow-500/20 text-yellow-300 text-xs rounded" title="使用了缓存 xpath，但元素可能已变化"><i data-lucide="cache" class="w-3 h-3"></i> 缓存</span>`
    : "";

  const assertMark = step.isAssert
    ? `<span class="ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 bg-purple-500/20 text-purple-300 text-xs rounded"><i data-lucide="flag" class="w-3 h-3"></i> 断言</span>`
    : "";

  const tokens = step.usage?.totalTokens;

  let html = `
    <tr class="${rowClass} cursor-pointer transition-colors" onclick="toggleRow(this)">
      <td class="px-3 py-2.5 mono text-xs ${idxClass}">${n}</td>
      <td class="px-3 py-2.5">${statusBadge}</td>
      <td class="px-3 py-2.5">
        <div class="flex flex-wrap items-center gap-1">
          <span class="${instrClass}">${escapeHtml(step.userInstruction)}</span>
          ${actionTags}
          ${cacheWarning}
          ${assertMark}
        </div>
      </td>
      <td class="px-3 py-2.5 text-right mono text-xs ${timeClass}">${step.wallTimeMs > 0 ? formatDuration(step.wallTimeMs) : "--"}</td>
      <td class="px-3 py-2.5 text-right mono text-xs text-[var(--text-muted)]">${step.aiTimeMs > 0 ? formatDuration(step.aiTimeMs) : "--"}</td>
      <td class="px-3 py-2.5 text-right mono text-xs text-[var(--text-muted)]">${step.subTasks}</td>
      <td class="px-3 py-2.5 text-right mono text-xs">${tokens ? tokensToStr(tokens) : "--"}</td>
      <td class="px-3 py-2.5 text-center">
        <button class="p-1 hover:${step.status === "failed" ? "bg-red-500/20" : "bg-[var(--border)]"} rounded transition-colors focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg-base)]">
          ${chevron}
        </button>
      </td>
    </tr>`;

  if (isExpanded) {
    html += renderExpandedRow(step, idx, prevStep, nextStep);
  }

  return html;
}

function renderStatusBadge(status: StepMetrics["status"]): string {
  switch (status) {
    case "finished":
      return `<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[var(--status-pass-bg)] text-[var(--status-pass)] text-xs font-medium"><i data-lucide="check" class="w-3 h-3"></i> 通过</span>`;
    case "failed":
      return `<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[var(--status-fail-bg)] text-[var(--status-fail)] text-xs font-medium border border-[var(--status-fail)]/40"><i data-lucide="x" class="w-3 h-3"></i> 失败</span>`;
    case "skipped":
    case "cancelled":
      return `<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[var(--status-skip-bg)] text-[var(--status-skip)] text-xs font-medium"><i data-lucide="minus" class="w-3 h-3"></i> 跳过</span>`;
    default:
      return `<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-gray-500/20 text-gray-400 text-xs font-medium"><i data-lucide="help-circle" class="w-3 h-3"></i> 未知</span>`;
  }
}

function renderExpandedRow(
  step: StepMetrics,
  idx: number,
  prevStep: StepMetrics | null,
  nextStep: StepMetrics | null,
): string {
  const screenshots = step.screenshots?.length
    ? step.screenshots
        .map(
          (s) =>
            `<img src="${escapeHtml(s)}" alt="screenshot" class="w-full rounded border border-[var(--border)] mb-2">`,
        )
        .join("")
    : '<div class="text-xs text-[var(--text-muted)] italic">无截图</div>';

  let errorDetails = "";
  if (step.status === "failed") {
    const errFull = step.errorMessage
      ? `<span class="text-[var(--status-fail)]">${escapeHtml(step.errorType ?? "Error")}: </span><span class="text-red-300">${escapeHtml(step.errorMessage)}</span>`
      : '<span class="text-[var(--text-muted)]">无错误信息</span>';

    let hitByCacheAlert = "";
    if (step.hitByCache) {
      hitByCacheAlert = `
        <div class="mt-2 flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded p-2 text-xs">
          <i data-lucide="alert-triangle" class="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5"></i>
          <div>
            <span class="text-yellow-300 font-medium">使用了缓存 xpath，元素可能已变化</span>
            <div class="text-[var(--text-secondary)] mt-0.5">建议重新运行一次，或手动检查目标元素是否存在</div>
          </div>
        </div>`;
    }

    const stackTrace = step.errorStack
      ? `<details class="mt-2"><summary class="text-xs text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-secondary)]">展开堆栈</summary><pre class="mt-1 p-2 bg-[var(--bg-base)] rounded text-xs mono text-[var(--text-secondary)] overflow-x-auto max-h-48">${escapeHtml(step.errorStack)}</pre></details>`
      : "";

    errorDetails = `
      <div>
        <div class="text-xs text-[var(--text-muted)] mb-1">错误详情</div>
        <div class="bg-[var(--bg-raised)] rounded p-3 border border-[var(--status-fail-bg)]">
          <div class="mono text-sm">${errFull}</div>
          ${hitByCacheAlert}
          ${stackTrace}
        </div>
      </div>`;
  }

  let prevContext = "";
  if (prevStep) {
    const prevSs = prevStep.screenshots?.length
      ? `<img src="${escapeHtml(prevStep.screenshots[prevStep.screenshots.length - 1])}" alt="prev screenshot" class="w-full rounded border border-[var(--border)]">`
      : '<div class="text-xs text-[var(--text-muted)] italic">无截图</div>';
    prevContext = `
      <div class="border-t border-dashed border-[var(--status-fail-bg)] pt-3 mt-3">
        <div class="text-xs text-[var(--status-fail)] mb-1 flex items-center gap-1"><i data-lucide="arrow-up" class="w-3 h-3"></i> 前置步骤 #${idx}</div>
        <div class="text-sm text-[var(--text-secondary)] mb-2">${escapeHtml(prevStep.userInstruction)}</div>
        <div class="text-xs text-[var(--text-muted)] mb-1">截图</div>
        ${prevSs}
      </div>`;
  }

  let nextContext = "";
  if (nextStep && (nextStep.status === "skipped" || nextStep.status === "cancelled")) {
    nextContext = `
      <div class="border-t border-dashed border-[var(--status-skip-bg)] pt-3 mt-3">
        <div class="text-xs text-[var(--status-skip)] mb-1 flex items-center gap-1"><i data-lucide="alert-triangle" class="w-3 h-3"></i> 因前置失败未执行</div>
        <div class="text-sm text-[var(--text-secondary)]">${escapeHtml(nextStep.userInstruction)}</div>
      </div>`;
  }

  return `
    <tr class="bg-[var(--bg-base)]">
      <td colspan="8" class="px-6 py-4">
        <div class="grid grid-cols-3 gap-4">
          <div class="col-span-2 space-y-3">
            ${errorDetails}
            ${prevContext}
            ${nextContext}
          </div>
          <div>
            <div class="text-xs text-[var(--text-muted)] mb-1">截图</div>
            ${screenshots}
          </div>
        </div>
      </td>
    </tr>`;
}

// ── 历史趋势渲染 ─────────────────────────────────────────────────────────────

function renderHistoryTrend(history: HistoryEntry[]): string {
  if (history.length === 0) {
    return `<div class="p-4 text-sm text-[var(--text-muted)] italic">暂无历史数据</div>`;
  }

  const maxPassRate = Math.max(...history.map((h) => h.passRate), 1);
  const barScale = 80 / maxPassRate;

  const bars = history
    .slice(0, 10)
    .reverse()
    .map((h, i) => {
      const barH = Math.max(4, h.passRate * barScale);
      const isCurrent = i === history.slice(0, 10).reverse().length - 1;
      const color = h.status === "failed" ? "bg-[var(--status-fail)]/80" : "bg-[var(--status-pass)]/80";
      const rateColor = h.status === "failed" ? "text-[var(--status-fail)]" : "text-[var(--status-pass)]";
      const currentMark = isCurrent
        ? `<div class="absolute -top-1 -right-1 w-2 h-2 bg-[var(--brand)] rounded-full"></div>`
        : "";
      return `
        <div class="flex flex-col items-center gap-1 flex-1">
          <div class="w-full flex flex-col items-center gap-0.5 relative">
            <div class="w-8 ${color} rounded-t sparkline-bar cursor-pointer" style="height: ${barH}px;"></div>
            ${currentMark}
          </div>
          <span class="text-xs text-[var(--text-muted)] mono ${isCurrent ? "text-[var(--brand)] font-bold" : ""}">#${history.length - i}</span>
          <span class="text-xs ${rateColor}">${h.passRate}%</span>
        </div>`;
    })
    .join("");

  const passRates = history.map((h) => h.passRate);
  const avgPassRate = Math.round(passRates.reduce((a, b) => a + b, 0) / passRates.length);
  const avgDuration = Math.round(
    history.reduce((a, h) => a + h.durationMs, 0) / history.length / 1000,
  );

  return `
    <div class="p-4">
      <div class="flex items-end justify-between gap-2 h-24">
        ${bars}
      </div>
      <div class="mt-4 pt-4 border-t border-[var(--border)] flex items-center justify-between text-xs text-[var(--text-muted)]">
        <div class="flex items-center gap-4">
          <span>平均通过率: <span class="text-[var(--status-pass)] mono font-medium">${avgPassRate}%</span></span>
          <span>平均耗时: <span class="mono font-medium">${avgDuration}s</span></span>
        </div>
      </div>
    </div>`;
}

// ── Token 分布渲染 ────────────────────────────────────────────────────────────

function renderTokenBreakdown(report: MetricsReport): string {
  const { summary } = report;
  const avgPerStep =
    summary.totalSteps > 0 ? Math.round(summary.totalTokens / summary.totalSteps) : 0;

  const steps = report.steps;
  const totalTokens = summary.totalTokens;

  const tokenBars =
    steps.length > 0
      ? steps
          .map((s) => {
            const pct = totalTokens > 0 ? ((s.usage?.totalTokens ?? 0) / totalTokens) * 100 : 0;
            let color = "bg-blue-500/70";
            if (s.status === "failed") color = "bg-[var(--status-fail)]/80";
            else if (s.status === "skipped" || s.status === "cancelled") color = "bg-[var(--status-skip-bg)]";
            return `<div class="${color} h-full" style="width: ${pct.toFixed(1)}%;" title="第 ${steps.indexOf(s) + 1} 步: ${s.usage?.totalTokens ?? 0} Token"></div>`;
          })
          .join("")
      : "";

  return `
    <div class="p-4">
      <div class="grid grid-cols-4 gap-4">
        <div class="bg-[var(--bg-base)] rounded p-3 border border-[var(--border)]">
          <div class="text-xs text-[var(--text-muted)] mb-1">总 Token</div>
          <div class="text-2xl font-bold mono text-[var(--text-primary)]">${summary.totalTokens.toLocaleString()}</div>
          <div class="text-xs text-[var(--text-muted)] mt-1">共 ${summary.totalSteps} 步</div>
        </div>
        <div class="bg-[var(--bg-base)] rounded p-3 border border-[var(--border)]">
          <div class="text-xs text-[var(--text-muted)] mb-1">缓存 Token</div>
          <div class="text-2xl font-bold mono text-[var(--text-muted)]">${summary.totalCachedTokens.toLocaleString()}</div>
          <div class="text-xs text-[var(--text-muted)] mt-1">${summary.totalCachedTokens > 0 ? `缓存率: ${Math.round((summary.totalCachedTokens / summary.totalTokens) * 100)}%` : "未使用缓存"}</div>
        </div>
        <div class="bg-[var(--bg-base)] rounded p-3 border border-[var(--border)]">
          <div class="text-xs text-[var(--text-muted)] mb-1">每步平均</div>
          <div class="text-2xl font-bold mono text-[var(--brand)]">${tokensToStr(avgPerStep)}</div>
          <div class="text-xs text-[var(--text-muted)] mt-1">Token/步</div>
        </div>
        <div class="bg-[var(--bg-base)] rounded p-3 border border-[var(--border)]">
          <div class="text-xs text-[var(--text-muted)] mb-1">模型</div>
          <div class="text-xl font-bold mono text-[var(--brand)]">${summary.modelBreakdown[0]?.modelName ?? "unknown"}</div>
          <div class="text-xs text-[var(--text-muted)] mt-1">${summary.modelBreakdown[0]?.intent ?? ""}</div>
        </div>
      </div>
      ${tokenBars ? `
      <div class="mt-4">
        <div class="flex items-center gap-2 mb-2">
          <span class="text-xs text-[var(--text-muted)]">各步骤 Token 分布</span>
        </div>
        <div class="h-8 bg-[var(--bg-base)] rounded overflow-hidden flex items-center">
          ${tokenBars}
        </div>
        <div class="flex justify-between mt-1 text-[10px] text-[var(--text-muted)] mono px-1">
          <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
        </div>
        <div class="flex justify-between mt-1 text-xs text-[var(--text-muted)]">
          <span class="flex items-center gap-1"><span class="w-2 h-2 rounded bg-blue-500/70"></span> 通过</span>
          <span class="flex items-center gap-1"><span class="w-2 h-2 rounded bg-[var(--status-fail)]/80"></span> 失败</span>
          <span class="flex items-center gap-1"><span class="w-2 h-2 rounded bg-[var(--status-skip-bg)]"></span> 跳过</span>
        </div>
      </div>` : ""}
    </div>`;
}

// ── Alert Panel 渲染 ────────────────────────────────────────────────────────────

function renderAlertPanel(report: MetricsReport): string {
  const failedStep = report.steps.find((s) => s.status === "failed");
  if (!failedStep) return "";

  const idx = report.steps.indexOf(failedStep);
  const errMsg = failedStep.errorMessage
    ? `<span class="text-red-300">${escapeHtml(failedStep.errorType ?? "错误")}: ${escapeHtml(failedStep.errorMessage)}</span>`
    : '<span class="text-[var(--text-secondary)]">无错误信息</span>';

  const hitByCacheAlert = failedStep.hitByCache
    ? `<div class="flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded p-2 mb-2 text-sm"><i data-lucide="alert-triangle" class="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5"></i><div><span class="text-yellow-300 font-medium">使用了缓存 xpath，元素可能已变化</span><div class="text-[var(--text-secondary)] text-xs mt-0.5">建议重新运行一次，或手动检查目标元素是否存在</div></div></div>`
    : "";

  const screenshot = failedStep.screenshots?.length
    ? `<img src="${escapeHtml(failedStep.screenshots[failedStep.screenshots.length - 1])}" alt="Failure screenshot" class="w-full h-44 object-cover rounded">`
    : `<div class="w-full h-44 bg-[var(--bg-base)] rounded border border-[var(--status-fail-bg)] flex items-center justify-center text-[var(--text-muted)] text-sm">无失败截图</div>`;

  return `
    <div class="bg-red-950/50 border-2 border-[var(--status-fail)]/80 rounded-lg alert-glow overflow-hidden">
      <div class="px-4 py-2 bg-[var(--status-fail-bg)] border-b border-[var(--status-fail)]/30 flex items-center gap-2">
        <div class="w-2 h-2 bg-[var(--status-fail)] rounded-full status-dot"></div>
        <span class="font-semibold text-[var(--status-fail)] text-sm uppercase tracking-wider">告警 - 第 ${idx + 1} 步失败</span>
      </div>
      <div class="p-4">
        <div class="flex gap-4">
          <div class="flex-1">
            <h3 class="text-lg font-semibold text-[var(--text-primary)] mb-2 flex items-center gap-2">
              <i data-lucide="x-circle" class="w-5 h-5 text-[var(--status-fail)]"></i>
              ${escapeHtml(failedStep.userInstruction)}
            </h3>
            ${hitByCacheAlert}
            <div class="bg-[var(--bg-base)]/60 rounded border border-[var(--status-fail-bg)] p-3 mb-3">
              <div class="flex items-start gap-2">
                <i data-lucide="alert-triangle" class="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0"></i>
                <div class="mono text-sm">${errMsg}</div>
              </div>
            </div>
          </div>
          <div class="w-80 flex-shrink-0">
            <div class="text-xs text-[var(--text-secondary)] mb-2 flex items-center gap-1.5">
              <i data-lucide="image" class="w-3 h-3"></i>
              <span>失败截图</span>
            </div>
            <div class="relative rounded overflow-hidden border border-[var(--status-fail-bg)]">
              ${screenshot}
              <div class="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent"></div>
              ${failedStep.absoluteStartTime ? `<div class="absolute bottom-2 left-2 flex items-center gap-1 text-xs text-white/80"><i data-lucide="clock" class="w-3 h-3"></i><span>${formatDate(new Date(failedStep.absoluteStartTime).toISOString())}</span></div>` : ""}
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

// ── 指标条渲染（分组增强）────────────────────────────────────────────────────

function renderMetricsBar(report: MetricsReport): string {
  const { summary } = report;
  const duration = msToSec(summary.totalWallTimeMs);
  const aiTime = msToSec(summary.totalAiTimeMs);
  const model = summary.modelBreakdown[0]?.modelName ?? "unknown";

  return `
    <div class="bg-[var(--bg-raised)]/80 border-b border-[var(--border)] px-4 py-3">
      <div class="flex items-center gap-6">
        <!-- 结果组 -->
        <div class="flex items-center gap-1 px-3 py-1.5 bg-[var(--brand-dim)] rounded-lg">
          <span class="text-[var(--brand)] text-xs uppercase tracking-wider font-medium mr-2">执行结果</span>
          <div class="flex items-center gap-1">
            <span class="text-[var(--text-secondary)] text-xs">总计</span>
            <span class="mono font-semibold text-lg text-[var(--text-primary)]">${summary.totalSteps}</span>
          </div>
          <div class="h-4 w-px bg-[var(--border)] mx-1"></div>
          <span class="text-[var(--status-pass)] mono font-semibold">${summary.passCount}</span>
          <span class="text-[var(--status-fail)] mono font-semibold">${summary.failCount}</span>
          <span class="text-[var(--status-skip)] mono font-semibold">${summary.skipCount}</span>
        </div>

        <!-- 分隔 -->
        <div class="h-5 w-px bg-[var(--border)]"></div>

        <!-- 性能组 -->
        <div class="flex items-center gap-4">
          <div class="flex items-center gap-1.5">
            <i data-lucide="clock" class="w-4 h-4 text-[var(--brand)]"></i>
            <span class="text-[var(--text-secondary)] text-xs">耗时:</span>
            <span class="mono font-medium text-sm">${duration}s</span>
          </div>
          <div class="flex items-center gap-1.5">
            <i data-lucide="cpu" class="w-4 h-4 text-[var(--brand)]"></i>
            <span class="text-[var(--text-secondary)] text-xs">AI:</span>
            <span class="mono font-medium text-sm">${aiTime}s</span>
          </div>
          <div class="flex items-center gap-1.5">
            <i data-lucide="coins" class="w-4 h-4 text-[var(--brand)]"></i>
            <span class="text-[var(--text-secondary)] text-xs">Tokens:</span>
            <span class="mono font-medium text-sm">${tokensToStr(summary.totalTokens)}</span>
          </div>
          <div class="flex items-center gap-1.5">
            <i data-lucide="zap" class="w-4 h-4 text-[var(--brand)]"></i>
            <span class="mono font-medium text-xs bg-[var(--brand-muted)] text-[var(--brand)] px-2 py-0.5 rounded">${escapeHtml(model)}</span>
          </div>
        </div>

        <div class="ml-auto flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <i data-lucide="calendar" class="w-3 h-3"></i>
          <span>${formatDate(report.generatedAt)}</span>
        </div>
      </div>
    </div>`;
}

// ── 步骤表格渲染 ─────────────────────────────────────────────────────────────

function renderStepsTable(report: MetricsReport): string {
  const { steps } = report;
  const failedIdx = steps.findIndex((s) => s.status === "failed");

  const rows = steps
    .map((step, i) => {
      const prev: StepMetrics | null = i > 0 ? steps[i - 1]! : null;
      const next: StepMetrics | null = i < steps.length - 1 ? steps[i + 1]! : null;
      return renderStepRow(step, i, i === failedIdx, prev, next);
    })
    .join("");

  return `
    <div class="bg-[var(--bg-raised)] rounded-lg border border-[var(--border)] overflow-hidden">
      <div class="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
        <div class="flex items-center gap-2">
          <i data-lucide="list" class="w-4 h-4 text-[var(--brand)]"></i>
          <span class="font-semibold text-sm">执行步骤</span>
        </div>
        <div class="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <i data-lucide="info" class="w-3 h-3"></i>
          <span>点击行展开详情</span>
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="bg-[var(--bg-base)]/50 text-[var(--text-secondary)] text-xs uppercase tracking-wider">
              <th class="px-3 py-2 text-left font-medium w-12">#</th>
              <th class="px-3 py-2 text-left font-medium w-24">状态</th>
              <th class="px-3 py-2 text-left font-medium">执行指令</th>
              <th class="px-3 py-2 text-right font-medium w-24">墙钟耗时</th>
              <th class="px-3 py-2 text-right font-medium w-24">AI 耗时</th>
              <th class="px-3 py-2 text-right font-medium w-20">子任务</th>
              <th class="px-3 py-2 text-right font-medium w-20">Token</th>
              <th class="px-3 py-2 text-center font-medium w-16">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[var(--border)]/50">
            ${rows}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ── 主渲染函数 ────────────────────────────────────────────────────────────────

export function renderDatadogReport(
  report: MetricsReport,
  history: HistoryEntry[],
): string {
  const alertPanel = report.summary.failCount > 0 ? renderAlertPanel(report) : "";

  return `<!DOCTYPE html>
<html lang="zh-CN" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>测试报告 - ${escapeHtml(report.scriptName)}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/lucide@latest"></script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

    /* ── Design Tokens ── */
    :root {
      /* Surface */
      --bg-base: #0f172a;
      --bg-raised: #1e293b;
      --border: #334155;
      --border-subtle: rgba(51, 65, 85, 0.5);

      /* Text */
      --text-primary: #f8fafc;
      --text-secondary: #94a3b8;
      --text-muted: #64748b;

      /* Semantic status */
      --status-pass: #4ade80;
      --status-pass-bg: rgba(74, 222, 128, 0.12);
      --status-fail: #f87171;
      --status-fail-bg: rgba(248, 113, 113, 0.15);
      --status-skip: #fbbf24;
      --status-skip-bg: rgba(251, 191, 36, 0.12);

      /* Brand (Datadog Amber) */
      --brand: #FBAA41;
      --brand-muted: rgba(251, 170, 65, 0.15);
      --brand-dim: rgba(251, 170, 65, 0.08);

      /* Focus ring */
      --focus-ring: 0 0 0 2px #FBAA41;
    }

    :root { font-family: 'Inter', system-ui, sans-serif; }
    body { background: var(--bg-base); color: var(--text-primary); }

    .mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }

    /* Scrollbar */
    .scrollbar-thin::-webkit-scrollbar { width: 6px; height: 6px; }
    .scrollbar-thin::-webkit-scrollbar-track { background: var(--bg-raised); }
    .scrollbar-thin::-webkit-scrollbar-thumb { background: #475569; border-radius: 3px; }
    .scrollbar-thin::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }

    /* Alert glow */
    .alert-glow { box-shadow: 0 0 20px var(--status-fail-bg), 0 0 40px rgba(239, 68, 68, 0.1); }

    /* Row hover */
    .row-hover:hover { background: var(--brand-dim); }

    /* Status dot pulse */
    .status-dot { animation: pulse 2s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

    /* Sparkline */
    .sparkline-bar:hover { filter: brightness(1.3); }

    /* Focus visible */
    *:focus-visible {
      outline: none;
      box-shadow: var(--focus-ring);
      border-radius: 3px;
    }
  </style>
</head>
<body class="min-h-screen scrollbar-thin">

  <!-- Top Toolbar -->
  <header class="bg-[var(--bg-raised)] border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
    <div class="flex items-center gap-4">
      <div class="flex items-center gap-2">
        <div class="w-8 h-8 bg-gradient-to-br from-[var(--brand)] to-orange-600 rounded-lg flex items-center justify-center">
          <i data-lucide="bot" class="w-5 h-5 text-white"></i>
        </div>
        <span class="font-semibold text-lg">测试报告</span>
      </div>
      <div class="h-6 w-px bg-[var(--border)]"></div>
      <div class="flex items-center gap-2">
        <span class="text-[var(--text-secondary)] text-sm">脚本:</span>
        <span class="font-medium px-3 py-1.5 bg-[var(--bg-base)] rounded border border-[var(--border)]">${escapeHtml(report.scriptName)}</span>
      </div>
    </div>
    <div class="flex items-center gap-3">
      <span class="text-xs text-[var(--text-muted)]">${escapeHtml(report.environment.sdkVersion)}</span>
    </div>
  </header>

  <!-- Metrics Bar -->
  ${renderMetricsBar(report)}

  <main class="p-4 space-y-4">
    <!-- Alert Panel -->
    ${alertPanel}

    <!-- Steps Table -->
    ${renderStepsTable(report)}

    <!-- History Trend -->
    <div class="bg-[var(--bg-raised)] rounded-lg border border-[var(--border)] overflow-hidden">
      <div class="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
        <div class="flex items-center gap-2">
          <i data-lucide="trending-up" class="w-4 h-4 text-[var(--brand)]"></i>
          <span class="font-semibold text-sm">执行历史</span>
        </div>
        <div class="flex items-center gap-4 text-xs text-[var(--text-muted)]">
          <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-[var(--status-pass)]"></span> 通过</span>
          <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-[var(--status-fail)]"></span> 失败</span>
          <span class="text-[#475569]">最近 ${Math.min(history.length, 10)} 次运行</span>
        </div>
      </div>
      ${renderHistoryTrend(history)}
    </div>

    <!-- Token Usage Breakdown -->
    <div class="bg-[var(--bg-raised)] rounded-lg border border-[var(--border)] overflow-hidden">
      <div class="px-4 py-3 border-b border-[var(--border)] flex items-center gap-2">
          <i data-lucide="bar-chart-2" class="w-4 h-4 text-[var(--brand)]"></i>
        <span class="font-semibold text-sm">Token 消耗明细</span>
      </div>
      ${renderTokenBreakdown(report)}
    </div>
  </main>

  <!-- Footer -->
  <footer class="bg-[var(--bg-raised)] border-t border-[var(--border)] px-4 py-3 flex items-center justify-between text-xs text-[var(--text-muted)]">
    <div class="flex items-center gap-4">
      <span class="flex items-center gap-1.5">
        <i data-lucide="bot" class="w-3 h-3 text-[var(--brand)]"></i>
        由 Midscene AI 生成
      </span>
      <span class="mono">${escapeHtml(report.environment.sdkVersion)}</span>
    </div>
    <div class="flex items-center gap-2">
      <span class="w-2 h-2 rounded-full bg-[var(--brand)]"></span>
      <span>Datadog 风格</span>
    </div>
  </footer>

  <script>
    lucide.createIcons();
    function toggleRow(btn) {
      var tr = btn.closest('tr');
      var next = tr.nextElementSibling;
      if (next && next.classList.contains('bg-[var(--bg-base)]')) {
        next.style.display = next.style.display === 'none' ? '' : 'none';
      }
    }
  </script>
</body>
</html>`;
}
