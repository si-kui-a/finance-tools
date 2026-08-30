#!/usr/bin/env node
// 資深懶散工程師機械複查——只找候選，不判斷對錯。
// 本repo是純前端靜態工具，沒有PAT編號式知識庫，不確定的做法先查
// README.md「計算方式與重要界線」一節，內部真的沒有才查外部。

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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

function main() {
  console.log("=== shared/*.js 篇幅離群值（>400行） ===");
  const outliers = findJsOutliers();
  if (!outliers.length) console.log("（無）");
  for (const o of outliers) console.log(`  ${o.file.replace(ROOT, "")}: ${o.lines} 行`);

  console.log("\n=== 過時關鍵字候選 ===");
  const hits = findStaleKeywords();
  if (!hits.length) console.log("（無）");
  for (const h of hits) console.log(`  ${h.file.replace(ROOT, "")}:${h.line} [${h.kw}] ${h.snippet}`);

  console.log("\n只找候選，不判斷對錯——人工/AI逐一確認後才動手改。");
}

main();
