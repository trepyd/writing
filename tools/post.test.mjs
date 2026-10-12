// tools/post.test.mjs: the post format and the publish checks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseFrontMatter, readMeta, listPosts, manifestOf, manifestState, MANIFEST } from './post.mjs';
import { githubUrl, publishProblems, attestedHeights } from './publish.mjs';

const POST = `---
title: "Senses, not scripts"
date: 2026-10-12
summary: Why a guard should hear the door.
tags: [game ai, perception]
---
Body.
`;

test('front matter reads strings, lists and booleans', () => {
  const { data, body } = parseFrontMatter(POST);
  assert.deepEqual(readMeta(data, 'x'), { title: 'Senses, not scripts', date: '2026-10-12', summary: 'Why a guard should hear the door.', tags: ['game ai', 'perception'], draft: false });
  assert.equal(body, 'Body.\n');
  assert.equal(readMeta(parseFrontMatter(POST.replace('---\nBody', 'draft: true\n---\nBody')).data, 'x').draft, true);
});

test('missing fields are named together', () => {
  assert.throws(() => readMeta({ date: '2026-13-45' }, 'p'), /p: no title; no such date 2026-13-45; no summary/);
  assert.throws(() => readMeta({ title: 'a', date: '12/10/2026', summary: 's' }, 'p'), /YYYY-MM-DD/);
});

test('the manifest covers every file but its own, and notices a change', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'post-'));
  try {
    mkdirSync(path.join(dir, 'clips'));
    writeFileSync(path.join(dir, 'index.md'), POST);
    writeFileSync(path.join(dir, 'clips', 'run.mp4'), Buffer.from([0, 1, 2]));
    const m = manifestOf(dir);
    assert.match(m, /^[0-9a-f]{64} {2}clips\/run\.mp4\n[0-9a-f]{64} {2}index\.md\n$/);
    assert.equal(manifestState(dir).state, 'none');
    writeFileSync(path.join(dir, MANIFEST), m);
    writeFileSync(path.join(dir, 'MANIFEST.sha256.ots'), 'proof');
    writeFileSync(path.join(dir, 'proof.json'), '{}');
    assert.equal(manifestState(dir).state, 'match');
    writeFileSync(path.join(dir, 'index.md'), POST + 'More.\n');
    assert.deepEqual(manifestState(dir), { state: 'changed', changed: ['index.md'] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('posts are folders with an index.md and a plain slug', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'posts-'));
  try {
    for (const name of ['b-post', 'a-post', 'Bad Name']) { mkdirSync(path.join(dir, name)); writeFileSync(path.join(dir, name, 'index.md'), POST); }
    mkdirSync(path.join(dir, 'empty'));
    assert.deepEqual(listPosts(dir).map((p) => p.slug), ['a-post', 'b-post']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('publish refuses the wrong branch, no remote, no signing, stray changes and drafts', () => {
  const ok = { branch: 'main', origin: 'https://github.com/trepyd/writing.git', signing: true, dirty: ['posts/p/index.md'] };
  assert.deepEqual(publishProblems({ slug: 'p', repo: ok, meta: { draft: false } }), []);
  const bad = publishProblems({ slug: 'p', repo: { branch: 'wip', origin: null, signing: false, dirty: ['README.md'] }, meta: { draft: true } });
  assert.equal(bad.length, 5);
});

test('GitHub URLs from either kind of remote', () => {
  assert.equal(githubUrl('https://github.com/trepyd/writing.git'), 'https://github.com/trepyd/writing');
  assert.equal(githubUrl('git@github.com:trepyd/writing.git'), 'https://github.com/trepyd/writing');
  assert.equal(githubUrl('https://gitlab.com/x/y'), null);
});

test('Bitcoin heights come out of an ots info listing', () => {
  assert.deepEqual(attestedHeights('verify PendingAttestation(\'https://a\')\nverify BitcoinBlockHeaderAttestation(916402)\n'), [916402]);
  assert.deepEqual(attestedHeights('verify PendingAttestation(\'https://a\')'), []);
});
