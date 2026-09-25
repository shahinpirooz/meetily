// Fork addition: tests for rich-text export (copy as rich text / markdown, email).
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const invoked: Array<{ cmd: string; args: any }> = [];
mock.module("@tauri-apps/api/core", () => ({
  invoke: mock(async (cmd: string, args: any) => {
    invoked.push({ cmd, args });
    return undefined;
  }),
}));

const {
  markdownToEmailHtml,
  markdownToPlainText,
  normalizeListIndent,
} = await import("../../src/lib/rich-export/markdown-to-html");
const {
  buildEml,
  buildMailtoUrl,
  defaultEmailMode,
  draftFileName,
  encodeHeader,
} = await import("../../src/lib/rich-export/email");
const {
  composeSummaryDocument,
  emailSubject,
  getSummaryMarkdown,
} = await import("../../src/lib/rich-export/summary-document");
const actions = await import("../../src/lib/rich-export/actions");
const { copyRichText } = await import("../../src/lib/rich-export/clipboard");

const H = (md: string, bordered = false) => markdownToEmailHtml(md, { borderedTables: bordered });

// ------------------------------------------------------------------ markdown -> email HTML

describe("markdownToEmailHtml", () => {
  test("wraps output in an explicit font so Outlook doesn't fall back to Times", () => {
    const h = H("hello");
    expect(h.startsWith('<div style="font-family:Aptos, Calibri')).toBe(true);
    expect(h).toContain("font-size:11pt");
  });

  test.each([
    ["# Title", ">Title</h1>"],
    ["## Sub", "font-size:16pt"],
    ["a **b** c", "a <b>b</b> c"],
    ["a *b* c", "a <i>b</i> c"],
    ["a _b_ c", "a <i>b</i> c"],
    ["snake_case_name", "snake_case_name"],
    ["~~gone~~", "<s>gone</s>"],
    ["use `x < y`", ">x &lt; y</code>"],
    ["[site](https://a.com/x)", 'href="https://a.com/x" style="color:#0563C1;text-decoration:underline"'],
    ["see https://example.com now", 'href="https://example.com"'],
    ["- a\n- b", "<li style=\"margin:0\">a</li>"],
    ["3. a\n4. b", '<ol start="3"'],
    ["> quoted", "font-style:italic"],
    ["a\n\n---\n\nb", "<hr"],
    ["a <script>alert(1)</script> b", "a "],
  ])("%p renders %p", (md, needle) => {
    expect(H(md)).toContain(needle);
  });

  test("raw HTML is dropped, not injected", () => {
    const h = H("x <img src=x onerror=alert(1)> y\n\n<script>bad()</script>");
    expect(h).not.toContain("<script");
    expect(h).not.toContain("onerror");
  });

  test("code blocks keep indentation and get a mono font + background", () => {
    const h = H("```js\nlet a = 1;\n  b();\n```");
    expect(h).toContain("let a = 1;\n  b();</pre>");
    expect(h).toContain("background:#F2F2F2");
    expect(h).toContain("font-family:Consolas");
  });

  test("nested lists: margin only on the outer list", () => {
    const h = H("- a\n  - b\n- c");
    expect(h).toContain('<ul style="margin:0 0 8pt 0;padding-left:24pt">');
    expect(h).toContain('<ul style="margin:0;padding-left:24pt">');
  });

  test("lenient nesting: 2 spaces under '1.' still nests", () => {
    const h = H("1. a\n  - b\n2. c");
    expect(h).toMatch(/a\s*<ul[^>]*>\s*<li[^>]*>b<\/li>\s*<\/ul>\s*<\/li>/);
    expect(h).toContain(">c</li>");
  });

  test("task lists render as checkbox glyphs, not form inputs", () => {
    const h = H("- [x] done\n- [ ] todo");
    expect(h).not.toContain("<input");
    expect(h).toContain("☑");
    expect(h).toContain("☐");
  });

  test("tables default to pipe-delimited lines (safe in every app)", () => {
    const h = H("| A | B |\n|---|---|\n| 1 | **2** |");
    expect(h).toContain("<b>A | B</b><br/>----------<br/>1 | 2</p>");
    expect(h).not.toContain("<table");
  });

  test("bordered tables are opt-in and keep alignment", () => {
    const h = H("| A | B |\n|:--|--:|\n| 1 | **2** |", true);
    expect(h).toContain("<table");
    expect(h).toContain("border-collapse:collapse");
    expect(h).toContain("<b>2</b></td>");
    expect(h).toContain("text-align:right");
  });

  test("BlockNote-style loose lists and escapes", () => {
    const md = "## Action Items\n\n*   Send the deck\n\n*   Book \\*follow-up\\*\n\n    *   with legal\n";
    const h = H(md);
    expect(h).toContain(">Send the deck");
    expect(h).toContain("Book *follow-up*");
    expect(h).toMatch(/with legal/);
  });
});

