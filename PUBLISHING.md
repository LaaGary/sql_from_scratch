# Publishing this project on GitHub

This guide takes you from a folder on your machine to a public GitHub repository with:

- a clean commit history and a proper license,
- the ten-chapter tutorial site live on **GitHub Pages**, and
- a CI workflow that runs the test suite on every push and pull request.

It assumes this folder (`SQL/`) is the repository root. Everything here is plain files, so no build service is required.

---

## 0. The mental model (60 seconds)

Git tracks snapshots of your files. A few terms are enough to start:

| Term | What it means |
| --- | --- |
| Working tree | The files you see and edit. |
| Staging area (index) | The changes you have marked to include in the next snapshot. |
| Commit | An immutable snapshot plus a message, author and timestamp. |
| Branch | A movable name pointing at a commit. `main` is the default here. |
| Remote | A named URL of another copy of the repo, usually `origin` = GitHub. |
| `push` | Upload local commits to the remote. |
| `pull` | Download remote commits and merge them into your branch. |

Nothing leaves your machine until you run `git push`.

---

## 1. Install and configure Git

Check whether Git is already installed:

```bash
git --version
```

If that fails, install it from <https://git-scm.com/download/win> (or `winget install Git.Git`), then reopen the terminal.

Set the name and email that will appear in every commit **once per machine**:

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

Use the same email as your GitHub account if you want commits linked to your profile. Verify:

```bash
git config --global --list
```

Optional but recommended on Windows:

```bash
git config --global init.defaultBranch main
git config --global pull.rebase true
git config --global core.autocrlf input
```

The repository already ships a `.gitattributes` file that normalizes line endings to LF, which keeps Windows and CI checkouts consistent.

---

## 2. Authenticate to GitHub

Choose one of the three options below. **SSH** or the **GitHub CLI** are the least painful long-term.

### Option A - GitHub CLI (easiest)

```bash
winget install GitHub.cli
gh auth login
```

Pick **GitHub.com**, **HTTPS**, and authenticate in the browser. Then you can create the repo and push in one command (see section 4).

### Option B - SSH key (recommended if you dislike tokens)

```bash
ssh-keygen -t ed25519 -C "you@example.com"
# press Enter for the default path; set a passphrase if you like
Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub | Set-Clipboard
```

Add the copied key at **GitHub -> Settings -> SSH and GPG keys -> New SSH key**, then test:

```bash
ssh -T git@github.com
```

Use the SSH remote URL instead of HTTPS: `git@github.com:<you>/<repo>.git`.

### Option C - HTTPS + personal access token

1. GitHub -> **Settings -> Developer settings -> Personal access tokens -> Fine-grained tokens -> Generate new token**.
2. Repository access: **Only select repositories** -> the repo you are about to create.
3. Permissions: **Contents: Read and write**.
4. Copy the token (starts with `github_pat_`).

When Git asks for a password on the first push, paste the token. Git for Windows stores it in Windows Credential Manager, so you only do this once.

Never commit tokens or keys. If one leaks, revoke it immediately.

---

## 3. Create the empty repository on GitHub

Web UI: **github.com -> New repository**.

- Name: `sql-from-scratch` (or anything you like)
- Visibility: **Public** if you want free GitHub Pages
- **Do not** initialize with a README, .gitignore or license - this folder already has them, and empty is easier to merge

Or with the CLI:

```bash
gh repo create sql-from-scratch --public --source=. --remote=origin
```

That creates the remote and adds it as `origin`; you still run the first push yourself (section 4).

---

## 4. First commit and first push

This workspace is already initialized as a Git repository (`git init -b main` was run for you). If you are starting from a plain copy instead, run `git init -b main` first.

