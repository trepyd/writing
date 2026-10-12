#!/usr/bin/env node
// tools/publish.mjs
//
//   node tools/publish.mjs <slug>        publish posts/<slug>: manifest, timestamp,
//                                        signed commit, push, archive requests
//   node tools/publish.mjs --confirm     upgrade every pending proof; record the
//                                        Bitcoin block once there is one
//   node tools/publish.mjs --status      every post and the state of its proof
//   node tools/publish.mjs <slug> --dry-run
//                                        every check, nothing written or sent
//   node tools/publish.mjs <slug> --no-archive
//                                        publish without the archive requests
//
// Publishing a post, in order:
//   1. Checks: on main, an origin remote, signing set up, nothing changed
//      outside the post's folder, front matter complete, not a draft.
//   2. Writes MANIFEST.sha256: the SHA-256 of every file in the folder.
//   3. Timestamps the manifest with OpenTimestamps (MANIFEST.sha256.ots). The
//      calendars answer at once; the Bitcoin attestation follows in a few
//      hours, which is what --confirm collects.
//   4. Commits the folder, signed, and checks the signature.
//   5. Pushes to origin.
//   6. Asks Software Heritage to archive the repo and the Wayback Machine to
//      save the post's page on GitHub. Either can fail without undoing 1-5.
//
// Needs Node 20+, git 2.34+ (SSH signing) and the OpenTimestamps client:
//   python -m pip install --user opentimestamps-client==0.7.2

import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseFrontMatter, readMeta, listPosts, manifestOf, manifestState, sha256, MANIFEST, PROOF, RECORD, SLUG } from './post.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POSTS = path.join(ROOT, 'posts');

// ---- running things -----------------------------------------------------------

function run(cmd, args, { cwd = ROOT, env, allowFail = false, input } = {}) {
  const r = spawnSync(cmd, args, { cwd, env, input, encoding: 'utf8' });
  if (r.error) throw new Error(`${cmd}: ${r.error.message}`);
  if (r.status !== 0 && !allowFail) throw new Error(`${cmd} ${args.join(' ')}\n${(r.stderr || r.stdout).trim()}`);
  return { ok: r.status === 0, out: (r.stdout || '').trim(), raw: r.stdout || '', err: (r.stderr || '').trim() };
}
const git = (args, opts) => run('git', args, opts);

// The OpenTimestamps client. On Windows, python-bitcoinlib looks for OpenSSL
// under an old DLL name at import time and stops before any command runs. A
// copy of Python's own libcrypto under that name, on PATH for this one call,
// satisfies it; nothing else on the machine changes.
function otsCommand() {
  const scripts = run('python', ['-c', "import sysconfig,os;print(sysconfig.get_path('scripts', os.name+'_user'))"], { allowFail: true }).out;
  const exe = scripts && [path.join(scripts, 'ots.exe'), path.join(scripts, 'ots')].find(existsSync);
  const env = { ...process.env };
  if (process.platform === 'win32') {
    const shim = path.join(process.env.LOCALAPPDATA, 'ots-shim');
    const dll = path.join(shim, 'libeay32.dll');
    if (!existsSync(dll)) {
      const dlls = run('python', ['-c', "import sys,os;print(os.path.join(sys.base_prefix,'DLLs'))"]).out;
      mkdirSync(shim, { recursive: true });
      copyFileSync(path.join(dlls, 'libcrypto-3.dll'), dll);
    }
    env.PATH = shim + path.delimiter + process.env.PATH;
  }
  return (args, opts = {}) => run(exe || 'ots', args, { env, ...opts });
}

// ---- checks -------------------------------------------------------------------

function repoState() {
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).out;
  const origin = git(['config', '--get', 'remote.origin.url'], { allowFail: true });
  const signing = git(['config', '--get', 'gpg.format'], { allowFail: true }).out === 'ssh'
    && !!git(['config', '--get', 'user.signingkey'], { allowFail: true }).out;
  // -z: one NUL-terminated `XY path` entry per file, paths unquoted. A
  // rename adds its old path as the next entry, which is skipped.
  const entries = git(['status', '--porcelain', '-z', '--untracked-files=all']).raw.split('\0').filter(Boolean);
  const dirty = [];
  for (let i = 0; i < entries.length; i++) {
    dirty.push(entries[i].slice(3));
    if (/^[RC]/.test(entries[i])) i++;
  }
  return { branch, origin: origin.ok ? origin.out : null, signing, dirty };
}

