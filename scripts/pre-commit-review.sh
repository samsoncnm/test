#!/bin/sh
# ============================================================
# pre-commit hook - 自动 code review
# 触发时机：每次 git commit 前
# 退出码：0 = 允许提交，1 = 拒绝提交
# ============================================================

# ============================================================
# 配置区
# ============================================================
SKIP_VAR="${SKIP_REVIEW:-}"

# ============================================================
# 颜色输出（Git Bash / MSYS 支持）
# ============================================================
color_on() {
  printf '\033[0;31m'
}
color_yellow() {
  printf '\033[0;33m'
}
color_green() {
  printf '\033[0;32m'
}
color_bold() {
  printf '\033[1m'
}
color_reset() {
  printf '\033[0m'
}

# 带颜色的 echo（兼容无颜色终端）
cecho() {
  # 用法：cecho RED "text"
  local color="$1"
  shift
  case "$color" in
    RED)    [ -t 1 ] && color_on || color= ;;
    YELLOW) [ -t 1 ] && color_yellow || color= ;;
    GREEN)  [ -t 1 ] && color_green || color= ;;
    BOLD)   [ -t 1 ] && color_bold || color= ;;
  esac
  printf '%s' "$color"
  printf '%s\n' "$*"
  [ -t 1 ] && color_reset
}

# ============================================================
# 工具函数
# ============================================================

# 获取 staged 文件列表（排除已删除的文件）
get_staged_files() {
  git diff --cached --name-only --diff-filter=ACMR
}

# 获取单个文件的 staged diff
get_file_diff() {
  git diff --cached -- "$1"
}

# ============================================================
# 检查函数（返回 0 = 通过，返回 1 = 有问题）
# ============================================================

# ---- RED 检查：必须修复 ----

# 1. 硬编码凭证 / Token / API Key
check_hardcoded_secrets() {
  local diff="$1"
  printf '%s' "$diff" | grep -E \
    '(sk-[a-zA-Z0-9]{20,}|token\s*[:=]\s*["'"'"'][a-zA-Z0-9_-]{20,}|password\s*[:=]\s*["'"'"'][^"'"'"'\s]{8,}|secret\s*[:=]\s*["'"'"'][^"'"'"'\s]{8,}|api[_-]?key\s*[:=]\s*["'"'"'][^"'"'"'\s]{10,}|bearer\s+[a-zA-Z0-9_-]{20,})' \
    >/dev/null 2>&1 && return 1
  return 0
}

# 2. 危险函数：eval / new Function / innerHTML / document.write
check_evil_functions() {
  local diff="$1"
  printf '%s' "$diff" | grep -E \
    '(eval\s*\(|new\s+Function\s*\(|innerHTML\s*=|document\.write\s*\(|outerHTML\s*=)' \
    >/dev/null 2>&1 && return 1
  return 0
}

# 3. 空 catch 块
check_empty_catch() {
  local diff="$1"
  printf '%s' "$diff" | grep -E 'catch\s*\(\w*\)\s*\{\s*\}' \
    >/dev/null 2>&1 && return 1
  return 0
}

# 4. SQL 注入风险
check_sql_injection() {
  local diff="$1"
  printf '%s' "$diff" | grep -E \
    '(`.*\$\{|"\s*\+\s*|'"'"'\s*\+\s*).*(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)' \
    >/dev/null 2>&1 && return 1
  return 0
}

# ---- YELLOW 检查：建议修改 ----

# 5. console.log 未清理
check_console_log() {
  local diff="$1"
  printf '%s' "$diff" | grep -E '^\+.*console\.log\s*\(' >/dev/null 2>&1 && return 1
  return 0
}

# 6. 魔法数字
check_magic_numbers() {
  local diff="$1"
  printf '%s' "$diff" | grep -E \
    '(waitForTimeout\s*\(\s*[0-9]{4,}\s*\)|sleep\s*\(\s*[0-9]{4,}\s*\))' \
    >/dev/null 2>&1 && return 1
  return 0
}

# ---- GREEN 检查：可以更好 ----

# 7. 循环中串行 await
check_await_in_loop() {
  local diff="$1"
  printf '%s' "$diff" | grep -E \
    'for\s*\([^)]*\)\s*\{[^}]*await\s+[a-zA-Z]' \
    >/dev/null 2>&1 && return 1
  return 0
}

# ============================================================
# 主审查流程
# ============================================================

