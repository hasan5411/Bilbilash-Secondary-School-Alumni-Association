# Git Backup & Rollback Guide (BSSAA)

This guide is for anyone — including people new to Git — who needs to protect a
working version of the site, try a risky change on a separate branch, or undo a
change that turned out badly.

It is written for this repository:

- Remote: `https://github.com/hasan5411/Bilbilash-Secondary-School-Alumni-Association.git`
- Default branch: `main`
- The "stable" version is whatever commit is on `main` and confirmed working.

> Golden rule: **never destroy history.** Back up first, push branches instead of
> overwriting them, and undo with new commits (`git revert`) rather than erasing
> old ones.

---

## 0. Quick facts (the safety rules)

Every contributor must follow these. They exist to prevent data loss:

- Never use `git push --force`.
- Never use `git reset --hard` without explicit approval.
- Never delete existing branches or commits.
- Never overwrite the `main` branch.
- Never discard uncommitted changes.
- Never commit secrets or environment files (`.env`, keys, certificates).
- Never merge into `main` without owner approval.
- Never deploy to Vercel without owner approval.
- Never modify the production database.
- Never claim a backup exists without verifying it on GitHub.
- Never claim a rollback succeeded without checking the actual commit hash.
- If an unexpected Git state or conflict appears, **stop and explain it** before
  doing anything else.

---

## 1. How to check where you are

Before any operation, see the current state:

```bash
git status
git log --oneline -5
git branch -vv
```

- `git status` shows the current branch and any changed files.
- `git log --oneline -5` shows the last 5 commits (the top line is your current version).
- `git branch -vv` lists local branches and which remote they track.

The short hash on the left (e.g. `1b81ca4`) identifies a commit. A full hash looks
like `1b81ca4e66c94e85af8c589b5ca1937770188ab6`.

---

## 2. Create a backup branch

A backup branch is a safe, frozen copy of a known-good commit. Create it **before**
starting risky work.

```bash
# 1. Make sure you are looking at the latest remote state
git fetch origin

# 2. Note the exact commit you consider stable
git rev-parse main

# 3. Create a backup branch pointing at that commit
git switch main
git branch backup/pre-change-YYYY-MM-DD

# 4. Push the backup to GitHub
git push -u origin backup/pre-change-YYYY-MM-DD

# 5. VERIFY it exists on GitHub with the same hash
git ls-remote origin refs/heads/backup/pre-change-YYYY-MM-DD
```

The hash printed by the last command must match `git rev-parse backup/pre-change-YYYY-MM-DD`.
If it does, the backup is real. If not, stop.

Example already in this repo: `backup/pre-pwa-stable-2026-11-25` points at the
stable commit before the PWA/Android work began.

> Never create a backup branch over an existing one. If the name already exists,
> pick a new date/name. Never force-push a backup.

---

## 3. Create a development branch

Do risky work on a separate branch so `main` (and the backup) stay untouched.

```bash
# From main (or the backup), create and switch to a feature branch
git switch -c feature/my-change

# Your uncommitted changes carry over automatically — nothing is lost.
git status
```

Rules for a clean commit:

- Review what you changed: `git diff` and `git status`.
- Stage only the files you intend to commit, by name:
  ```bash
  git add path/to/file1 path/to/file2
  ```
- Never stage secrets or generated artifacts. This repo's `.gitignore` already
  excludes `.env`, `frontend/.certs/`, `frontend/vite.https.config.js`,
  `node_modules/`, `dist/`, `.pgdata/`, `uploads/`, and backups.
- Double-check the staged set before committing:
  ```bash
  git diff --cached --name-status
  ```

---

## 4. Commit and push

```bash
git commit -m "fix: a short description of the change"
git push -u origin feature/my-change

# Verify the remote branch and hash match your local commit
git ls-remote origin refs/heads/feature/my-change
git rev-parse HEAD
```

The two hashes must be identical. Do **not** merge into `main` without approval.

---

## 5. Restore the previous stable version (via Qoder)

If a change makes the site worse, ask Qoder to restore the stable version. A safe
request looks like this:

> "Restore the repository to the stable backup branch
> `backup/pre-pwa-stable-2026-11-25`. First show me `git status`, confirm my
> uncommitted work is preserved or backed up, tell me exactly which commit you will
> restore to, and wait for my approval before any destructive step. Do not use
> `--force` or `reset --hard` unless I explicitly approve."

