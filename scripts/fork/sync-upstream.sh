#!/usr/bin/env bash
# Pull the latest upstream Meetily into this fork, locally.
#   1. fast-forwards your "main" to upstream/main (main stays a clean mirror)
#   2. merges main into your feature branch (default: rich-export)
#   3. runs the fork's tests
# If the merge conflicts, git stops and lists the files; fix them, then
# "git add <files> && git commit" and run scripts/fork/test-fork.sh.
set -euo pipefail
BRANCH="${1:-rich-export}"
UPSTREAM_URL="https://github.com/Zackriya-Solutions/meetily.git"

cd "$(git rev-parse --show-toplevel)"
if [ -n "$(git status --porcelain)" ]; then
  echo "You have uncommitted changes. Commit or stash them first."; exit 1
fi
git remote get-url upstream >/dev/null 2>&1 || git remote add upstream "$UPSTREAM_URL"

git fetch upstream --tags
git fetch origin

# A fresh clone of the fork (default branch rich-export) has no local main,
# and "git checkout main" would be ambiguous between origin and upstream.
git show-ref --verify --quiet refs/heads/main || git branch --track main origin/main
git checkout main
git merge --ff-only upstream/main
git push origin main

git show-ref --verify --quiet "refs/heads/$BRANCH" || git branch --track "$BRANCH" "origin/$BRANCH"
git checkout "$BRANCH"
if ! git merge --no-edit main; then
  echo
  echo "Merge conflicts in:"; git diff --name-only --diff-filter=U
  echo "Resolve them, then: git add <files> && git commit && scripts/fork/test-fork.sh && git push"
  exit 1
fi

scripts/fork/test-fork.sh
git push origin "$BRANCH"
echo "Synced $BRANCH with upstream $(git describe --tags --abbrev=0 upstream/main 2>/dev/null || echo main)."