run_review() {
  cecho BOLD "==========================================="
  cecho BOLD "[pre-commit-review] 开始代码审查"
  cecho BOLD "==========================================="
  echo ""

  # 跳过检查
  if [ -n "$SKIP_VAR" ]; then
    cecho YELLOW "[pre-commit-review] SKIP_REVIEW=1 已设置，跳过审查"
    exit 0
  fi

  # 无 staged 内容
  if ! git diff --cached --quiet 2>/dev/null; then
    :
  else
    cecho YELLOW "[pre-commit-review] 没有 staged 变更，跳过审查"
    exit 0
  fi

  staged_files=$(get_staged_files)
  if [ -z "$staged_files" ]; then
    cecho YELLOW "[pre-commit-review] 没有 staged 文件"
    exit 0
  fi

  # 统计
  total_red=0
  total_yellow=0
  total_green=0
  has_red=0

  file_count=$(printf '%s\n' $staged_files | wc -l | tr -d ' ')
  cecho BOLD "审查文件：$file_count 个"
  echo ""
  printf '%-12s %-12s %-36s %s\n' "级别" "维度" "文件" "问题"
  echo "----------------------------------------------------------------------------------"

  for file in $staged_files; do
    # 跳过二进制文件、lock 文件、hook 脚本自身
    case "$file" in
      *.lock|*.min.js|*.min.css|*.svg|*.png|*.jpg|*.jpeg|*.gif|*.ico|*.pdf|*.woff|*.woff2|*.ttf)
        continue
        ;;
      scripts/pre-commit-review.sh|.git/hooks/pre-commit)
        continue
        ;;
    esac

    diff_content=$(get_file_diff "$file")
    [ -z "$diff_content" ] && continue

    # ---- RED 检查 ----
    if ! check_hardcoded_secrets "$diff_content"; then
      total_red=$((total_red + 1)); has_red=1
      cecho RED "[RED]  安全性   $file  硬编码凭证 / Token / API Key"
    fi

    if ! check_evil_functions "$diff_content"; then
      total_red=$((total_red + 1)); has_red=1
      cecho RED "[RED]  安全性   $file  危险函数: eval / new Function / innerHTML / document.write"
    fi

    if ! check_empty_catch "$diff_content"; then
      total_red=$((total_red + 1)); has_red=1
      cecho RED "[RED]  正确性   $file  空 catch 块（吞掉错误）"
    fi

    if ! check_sql_injection "$diff_content"; then
      total_red=$((total_red + 1)); has_red=1
      cecho RED "[RED]  安全性   $file  SQL 注入风险: 字符串拼接 SQL 语句"
    fi

    # ---- YELLOW 检查 ----
    if ! check_console_log "$diff_content"; then
      total_yellow=$((total_yellow + 1))
      cecho YELLOW "[YELLOW] 可维护性 $file  新增 console.log（调试代码完成后应删除）"
    fi

    if ! check_magic_numbers "$diff_content"; then
      total_yellow=$((total_yellow + 1))
      cecho YELLOW "[YELLOW] 可维护性 $file  魔法数字（建议提取为命名常量）"
    fi

    # ---- GREEN 检查 ----
    if ! check_await_in_loop "$diff_content"; then
      total_green=$((total_green + 1))
      cecho GREEN "[GREEN] 性能     $file  循环中串行 await（建议 Promise.all 并行）"
    fi
  done

  # ============================================================
  # 输出汇总
  # ============================================================
  echo ""
  cecho BOLD "==========================================="
  cecho BOLD "审查汇总"
  cecho BOLD "==========================================="
  [ $total_red -gt 0 ]    && cecho RED    "  RED    必须修复:   $total_red"
  [ $total_yellow -gt 0 ] && cecho YELLOW "  YELLOW 建议修改:   $total_yellow"
  [ $total_green -gt 0 ]  && cecho GREEN  "  GREEN  可以更好:   $total_green"
  echo ""

  if [ $has_red -eq 1 ]; then
    cecho RED "==========================================="
    cecho RED "[pre-commit-review] 提交被阻止 — 有 $total_red 个必须修复的问题"
    cecho RED "请修复后重新提交，或使用 SKIP_REVIEW=1 跳过（仅限紧急情况）"
    cecho RED "==========================================="
    exit 1
  fi

  if [ $total_yellow -gt 0 ]; then
    cecho YELLOW "[pre-commit-review] 警告：有 $total_yellow 个建议修改项（不阻塞提交）"
  fi

  cecho GREEN "==========================================="
  cecho GREEN "[pre-commit-review] 代码审查通过"
  cecho GREEN "==========================================="
  echo ""
  exit 0
}

run_review
