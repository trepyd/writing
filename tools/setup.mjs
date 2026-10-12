#!/usr/bin/env node
// tools/setup.mjs
//
//   node tools/setup.mjs [--key ~/.ssh/id_ed25519.pub]
//
// Sets up commit signing for this repo only (nothing global), once per
// machine:
//   - git signs every commit here with your SSH key
//   - allowed_signers, committed, lists that key against your commit email,
//     so anyone with a clone can check a signature:
//       git -c gpg.ssh.allowedSignersFile=allowed_signers log --show-signature
//
// GitHub shows a commit as Verified once the same key is registered on the
// account as a SIGNING key (separate from its use for logging in). The last
// lines this prints say how.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
};

const args = process.argv.slice(2);
const i = args.indexOf('--key');
const key = path.resolve((i >= 0 ? args[i + 1] : path.join(os.homedir(), '.ssh', 'id_ed25519.pub')).replace(/^~/, os.homedir()));
if (!existsSync(key) || !key.endsWith('.pub')) {
  console.error(`No public key at ${key}. Pass one with --key <path to .pub>.`);
  process.exit(1);
}
const email = git('config', '--get', 'user.email');
const pub = readFileSync(key, 'utf8').trim().split(/\s+/).slice(0, 2).join(' ');

git('config', '--local', 'gpg.format', 'ssh');
git('config', '--local', 'user.signingkey', key);
git('config', '--local', 'commit.gpgsign', 'true');
git('config', '--local', 'gpg.ssh.allowedSignersFile', path.join(ROOT, 'allowed_signers'));
writeFileSync(path.join(ROOT, 'allowed_signers'), `${email} namespaces="git" ${pub}\n`);

console.log(`Commits in this repo are now signed with ${key}`);
console.log(`allowed_signers lists it for ${email}. Commit that file.`);
console.log('\nSo GitHub shows your commits as Verified, register the key as a signing key, once:');
console.log('  gh auth refresh -h github.com -s admin:ssh_signing_key');
console.log(`  gh ssh-key add "${key}" --type signing --title "Signing key"`);
console.log('or on github.com: Settings > SSH and GPG keys > New SSH key > Key type: Signing Key.');
