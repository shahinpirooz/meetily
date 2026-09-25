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
  if ! command -v cargo >/dev/null; then
    echo "FAIL Rust: cargo not found. Install Rust first: https://rustup.rs (then open a new terminal)"
    fail=1
  elif ! command -v cmake >/dev/null; then
    echo "FAIL Rust: cmake not found (needed to compile Whisper). macOS: brew install cmake"
    fail=1
  else
    # The app bundles a llama-helper sidecar that upstream's dev-gpu.sh /
    # build-gpu.sh compile first; tauri-build refuses to compile without it.
    triple=$(rustc -vV | awk '/^host:/ {print $2}')
    exe=""; case "$triple" in *windows*) exe=".exe";; esac
    sidecar="src-tauri/binaries/llama-helper-$triple$exe"
    if [ ! -f "$sidecar" ]; then
      feature=""
      case "$triple" in aarch64-apple-darwin) feature="--features metal";; esac
      echo "Building the llama-helper sidecar first ($triple ${feature:-cpu})..."
      if (cd ../llama-helper && cargo build $feature); then
        mkdir -p src-tauri/binaries && cp "../target/debug/llama-helper$exe" "$sidecar"
      else
        echo "FAIL Rust: llama-helper did not build"; fail=1
      fi
    fi
    if [ -f "$sidecar" ]; then
      echo "Compiling the Tauri app for the Rust tests (the first run takes 10-20 minutes)..."
      if (cd src-tauri && cargo test --lib rich_export); then echo "ok   Rust rich_export"; else echo "FAIL Rust"; fail=1; fi
    fi
  fi
fi

[ $fail -eq 0 ] && echo "ALL TESTS PASSED" || echo "SOME TESTS FAILED"
exit $fail