```bash
cd E:\FollowAIBuild\SQL

# 1. See what Git will include
git status

# 2. Stage everything (the .gitignore keeps databases and scratch files out)
git add .

# 3. Snapshot it
git commit -m "Initial commit: SQL engine and ten-chapter tutorial site"

# 4. Point at the empty GitHub repo (HTTPS example)
git remote add origin https://github.com/<your-username>/<repo>.git

# 5. Confirm the remote
git remote -v

# 6. Upload, and remember the remote for this branch
git push -u origin main
```

What the flags mean:

- `git add .` stages new, modified and deleted files below the current directory.
- `git commit -m "..."` records the staged snapshot.
- `-u` (short for `--set-upstream`) links your local `main` to `origin/main`, so later you can just run `git push` and `git pull`.

Refresh the GitHub page: your files are there. If the push asks for a password, use the token from section 2 (or your SSH key).

---

## 5. The everyday workflow

Repeat these five commands while you work:

```bash
git status              # what changed?
git diff                # exact unstaged changes
git add <file>          # stage one file (or: git add -A)
git commit -m "fix: handle NULL in GROUP BY"
git push
```

Before you push, pull other people's changes (or your own from another machine):

```bash
git pull
```

Useful inspectors:

```bash
git log --oneline --graph --decorate -n 15
git show HEAD
git diff --staged        # what is about to be committed
git restore <file>       # discard unstaged edits to a file
git restore --staged <file>   # unstage but keep the edit
```

Write commit messages in the imperative mood: `add`, `fix`, `refactor`, `docs`, `test`. A short prefix makes history scannable:

```text
feat: add LIKE ESCAPE support
fix: reject duplicate column names in CREATE TABLE
docs: translate chapter 6 to English
test: cover journal recovery after a torn write
```

---

## 6. Branches and pull requests

Never experiment directly on `main` once the project is shared. Create a branch:

```bash
git switch -c feat/indexes
# edit, test, commit
git push -u origin feat/indexes
```

Then open a **Pull Request** on GitHub (`Compare & pull request`), describe the change, let CI run, and merge with **Squash and merge**. Afterwards, update your local `main`:

```bash
git switch main
git pull
git branch -d feat/indexes      # delete the merged local branch
git push origin --delete feat/indexes   # optional: delete on GitHub
```

Protect `main` under **Settings -> Branches -> Add branch protection rule**: require the CI check, and optionally require a pull request before merging.

---

## 7. Releases and tags

A tag is a permanent label for a commit; a GitHub Release is a tag plus notes and optional assets.

```bash
git switch main
git pull
git tag -a v1.0.0 -m "SQL engine 1.0.0: full tutorial, persistence, transactions"
git push origin v1.0.0
```

Then **Releases -> Draft a new release -> choose the tag -> Generate release notes -> Publish**. Use semantic versions: `MAJOR.MINOR.PATCH`.

---

## 8. Put the tutorial site on GitHub Pages

The site is already static, so GitHub can host it for free. There are two ways; **Option A is included in this repo** and is the least work.

### Option A - deploy with GitHub Actions (included)

The workflow `.github/workflows/pages.yml` rebuilds `docs/` and publishes it on every push to `main`.

1. Push the repository (section 4).
2. GitHub -> **Settings -> Pages -> Build and deployment -> Source: GitHub Actions**.
3. Push again (or open **Actions -> Deploy tutorial site to GitHub Pages -> Run workflow**).
4. Your site appears at `https://<your-username>.github.io/<repo>/`.

Relative links in the site are written so they work under that sub-path automatically.

### Option B - serve the `/docs` folder from a branch (no Actions)

1. GitHub -> **Settings -> Pages -> Source: Deploy from a branch**.
2. Branch: `main`, folder: `/docs`, then **Save**.
3. The generated HTML is committed, so no build step is needed.

If you choose Option B, disable the Actions workflow to avoid two deployments fighting: **Actions -> Deploy tutorial site to GitHub Pages -> Disable workflow**.

### Custom domain (optional)