describe("normalizeListIndent", () => {
  test.each([
    ["1. a\n  - b\n    - c\n2. d", "1. a\n   - b\n     - c\n2. d"],
    ["10. a\n  - b", "10. a\n    - b"],
    ["- a\n  - b", "- a\n  - b"],
    ["```\n1. a\n  - b\n```", "```\n1. a\n  - b\n```"],
  ])("%p", (input, expected) => {
    expect(normalizeListIndent(input)).toBe(expected);
  });
});

describe("markdownToPlainText", () => {
  test("strips markup into readable text", () => {
    const t = markdownToPlainText(
      "# Title\n\n**Date:** today\n\n- one\n- [x] done\n\n[site](https://a.com) and `code`\n\n| A | B |\n|---|---|\n| 1 | 2 |",
    );
    expect(t).toBe("Title\n\nDate: today\n\n• one\n☑ done\n\nsite (https://a.com) and code\n\nA | B\n1 | 2\n");
  });

  test("keeps code blocks verbatim", () => {
    expect(markdownToPlainText("```\n**not bold**\n```")).toBe("**not bold**\n");
  });
});

// ------------------------------------------------------------------ summary document

describe("summary document", () => {
  test("adds title and date header", () => {
    const md = composeSummaryDocument({
      title: "Weekly Sync",
      createdAt: "2026-09-24T17:00:00Z",
      summaryMarkdown: "## Notes\n\n- a",
    });
    expect(md.startsWith("# Weekly Sync\n\n**Date:** September")).toBe(true);
    expect(md.endsWith("## Notes\n\n- a\n")).toBe(true);
  });

  test("keeps the summary's own H1 instead of adding a second title", () => {
    const md = composeSummaryDocument({ title: "X", createdAt: "bad date", summaryMarkdown: "# Own Title\n\nBody" });
    expect(md).toBe("# Own Title\n\nBody\n");
  });

  test("source order: editor, stored markdown, legacy sections", async () => {
    expect(await getSummaryMarkdown({ getMarkdown: async () => "from editor" }, { markdown: "stored" } as any))
      .toBe("from editor");
    expect(await getSummaryMarkdown({ getMarkdown: async () => "  " }, { markdown: "stored" } as any)).toBe("stored");
    expect(await getSummaryMarkdown({ getMarkdown: async () => { throw new Error("x"); } }, { markdown: "stored" } as any))
      .toBe("stored");
    const legacy = { KeyPoints: { title: "Key Points", blocks: [{ content: "one" }, { content: "two" }] } };
    expect(await getSummaryMarkdown(null, legacy as any)).toBe("## Key Points\n\n- one\n- two");
    expect(await getSummaryMarkdown(null, null)).toBe("");
  });

  test("email subject", () => {
    expect(emailSubject("Board prep")).toBe("Meeting summary: Board prep");
    expect(emailSubject("  ")).toBe("Meeting summary");
  });
});

// ------------------------------------------------------------------ email

describe("email", () => {
  test("mailto uses %20 and CRLF and keeps @ readable", () => {
    expect(buildMailtoUrl({ to: "a@b.com", subject: "Hi there & more", body: "l1\nl2" }))
      .toBe("mailto:a@b.com?subject=Hi%20there%20%26%20more&body=l1%0D%0Al2");
    expect(buildMailtoUrl({ subject: "x" })).toBe("mailto:?subject=x");
  });

  test("header encoding", () => {
    expect(encodeHeader("Plain subject")).toBe("Plain subject");
    expect(encodeHeader("Réunion — notes")).toBe("=?UTF-8?B?UsOpdW5pb24g4oCUIG5vdGVz?=");
    expect(encodeHeader("inject\r\nBcc: x@y.z")).toBe("inject Bcc: x@y.z");
  });

  test(".eml is an unsent multipart/alternative draft that decodes back", () => {
    const eml = buildEml(
      { subject: "Meeting summary: Café", html: "<b>Hé</b>", plain: "Hé", date: new Date("2026-09-24T17:00:00Z") },
      "BOUNDARY",
    );
    expect(eml).toContain("X-Unsent: 1\r\n");
    expect(eml).toContain('Content-Type: multipart/alternative; boundary="BOUNDARY"');
    expect(eml).toContain("Subject: =?UTF-8?B?");
    expect(eml.endsWith("--BOUNDARY--\r\n")).toBe(true);
    expect(eml.split("\r\n").every(l => l.length <= 998)).toBe(true);
    const parts = eml.split("--BOUNDARY");
    const decode = (part: string) => Buffer.from(part.split("\r\n\r\n")[1].replace(/\s+/g, ""), "base64").toString("utf8");
    expect(decode(parts[1])).toBe("Hé");
    expect(decode(parts[2])).toContain("<body><b>Hé</b></body>");
  });

  test("long bodies wrap base64 at 76 columns", () => {
    const eml = buildEml({ subject: "s", html: "x".repeat(5000), plain: "y".repeat(5000) }, "B");
    const b64Lines = eml.split("\r\n").filter(l => /^[A-Za-z0-9+/=]+$/.test(l) && l.length > 20);
    expect(b64Lines.length).toBeGreaterThan(50);
    expect(Math.max(...b64Lines.map(l => l.length))).toBe(76);
  });

  test("draft file names are safe", () => {
    expect(draftFileName("Meeting summary: Q3/Q4 <plan>")).toBe("Meeting summary Q3 Q4 plan .eml".replace(" .eml", ".eml"));
    expect(draftFileName("")).toBe("Meeting summary.eml");
  });

  test("default mode per platform", () => {
    expect(defaultEmailMode("windows")).toBe("draft");
    expect(defaultEmailMode("macos")).toBe("paste");
    expect(defaultEmailMode("linux")).toBe("paste");
  });
});

