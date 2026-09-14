#!/usr/bin/env node
// Deterministic Markdown link checker for the `docs` CI job (docs/11-ci-cd.md).
// Checks relative file links and heading anchors only; external URLs are checked nightly.
// Usage: node scripts/check-links.mjs [root]   (exit 1 on any problem)

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative, extname } from "node:path";

const root = resolve(process.argv[2] ?? ".");
const skipDirs = new Set(["node_modules", ".git", "target", "dist", ".pnpm-store"]);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (skipDirs.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (extname(entry) === ".md") yield full;
  }
}

// GitHub-style heading slugs: strip code/links/punctuation, lower-case, spaces → dashes,
// duplicates get -1, -2, …
function slug(heading) {
  let h = heading.replace(/`([^`]*)`/g, "$1").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  h = h.trim().toLowerCase().replace(/[^\p{L}\p{N}\- ]/gu, "").replace(/ /g, "-");
  return h;
}

function headingAnchors(text) {
  const seen = new Map();
  const anchors = new Set();
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (!m) continue;
    const base = slug(m[2].replace(/\s+#+\s*$/, ""));
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    anchors.add(n === 0 ? base : `${base}-${n}`);
  }
  return anchors;
}

const files = [...walk(root)];
const anchors = new Map(files.map((f) => [f, headingAnchors(readFileSync(f, "utf8"))]));
const linkRe = /(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
let problems = 0;

for (const file of files) {
  const text = readFileSync(file, "utf8").replace(/```[\s\S]*?```/g, "");
  for (const m of text.matchAll(linkRe)) {
    const href = m[1];
    if (/^(https?:|mailto:|#$)/.test(href)) continue;
    const [path, frag] = href.split("#");
    const target = path === "" ? file : resolve(dirname(file), decodeURIComponent(path));
    const rel = relative(root, file);
    if (!existsSync(target)) {
      console.log(`MISSING  ${rel}: ${href}`);
      problems++;
      continue;
    }
    if (frag && extname(target) === ".md") {
      const set = anchors.get(target) ?? headingAnchors(readFileSync(target, "utf8"));
      if (!set.has(frag)) {
        console.log(`ANCHOR   ${rel}: ${href}`);
        problems++;
      }
    }
  }
}

console.log(`${files.length} files, ${problems} problem${problems === 1 ? "" : "s"}`);
process.exit(problems ? 1 : 0);
