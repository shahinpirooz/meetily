// Fork addition: the export buttons render and wire the right actions.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { act, create } from "react-test-renderer";

const calls: string[] = [];
const toasts: string[] = [];

mock.module("sonner", () => ({
  toast: {
    success: (m: string) => toasts.push(`ok:${m}`),
    error: (m: string) => toasts.push(`err:${m}`),
  },
}));
mock.module("@/lib/analytics", () => ({
  default: { trackButtonClick: async (name: string) => calls.push(`analytics:${name}`) },
}));
mock.module("@/lib/rich-export", () => {
  class NoSummaryError extends Error {}
  return {
    NoSummaryError,
    copySummaryAsRichText: async (ctx: any) => { calls.push(`rich:${ctx.meetingTitle}:${ctx.options.borderedTables}`); },
    copySummaryAsMarkdown: async () => { calls.push("markdown"); },
    emailSummary: async (_ctx: any, mode: string) => {
      if (mode === "fail") throw new Error("no mail app");
      calls.push(`email:${mode}`);
    },
    loadEmailMode: () => "draft",
    saveEmailMode: (m: string) => calls.push(`save:${m}`),
  };
});

// Radix menus need a DOM; render them as plain containers (always open).
mock.module("@/components/ui/dropdown-menu", () => {
  const Pass = ({ children }: any) => <div>{children}</div>;
  const Item = ({ children, onClick, ...rest }: any) => <div data-menuitem {...rest} onClick={onClick}>{children}</div>;
  const Check = ({ children, checked, onCheckedChange }: any) => (
    <div data-menucheck data-checked={String(checked)} onClick={() => onCheckedChange(!checked)}>{children}</div>
  );
  return {
    DropdownMenu: Pass, DropdownMenuTrigger: Pass, DropdownMenuContent: Pass,
    DropdownMenuItem: Item, DropdownMenuCheckboxItem: Check,
    DropdownMenuLabel: Pass, DropdownMenuSeparator: () => <hr />,
  };
});

const { SummaryExportButtons } = await import("../../src/components/MeetingDetails/SummaryExportButtons");

const props = {
  summaryRef: { current: { getMarkdown: async () => "x" } } as any,
  aiSummary: null,
  meetingTitle: "Weekly Sync",
  meeting: { id: "m1", created_at: "2026-09-24T17:00:00Z" },
};

async function render() {
  let r: any;
  await act(async () => {
    r = create(<SummaryExportButtons {...props} />);
  });
  return r;
}

describe("SummaryExportButtons", () => {
  beforeEach(() => {
    calls.length = 0;
    toasts.length = 0;
  });

  test("renders Copy as and Email controls", async () => {
    const r = await render();
    const ids = r.root.findAll((n: any) => typeof n.props["data-testid"] === "string").map((n: any) => n.props["data-testid"]);
    expect(ids).toContain("summary-copy-as");
    expect(ids).toContain("summary-email");
    expect(ids).toContain("summary-email-options");
  });

  test("Email button uses the saved mode and reports success", async () => {
    const r = await render();
    const btn = r.root.find((n: any) => n.props["data-testid"] === "summary-email" && typeof n.props.onClick === "function");
    await act(async () => { await btn.props.onClick(); });
    expect(calls).toEqual(["email:draft", "analytics:email_summary"]);
    expect(toasts[0]).toStartWith("ok:Email draft opened");
  });

  test("Copy as > Rich text / Markdown call the right actions", async () => {
    const r = await render();
    const rich = r.root.find((n: any) => n.props["data-testid"] === "summary-copy-rich" && n.props["data-menuitem"]);
    const md = r.root.find((n: any) => n.props["data-testid"] === "summary-copy-markdown" && n.props["data-menuitem"]);
    await act(async () => { await rich.props.onClick(); });
    await act(async () => { await md.props.onClick(); });
    expect(calls).toEqual([
      "rich:Weekly Sync:false", "analytics:copy_summary_rich_text",
      "markdown", "analytics:copy_summary_markdown",
    ]);
    expect(toasts[0]).toContain("copied as rich text");
  });

  test("Bordered tables toggle is passed to the export", async () => {
    const r = await render();
    const toggle = r.root.find((n: any) => n.props["data-menucheck"]);
    await act(async () => { toggle.props.onClick(); });
    const rich = r.root.find((n: any) => n.props["data-testid"] === "summary-copy-rich" && n.props["data-menuitem"]);
    await act(async () => { await rich.props.onClick(); });
    expect(calls[0]).toBe("rich:Weekly Sync:true");
  });

  test("choosing the other email mode remembers it", async () => {
    const r = await render();
    const items = r.root.findAll((n: any) => n.props["data-menuitem"] && typeof n.props.children !== "undefined");
    const paste = items.find((n: any) => JSON.stringify(n.props.children).includes("New message"));
    await act(async () => { await paste.props.onClick(); });
    expect(calls).toEqual(["save:paste", "email:paste", "analytics:email_summary"]);
    expect(toasts[0]).toContain("paste the summary");
  });
});
