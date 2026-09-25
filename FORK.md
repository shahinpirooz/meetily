# Meetily fork: rich-text export

This fork of [Zackriya-Solutions/meetily](https://github.com/Zackriya-Solutions/meetily)
adds rich-text export to the meeting summary. Everything else is upstream Meetily.

## What it adds

In a meeting's **Summary** panel, next to Save and Copy:

- **Copy as ▾**
  - **Rich text (formatted)**: puts HTML and plain text on the clipboard, so
    pasting into Outlook, Word, Apple Mail, Teams, OneNote or Gmail keeps the
    headings, bold, lists, links, quotes and code.
  - **Markdown**: the same document as markdown source.
  - **Bordered tables** (off by default): off pastes tables as `A | B | C`
    lines, which look the same in every app; on pastes real bordered tables.
- **Email ▾**
  - **Formatted draft**: opens an unsent email (.eml) with the formatted
    summary in the body. Classic Outlook for Windows and Thunderbird open it
    ready to send. Default on Windows.
  - **New message, paste summary**: opens a new email with the subject
    filled in; the formatted summary is already on the clipboard, so press
    Ctrl+V / ⌘V in the body. Works with every mail app (Apple Mail, new
    Outlook, Gmail in a browser). Default on macOS and Linux.
  - The choice is remembered. Both modes also put the formatted summary on
    the clipboard.

## Files the fork touches

New files (never conflict with upstream):

| File | Purpose |
| --- | --- |
| `frontend/src/lib/rich-export/*` | Markdown to email-safe HTML, clipboard, .eml / mailto, actions |
| `frontend/src/components/MeetingDetails/SummaryExportButtons.tsx` | The Copy as / Email buttons |
| `frontend/src-tauri/src/rich_export.rs` | Opens the .eml draft or mailto link with the default mail app |
| `frontend/tests/lib/rich-export.test.tsx`, `frontend/tests/components/summary-export-buttons.test.tsx` | Tests |
| `scripts/fork/*`, `.github/workflows/fork-sync-upstream.yml`, `FORK.md` | Fork maintenance |

Small insertions into upstream files (the only possible merge conflicts),
each marked `fork`:

| File | Change |
| --- | --- |
| `frontend/src/components/MeetingDetails/SummaryPanel.tsx` | 1 import + render `<SummaryExportButtons>` |
| `frontend/src-tauri/src/lib.rs` | `pub mod rich_export;` + 2 lines in `generate_handler!` |

If upstream reorganizes those two spots, re-add the marked lines where the
equivalent code now lives.

## Branches

- `main`: an exact mirror of upstream. Never commit to it.
- `rich-export`: upstream plus the fork's commits. The repo's default branch,
  and the one you build from.

## Staying current with upstream

**Automatic (weekly):** `.github/workflows/fork-sync-upstream.yml`
fast-forwards `main`, merges it into a `sync/upstream-<version>` branch, runs
the fork tests, and opens a pull request into `rich-export`. Merge it when it
says tests passed. It needs the `SYNC_TOKEN` secret (see setup below).

**Manual, any time:**

```bash
scripts/fork/sync-upstream.sh          # fast-forward main, merge into rich-export, test, push
```

If git reports conflicts, fix the listed files (keep upstream's changes and
re-add the `fork` lines), then `git add … && git commit && scripts/fork/test-fork.sh && git push`.

## Tests

```bash
scripts/fork/test-fork.sh            # all frontend tests (file by file) + TypeScript
scripts/fork/test-fork.sh --rust     # + Rust unit tests for rich_export.rs (compiles the app)
```

## Building

Follow upstream's `docs/BUILDING.md`, from the `rich-export` branch:

```bash
cd frontend
pnpm install --frozen-lockfile
pnpm run tauri:build        # or tauri:dev to run in development
```

## Giving it back

The fork is small and self-contained. If upstream accepts it as a pull
request, the fork is no longer needed.