// https://github.com/<owner>/<repo> for an https or ssh origin, or null.
export function githubUrl(origin) {
  const m = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(origin || '');
  return m ? `https://github.com/${m[1]}/${m[2]}` : null;
}

// Problems that stop a publish, as sentences.
export function publishProblems({ slug, repo, meta }) {
  const p = [];
  if (repo.branch !== 'main') p.push(`You are on "${repo.branch}". Publish from main.`);
  if (!repo.origin) p.push('There is no origin remote. Create the GitHub repo and add it first.');
  else if (!githubUrl(repo.origin)) p.push(`origin is not a GitHub repo: ${repo.origin}`);
  if (!repo.signing) p.push('Commit signing is not set up. Run: node tools/setup.mjs');
  const outside = repo.dirty.filter((f) => !f.startsWith(`posts/${slug}/`));
  if (outside.length) p.push(`Commit or undo changes outside the post first: ${outside.join(', ')}`);
  if (meta?.draft) p.push('The post says draft: true. Remove that line to publish it.');
  return p;
}

// ---- archive requests ---------------------------------------------------------

async function archive(url, label) {
  try {
    const res = await fetch(url.href ?? url, { method: url.method || 'GET', signal: AbortSignal.timeout(60_000), headers: { 'user-agent': 'writing-publish/1' } });
    return `${label}: ${res.ok ? 'requested' : `HTTP ${res.status}`}`;
  } catch (e) {
    return `${label}: not reached (${e.message})`;
  }
}

// ---- publish ------------------------------------------------------------------

async function publish(slug, { dryRun, noArchive }) {
  if (!SLUG.test(slug)) throw new Error(`"${slug}" is not a post folder name (lower case, digits and dashes).`);
  const dir = path.join(POSTS, slug);
  const file = path.join(dir, 'index.md');
  if (!existsSync(file)) throw new Error(`No post at posts/${slug}/index.md.`);
  const meta = readMeta(parseFrontMatter(readFileSync(file, 'utf8')).data, `posts/${slug}/index.md`);
  const repo = repoState();
  const problems = publishProblems({ slug, repo, meta });
  if (problems.length) throw new Error(`Not published:\n  - ${problems.join('\n  - ')}`);

  const was = manifestState(dir);
  // The proof's own files can change without the post changing (a pending
  // --confirm rewrites the .ots), so only the post's content counts here.
  const own = new Set([MANIFEST, PROOF, RECORD].map((f) => `posts/${slug}/${f}`));
  if (was.state === 'match' && !repo.dirty.some((f) => !own.has(f))) {
    console.log(`posts/${slug} is already published and has not changed since.`);
    return;
  }
  const manifest = manifestOf(dir);
  console.log(`${was.state === 'none' ? 'Publishing' : 'Republishing (revised)'} posts/${slug}: "${meta.title}"`);
  process.stdout.write(manifest.replace(/^/gm, '  '));
  if (dryRun) { console.log('Dry run: nothing written, committed or sent.'); return; }

  writeFileSync(path.join(dir, MANIFEST), manifest);
  rmSync(path.join(dir, PROOF), { force: true });
  rmSync(path.join(dir, RECORD), { force: true });
  const ots = otsCommand();
  ots(['stamp', path.join(dir, MANIFEST)]);
  console.log(`Timestamped: manifest ${sha256(manifest)}`);

  git(['add', '--all', '--', `posts/${slug}`]);
  git(['commit', '-S', '-m', `${was.state === 'none' ? 'Publish' : 'Revise'} ${slug}: ${meta.title}`]);
  const sha = git(['rev-parse', 'HEAD']).out;
  const verified = git(['verify-commit', sha], { allowFail: true });
  if (!verified.ok) throw new Error(`The commit was made but its signature does not verify. Nothing was pushed.\n${verified.err}`);
  console.log(`Signed commit ${sha.slice(0, 12)}`);

  git(['push', 'origin', 'main']);
  console.log('Pushed to origin/main.');

  const repoUrl = githubUrl(repo.origin);
  const page = `${repoUrl}/blob/${sha}/posts/${slug}/index.md`;
  if (noArchive) console.log('Archive requests skipped (--no-archive).');
  else for (const line of await Promise.all([
    archive({ href: `https://archive.softwareheritage.org/api/1/origin/save/git/url/${repoUrl}/`, method: 'POST' }, 'Software Heritage'),
    archive(`https://web.archive.org/save/${page}`, 'Wayback Machine'),
  ])) console.log(line);
  console.log(`\nDone. The Bitcoin attestation takes a few hours. Then run:\n  node tools/publish.mjs --confirm`);
}