**Settings -> Pages -> Custom domain**, then add a `CNAME` record at your DNS provider. GitHub writes a `docs/CNAME` file on the Pages branch; with Actions you add `docs/CNAME` yourself (one line: your domain).

---

## 9. Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request to `main`:

- on Node 20, 22 and 24,
- it runs every test file (`tests/*.test.js`),
- rebuilds the tutorial site,
- and syntax-checks the generated browser bundle.

Watch the results under the **Actions** tab. A red check means the change is not ready to merge.

Optional badge for the README:

```markdown
![CI](https://github.com/<your-username>/<repo>/actions/workflows/ci.yml/badge.svg)
```

---

## 10. What `.gitignore` keeps out

| Pattern | Why |
| --- | --- |
| `node_modules/` | dependencies, never commit them |
| `*.db`, `*.journal` | local experiment databases and transaction journals |
| `docs/_shots/` | local screenshots and browser profiles |
| `.DS_Store`, `Thumbs.db`, `.vscode/`, `.idea/` | OS and editor noise |
| `*.log` | scratch output |

Check what would be committed before staging: `git status --short`. If a file is already tracked and you want it ignored later, remove it from the index without deleting it:

```bash
git rm --cached path/to/file
git commit -m "chore: stop tracking generated file"
```

---

## 11. Troubleshooting

**`Author identity unknown`** - run the `git config --global user.name/user.email` commands from section 1.

**`Authentication failed`** - you typed your GitHub password. Use a personal access token (Option C) or switch the remote to SSH
(`git remote set-url origin git@github.com:<you>/<repo>.git`).

**`Updates were rejected because the remote contains work you do not have`** - the GitHub repo already has commits (for example a README created in the web UI). Either pull and merge, or overwrite it if it is truly empty:

```bash
git pull origin main --allow-unrelated-histories   # then resolve conflicts
# or, only if the remote content is disposable:
git push -u origin main --force
```

`--force` rewrites the remote history. Never use it on a shared branch without a reason.

**`fatal: not a git repository`** - you are in the wrong folder. `cd` into `SQL/` (the folder that contains `package.json`).

**A database file was committed by accident** -

```bash
git rm --cached examples/demo.db
git commit -m "chore: remove committed database"
```

**Line endings look wrong in CI** - keep `.gitattributes` and `git config --global core.autocrlf input` as configured above.

**File name case changes are ignored** - Git on Windows is case-insensitive. Rename through two steps: `git mv OldName tmp && git mv tmp NewName`.

---

## 12. Polish before you call it published

- [ ] Replace `<YOUR NAME>` in `LICENSE` with your name or handle.
- [ ] Fill in the repository **Description** and **Topics** (`sql`, `database`, `tutorial`, `javascript`, `nodejs`).
- [ ] Add a screenshot or GIF to the README once the site is live.
- [ ] Confirm the Pages URL opens in a private window (no cached login).
- [ ] Check the **Actions** tab: CI and Pages both green.
- [ ] Tag the first release (`v1.0.0`).
- [ ] Keep a `CHANGELOG.md` if you plan to keep shipping (optional).

---

## 13. Cheat sheet

| Task | Command |
| --- | --- |
| See changes | `git status`, `git diff` |
| Stage | `git add .` / `git add -p` |
| Commit | `git commit -m "message"` |
| Push | `git push` |
| Pull | `git pull` |
| New branch | `git switch -c name` |
| Switch branch | `git switch main` |
| Merge branch | `git merge name` |
| History | `git log --oneline --graph --decorate` |
| Undo unstaged edit | `git restore file` |
| Unstage | `git restore --staged file` |
| Undo last commit, keep changes | `git reset --soft HEAD~1` |
| Tag a release | `git tag -a v1.0.0 -m "..."` + `git push origin v1.0.0` |
| Change remote URL | `git remote set-url origin <url>` |

Official references: <https://docs.github.com/get-started> and <https://git-scm.com/doc>.
