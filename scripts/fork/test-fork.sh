#!/usr/bin/env bash
# Fork regression tests: every frontend test file (run one file at a time,
# because the suite's module mocks leak across files when run together),
# the node test, TypeScript, and the fork's Rust unit tests.
#   scripts/fork/test-fork.sh           frontend tests + type check
#   scripts/fork/test-fork.sh --rust    also cargo test rich_export (compiles the whole Tauri app)
set -uo pipefail
cd "$(dirname "$0")/../../frontend"

fail=0
command -v bun >/dev/null || { echo "bun is required: npm i -g bun"; exit 1; }
[ -d node_modules ] || pnpm install --frozen-lockfile

for f in $(find tests -name '*.test.*' ! -name '*.mjs' | sort); do
  out=$(bun test "$f" 2>&1)
  summary=$(echo "$out" | grep -E '^ [0-9]+ (pass|fail)' | tr '\n' ' ')
  if echo "$out" | grep -qE '^ [1-9][0-9]* fail'; then
    echo "FAIL $f: $summary"; echo "$out" | grep -E '^\(fail\)|error:' | head -20; fail=1
  else
    echo "ok   $f: $summary"
  fi
done

for f in $(find tests -name '*.test.mjs' | sort); do
  if node --test "$f" >/dev/null 2>&1; then echo "ok   $f"; else echo "FAIL $f"; fail=1; fi
done

if npx tsc --noEmit -p .; then echo "ok   TypeScript"; else echo "FAIL TypeScript"; fail=1; fi

if [ "${1:-}" = "--rust" ]; then
  if (cd src-tauri && cargo test --lib rich_export); then echo "ok   Rust rich_export"; else echo "FAIL Rust"; fail=1; fi
fi

[ $fail -eq 0 ] && echo "ALL TESTS PASSED" || echo "SOME TESTS FAILED"
exit $fail
