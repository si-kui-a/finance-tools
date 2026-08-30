#!/usr/bin/env node
// 資深懶散工程師機械複查——只找候選，不判斷對錯。
// 本repo是純前端靜態工具，沒有PAT編號式知識庫，不確定的做法先查
// README.md「計算方式與重要界線」一節，內部真的沒有才查外部。

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const LINE_THRESHOLD = 400;
const STALE_KEYWORDS = ["TODO", "FIXME", "暫時", "先這樣", "之後再"];
const EXCLUDE_DIRS = new Set([".git", "node_modules"]);

function walk(dir, exts) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (EXCLUDE_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full, exts));
    else if (exts.some((ext) => name.endsWith(ext))) out.push(full);
  }
  return out;
}

function findJsOutliers() {
  const files = walk(join(ROOT, "shared"), [".js"]);
  return files
    .map((f) => ({ file: f, lines: readFileSync(f, "utf-8").split("\n").length }))
    .filter((f) => f.lines > LINE_THRESHOLD)
    .sort((a, b) => b.lines - a.lines);
}

function findStaleKeywords() {
  const mdFiles = walk(ROOT, [".md"]);
  const hits = [];
  for (const file of mdFiles) {
    const lines = readFileSync(file, "utf-8").split("\n");
    lines.forEach((line, i) => {
      for (const kw of STALE_KEYWORDS) {
        if (line.includes(kw)) hits.push({ file, line: i + 1, kw, snippet: line.trim().slice(0, 80) });
      }
    });
  }
  return hits;
}

function checkUnmergedBranches() {
  console.log("\n=== 未merge分支健檢（2026-08-30新增，2026-08-30全repo分支殘留"
    + "清理後訂定；純唯讀，只列名單不做任何刪除/合併判斷——要不要處理"
    + "每次都要真人/AI實際讀內容才能決定，見同批新增的「全面收斂稽核」"
    + "章節）===");
  const defaultBranch = "main";
  const opts = { cwd: ROOT, encoding: "utf8", timeout: 30000 };
  try {
    execFileSync("git", ["fetch", "--all", "--prune"], opts);
  } catch { /* 網路不可用時仍嘗試用本機快取的refs繼續 */ }
  let names;
  try {
    const out = execFileSync("git", ["branch", "-r", "--no-merged", `origin/${defaultBranch}`], opts);
    names = out.split("\n").map((l) => l.trim()).filter((l) => l && !l.includes("->"));
  } catch (e) {
    console.log(`  （檢查失敗，可能不在git repo或git不可用：${e.message}）`);
    return;
  }
  if (!names.length) {
    console.log("  （無未merge分支）");
    return;
  }
  for (const name of names) {
    const short = name.replace(/^origin\//, "");
    let count = "?";
    try {
      count = execFileSync("git", ["rev-list", "--count", `origin/${defaultBranch}..${name}`], opts).trim();
    } catch { /* 忽略單一分支查詢失敗，繼續處理其他分支 */ }
    console.log(`  ${short}：領先${count}個commit，未merge`);
  }
  console.log(`  共${names.length}個——是否要救回內容或直接刪除，逐一核對實際`
    + `commit內容才能判斷，不能只憑分支名稱/存在天數猜測`);
}

function main() {
  console.log("=== shared/*.js 篇幅離群值（>400行） ===");
  const outliers = findJsOutliers();
  if (!outliers.length) console.log("（無）");
  for (const o of outliers) console.log(`  ${o.file.replace(ROOT, "")}: ${o.lines} 行`);

  console.log("\n=== 過時關鍵字候選 ===");
  const hits = findStaleKeywords();
  if (!hits.length) console.log("（無）");
  for (const h of hits) console.log(`  ${h.file.replace(ROOT, "")}:${h.line} [${h.kw}] ${h.snippet}`);

  checkUnmergedBranches();

  console.log("\n只找候選，不判斷對錯——人工/AI逐一確認後才動手改。");
}

main();