// ---- confirm ------------------------------------------------------------------

// The Bitcoin block heights an `ots info` listing attests to.
export function attestedHeights(info) {
  return [...info.matchAll(/BitcoinBlockHeaderAttestation\((\d+)\)/g)].map((m) => Number(m[1]));
}

async function blockTime(height) {
  const base = 'https://blockstream.info/api';
  const hash = await (await fetch(`${base}/block-height/${height}`, { signal: AbortSignal.timeout(30_000) })).text();
  const block = await (await fetch(`${base}/block/${hash.trim()}`, { signal: AbortSignal.timeout(30_000) })).json();
  return { hash: hash.trim(), time: new Date(block.timestamp * 1000).toISOString() };
}

async function confirm() {
  const repo = repoState();
  if (repo.dirty.length) throw new Error(`Commit or undo these first: ${repo.dirty.join(', ')}`);
  if (!repo.signing) throw new Error('Commit signing is not set up. Run: node tools/setup.mjs');
  const ots = otsCommand();
  const confirmed = [];
  for (const post of listPosts(POSTS)) {
    const proof = path.join(post.dir, PROOF);
    if (!existsSync(proof) || existsSync(path.join(post.dir, RECORD))) continue;
    // Exits non-zero while every calendar is still pending; info says which.
    ots(['upgrade', proof], { allowFail: true });
    rmSync(`${proof}.bak`, { force: true });
    const heights = attestedHeights(ots(['info', proof]).out);
    if (!heights.length) { console.log(`${post.slug}: still waiting for a Bitcoin block.`); continue; }
    const height = Math.min(...heights);
    const block = await blockTime(height);
    const record = {
      manifest: sha256(readFileSync(path.join(post.dir, MANIFEST))),
      bitcoin: { height, hash: block.hash, time: block.time },
      source: 'Block time as reported by blockstream.info. Verify the proof itself at https://opentimestamps.org.',
    };
    writeFileSync(path.join(post.dir, RECORD), JSON.stringify(record, null, 2) + '\n');
    confirmed.push(post.slug);
    console.log(`${post.slug}: in Bitcoin block ${height}, ${block.time}.`);
  }
  if (!confirmed.length) { console.log('Nothing new to confirm.'); return; }
  git(['add', '--all', '--', ...confirmed.map((s) => `posts/${s}`)]);
  git(['commit', '-S', '-m', `Confirm proof: ${confirmed.join(', ')}`]);
  const verified = git(['verify-commit', 'HEAD'], { allowFail: true });
  if (!verified.ok) throw new Error(`The commit was made but its signature does not verify. Nothing was pushed.\n${verified.err}`);
  git(['push', 'origin', 'main']);
  console.log('Committed and pushed.');
}

// ---- status -------------------------------------------------------------------

function status() {
  const posts = listPosts(POSTS);
  if (!posts.length) { console.log('No posts yet.'); return; }
  for (const post of posts) {
    let meta;
    try { meta = readMeta(parseFrontMatter(readFileSync(post.file, 'utf8')).data, post.slug); } catch (e) { console.log(`${post.slug}: ${e.message}`); continue; }
    const m = manifestState(post.dir);
    const record = existsSync(path.join(post.dir, RECORD)) ? JSON.parse(readFileSync(path.join(post.dir, RECORD), 'utf8')) : null;
    const state = meta.draft ? 'draft'
      : m.state === 'none' ? 'not published'
        : m.state === 'changed' ? `changed since it was published (${m.changed.join(', ')})`
          : record ? `published, in Bitcoin block ${record.bitcoin.height} (${record.bitcoin.time.slice(0, 10)})`
            : 'published, waiting for its Bitcoin block (run --confirm)';
    console.log(`${post.slug}: ${state}`);
  }
}

// ---- command line -------------------------------------------------------------

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const slug = args.find((a) => !a.startsWith('--'));
  const job = args.includes('--status') ? status()
    : args.includes('--confirm') ? confirm()
      : slug ? publish(slug, { dryRun: args.includes('--dry-run'), noArchive: args.includes('--no-archive') })
        : (console.log('Usage: node tools/publish.mjs <slug> [--dry-run] | --confirm | --status'), process.exit(1));
  Promise.resolve(job).catch((e) => { console.error(e.message); process.exit(1); });
}
