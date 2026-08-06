#!/usr/bin/env bash
# check-no-real-data.sh — commit 前防護：阻擋真實財務資料誤入公開倉庫
# 啟用方式（只需執行一次）：git config core.hooksPath hooks

set -e
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"
bash scripts/check-no-real-data.sh --staged