Qoder will:

1. Inspect the current state.
2. Protect or stash your uncommitted work.
3. Explain the exact commit to restore.
4. Ask for approval before anything destructive.
5. Restore that exact commit and verify the resulting hash.

You then verify with `git log --oneline -1` and compare the hash to the backup.

---

## 6. Restore the stable version (manual Git commands)

This creates a new branch at the backup commit, so nothing is lost and history is
preserved. This is the safest manual method.

```bash
# 1. Fetch the latest remote refs
git fetch origin

# 2. Create a restore branch at the known-good commit (does not move main)
git switch --detach backup/pre-pwa-stable-2026-11-25
git switch -c restore/stable-YYYY-MM-DD

# 3. Confirm the hash matches the stable commit
git log --oneline -1

# 4. Push the restore branch to share/keep it
git push -u origin restore/stable-YYYY-MM-DD
```

If everything is correct and approved, you can later fast-forward `main` to the
restored state. **That requires owner approval** and must never overwrite others'
work.

If you have uncommitted changes you want to keep, commit them to a scratch branch
first (`git switch -c wip/my-work && git commit -am "wip"`) — never discard them.

---

## 7. Undo a problematic feature commit with `git revert`

Use `git revert` to cancel a specific commit by creating a new, opposite commit.
This keeps full history (the problematic commit stays, but its effect is undone).

```bash
# 1. Find the commit to undo
git log --oneline

# 2. Revert it (creates a new commit that undoes those changes)
git revert <commit-hash>

# 3. Verify and push
git log --oneline -3
git push
```

To revert without committing immediately (so you can review first):

```bash
git revert --no-commit <commit-hash>
git status
# review, then:
git commit -m "revert: undo <description>"
```

Never rewrite history to "remove" a pushed commit — revert it instead.

---

## 8. Recover from accidental local changes

If files are modified or deleted by mistake, evaluate before acting.

Option A — keep some changes, discard others (per file):

```bash
git status
# look at what changed
git diff path/to/file
# restore just that file from the last commit (this DISCARDS its local changes)
git restore path/to/file
```

Option B — set aside work safely to inspect a clean version:

```bash
git switch -c wip/save-my-work
git commit -am "wip: save before recovery"
git switch feature/my-change
```

Option C — a brand-new clone (safe, non-destructive) when the local repo is
damaged or confused:

```bash
cd ..
git clone https://github.com/hasan5411/Bilbilash-Secondary-School-Alumni-Association.git bssaa-recovery
cd bssaa-recovery
git log --oneline -5
```

> Deleted or discarded work is hard to get back. When unsure, commit to a scratch
> branch or back up the files before running any restore/reset command. Ask before
> destructive operations.

---

## 9. Recover the stable version from GitHub (if local is damaged)

If the local repository is broken, rebuild it from a fresh clone:

```bash
cd ..
git clone https://github.com/hasan5411/Bilbilash-Secondary-School-Alumni-Association.git bssaa-recovery
cd bssaa-recovery

# Restore the exact stable backup commit
git switch --detach origin/backup/pre-pwa-stable-2026-11-25
git switch -c restore/from-github-YYYY-MM-DD

git log --oneline -1
```

Since the backup lives on GitHub, a damaged local copy can always be rebuilt from
the remote. This is why every backup branch must be pushed and verified.

---

## 10. Verify the restored version

After any restore, confirm you are actually on the intended version:

```bash
# 1. The commit hash must match the stable/backup hash
git log --oneline -1
git rev-parse HEAD
git rev-parse backup/pre-pwa-stable-2026-11-25
```

The last two hashes must match if you restored the backup.

```bash
# 2. Confirm the remote also points where you expect
git ls-remote origin refs/heads/backup/pre-pwa-stable-2026-11-25
```

```bash
# 3. Sanity-check that the app still builds and runs
cd frontend && npm run build
```

Only report a restore as successful once the hashes match **and** the build passes.
Never claim a rollback succeeded based on assumption.

---

## 11. What "done" looks like

- A backup branch exists on GitHub at the verified stable hash.
- Risky work lives on its own feature branch and was pushed.
- `main` was not overwritten or force-pushed.
- Secret/environment files were never committed.
- After a restore, the local hash equals the backup hash and the build passes.
