#!/usr/bin/env bash
# check-no-real-data.sh — commit 前防護：阻擋真實財務資料誤入公開倉庫
# 啟用方式（只需執行一次）：git config core.hooksPath hooks

set -e

staged=$(git diff --cached --name-only)
blocked=0

for f in $staged; do
  base=$(basename "$f")

  # 規則 1：檔名看起來像真實資料檔（ledger.json / config.json / estimator_*.json），
  #         但不在 sample-data/ 目錄，且檔名不含 .sample.
  if [[ "$base" =~ ^(ledger|config|estimator_.*|wage_reverse_.*|loan_.*)\.json$ ]] && [[ "$f" != sample-data/* ]] && [[ "$base" != *.sample.* ]]; then
    echo "❌ 偵測到疑似真實資料檔案：$f"
    echo "   此檔名格式應只存在於私密倉庫，不應出現在公開倉庫中。"
    blocked=1
  fi

  # 規則 2：檔案內容含資料欄位關鍵字，但不在 sample-data/ 目錄
  if [[ -f "$f" ]] && [[ "$f" != sample-data/* ]]; then
    if grep -q '"amountCents"' "$f" 2>/dev/null; then
      echo "❌ 偵測到疑似真實財務資料內容（含 amountCents 欄位）：$f"
      blocked=1
    fi
  fi
done

if [[ $blocked -eq 1 ]]; then
  echo ""
  echo "此次 commit 已被阻擋。如為誤判，請確認檔案內容後再次嘗試，"
  echo "或使用 git commit --no-verify 強制略過（不建議）。"
  exit 1
fi

exit 0