// ------------------------------------------------------------------ actions (clipboard + Tauri calls)

describe("export actions", () => {
  let written: Array<Record<string, string>> = [];
  let origNavigator: any;

  beforeEach(() => {
    invoked.length = 0;
    written = [];
    origNavigator = (globalThis as any).navigator;
    (globalThis as any).ClipboardItem = class {
      constructor(public items: Record<string, Promise<Blob>>) {}
    };
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        userAgent: "test",
        clipboard: {
          write: async (items: any[]) => {
            const out: Record<string, string> = {};
            for (const [type, blob] of Object.entries(items[0].items)) out[type] = await (await (blob as Promise<Blob>)).text();
            written.push(out);
          },
          writeText: async (t: string) => { written.push({ "text/plain": t }); },
        },
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: origNavigator });
    delete (globalThis as any).ClipboardItem;
  });

  const ctx = (md = "## Notes\n\n- **one**\n- two") => ({
    editor: { getMarkdown: async () => md },
    aiSummary: null,
    meetingTitle: "Weekly Sync",
    createdAt: "2026-09-24T17:00:00Z",
  });

  test("copy as rich text writes HTML + plain text together", async () => {
    await actions.copySummaryAsRichText(ctx());
    expect(written).toHaveLength(1);
    expect(written[0]["text/html"]).toContain(">Weekly Sync</h1>");
    expect(written[0]["text/html"]).toContain("<li style=\"margin:0\"><b>one</b></li>");
    expect(written[0]["text/plain"]).toContain("• one");
  });

  test("copy as markdown writes the markdown document", async () => {
    await actions.copySummaryAsMarkdown(ctx());
    expect(written[0]["text/plain"]).toStartWith("# Weekly Sync\n\n**Date:**");
    expect(written[0]["text/plain"]).toContain("- **one**");
  });

  test("no summary -> NoSummaryError, clipboard untouched", async () => {
    await expect(actions.copySummaryAsRichText(ctx("   "))).rejects.toBeInstanceOf(actions.NoSummaryError);
    await expect(actions.copySummaryAsMarkdown(ctx(""))).rejects.toBeInstanceOf(actions.NoSummaryError);
  });

  test("email draft mode: rich text on clipboard + .eml opened via Tauri", async () => {
    await actions.emailSummary(ctx(), "draft");
    expect(written[0]["text/html"]).toContain("<b>one</b>");
    expect(invoked).toHaveLength(1);
    expect(invoked[0].cmd).toBe("rich_export_open_eml");
    expect(invoked[0].args.fileName).toBe("Meeting summary Weekly Sync.eml");
    expect(invoked[0].args.eml).toContain("X-Unsent: 1");
    expect(invoked[0].args.eml).toContain("Subject: Meeting summary: Weekly Sync");
  });

  test("email paste mode: rich text on clipboard + mailto with subject", async () => {
    await actions.emailSummary(ctx(), "paste");
    expect(written[0]["text/html"]).toContain("<b>one</b>");
    expect(invoked).toEqual([
      { cmd: "rich_export_open_mailto", args: { url: "mailto:?subject=Meeting%20summary%3A%20Weekly%20Sync" } },
    ]);
  });

  test("falls back to execCommand when ClipboardItem write fails", async () => {
    (globalThis as any).navigator.clipboard.write = async () => { throw new Error("denied"); };
    const events: Record<string, string> = {};
    const listeners: any[] = [];
    (globalThis as any).window = { getSelection: () => ({ removeAllRanges() {}, addRange() {} }) };
    (globalThis as any).document = {
      body: { appendChild() {} },
      createElement: () => ({ style: {}, remove() {} }),
      createRange: () => ({ selectNodeContents() {} }),
      addEventListener: (_: string, fn: any) => listeners.push(fn),
      removeEventListener: () => {},
      execCommand: () => {
        listeners.forEach(fn => fn({ clipboardData: { setData: (t: string, v: string) => (events[t] = v) }, preventDefault() {} }));
        return true;
      },
    };
    try {
      await copyRichText({ html: "<b>x</b>", plain: "x" });
      expect(events).toEqual({ "text/html": "<b>x</b>", "text/plain": "x" });
    } finally {
      delete (globalThis as any).document;
      delete (globalThis as any).window;
    }
  });
});
