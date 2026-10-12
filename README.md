# Writing

The posts published at [arronconnelly.com/blog](https://arronconnelly.com/blog/), by Arron D. Connelly.

This repo is the source of every post, and the record of when each one was written. The site is built from it, and the site cannot show a post before it is here.

## Checking a post

Each post is a folder in `posts/` with three files besides its text and images.

- **`MANIFEST.sha256`** lists the SHA-256 fingerprint of every file in the folder. Check it from inside the folder with `sha256sum -c MANIFEST.sha256`. If any file has changed, the check fails.
- **`MANIFEST.sha256.ots`** is an [OpenTimestamps](https://opentimestamps.org) proof that the manifest existed at a certain time. Drop the manifest and its `.ots` file onto [opentimestamps.org](https://opentimestamps.org) to check it there, or run `ots verify MANIFEST.sha256.ots` with your own Bitcoin node. The proof is anchored in the Bitcoin blockchain, so it does not depend on this repo, on GitHub, or on the author.
- **`proof.json`** names the Bitcoin block the proof landed in, and when. It is a convenience; the `.ots` file is the proof.

Commit dates in git are set by whoever makes the commit, so they prove nothing about time on their own. The timestamp is what does.

Every commit is signed. GitHub shows it as Verified, and `allowed_signers` lets you check a signature from a clone:

    git -c gpg.ssh.allowedSignersFile=allowed_signers log --show-signature

A post that is revised gets a new manifest and a new timestamp. The earlier ones stay in the history.

Each publish also asks [Software Heritage](https://www.softwareheritage.org) to archive this repo and the [Wayback Machine](https://web.archive.org) to save the post's page, as two more independent copies.

## Publishing

    node tools/setup.mjs                  once per machine: commit signing
    node tools/publish.mjs <slug>         publish posts/<slug>
    node tools/publish.mjs --confirm      a few hours later: record the Bitcoin block
    node tools/publish.mjs --status       every post and its proof

`publish.mjs` needs Node 20 or later, git 2.34 or later, and the OpenTimestamps client:

    python -m pip install --user opentimestamps-client==0.7.2

A post folder holds `index.md` and the images or video it shows. `index.md` starts with:

    ---
    title: The post's title
    date: 2026-10-12
    summary: One or two sentences for the index, the feed and link previews.
    tags: [game ai, behaviour]
    draft: true
    ---

A post with `draft: true` is never published. Remove the line when it is ready.

## Copyright

© Arron D. Connelly. All rights reserved. See [LICENSE](LICENSE).
