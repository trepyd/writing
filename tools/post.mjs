// tools/post.mjs
//
// The post format, shared by tools/publish.mjs here and by the blog step of
// the site build, which imports this file so both read posts the same way.
//
// A post is a folder, posts/<slug>/, holding index.md and any images or
// video it shows. index.md opens with front matter:
//
//   ---
//   title: The post's title
//   date: 2026-10-12
//   summary: One or two sentences for the index, the feed and link previews.
//   tags: [game ai, behaviour]
//   draft: true            (optional; a draft is never published)
//   ---
//
// Publishing adds three files beside it:
//   MANIFEST.sha256      the SHA-256 of every other file in the folder,
//                        in the format `sha256sum -c` reads
//   MANIFEST.sha256.ots  the OpenTimestamps proof that the manifest existed
//   proof.json           once the proof is in a Bitcoin block: which block
//                        and when (written by publish.mjs --confirm)

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const MANIFEST = 'MANIFEST.sha256';
export const PROOF = 'MANIFEST.sha256.ots';
export const RECORD = 'proof.json';
const OWN = new Set([MANIFEST, PROOF, RECORD, `${PROOF}.bak`]);

// ---- front matter -------------------------------------------------------------

export function parseFrontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { data: {}, body: text };
  const data = {};
  let listKey = null;
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '');
    if (!line.trim()) continue;
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) { data[listKey].push(scalar(item[1])); continue; }
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) throw new Error(`front matter: cannot read the line "${raw}"`);
    const [, key, value] = kv;
    if (value === '') { data[key] = []; listKey = key; continue; }
    listKey = null;
    data[key] = /^\[.*\]$/.test(value)
      ? value.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean).map(scalar)
      : scalar(value);
  }
  return { data, body: text.slice(m[0].length) };
}

function scalar(s) {
  s = s.trim();
  if (/^".*"$/.test(s)) return JSON.parse(s);
  if (/^'.*'$/.test(s)) return s.slice(1, -1).replace(/''/g, "'");
  if (s === 'true') return true;
  if (s === 'false') return false;
  return s;
}

// The post's metadata, checked. Throws with every problem at once.
export function readMeta(data, label) {
  const problems = [];
  if (!data.title) problems.push('no title');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.date || ''))) problems.push('date must be YYYY-MM-DD');
  else if (Number.isNaN(Date.parse(`${data.date}T00:00:00Z`))) problems.push(`no such date ${data.date}`);
  if (!data.summary) problems.push('no summary');
  if (problems.length) throw new Error(`${label}: ${problems.join('; ')}`);
  const tags = data.tags == null ? [] : Array.isArray(data.tags) ? data.tags : [data.tags];
  return { title: String(data.title), date: String(data.date), summary: String(data.summary), tags: tags.map(String), draft: data.draft === true };
}

// ---- posts ------------------------------------------------------------------

export const SLUG = /^[a-z0-9][a-z0-9-]*$/;

// Every post folder under `postsDir`, sorted by slug.
export function listPosts(postsDir) {
  if (!existsSync(postsDir)) return [];
  return readdirSync(postsDir).sort()
    .filter((name) => SLUG.test(name) && statSync(path.join(postsDir, name)).isDirectory() && existsSync(path.join(postsDir, name, 'index.md')))
    .map((slug) => ({ slug, dir: path.join(postsDir, slug), file: path.join(postsDir, slug, 'index.md') }));
}

// ---- manifest ---------------------------------------------------------------

// Every file in the post folder but the proof's own, as relative paths with
// forward slashes, sorted.
export function postFiles(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...postFiles(p, base));
    else if (!(dir === base && OWN.has(name))) out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out.sort();
}

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// The manifest text for the folder as it is now.
export function manifestOf(dir) {
  return postFiles(dir).map((f) => `${sha256(readFileSync(path.join(dir, f)))}  ${f}\n`).join('');
}

// Whether the folder still matches its committed manifest: 'none' (never
// published), 'match', or 'changed' with the files that differ.
export function manifestState(dir) {
  const file = path.join(dir, MANIFEST);
  if (!existsSync(file)) return { state: 'none' };
  const was = readFileSync(file, 'utf8');
  const now = manifestOf(dir);
  if (was === now) return { state: 'match' };
  const lines = (t) => new Map(t.trim().split('\n').filter(Boolean).map((l) => [l.slice(66), l.slice(0, 64)]));
  const a = lines(was), b = lines(now);
  const changed = [...new Set([...a.keys(), ...b.keys()])].filter((f) => a.get(f) !== b.get(f)).sort();
  return { state: 'changed', changed };
}
