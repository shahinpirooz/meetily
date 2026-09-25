"use client";

/**
 * Fork addition: rich-text export for meeting summaries.
 *
 *  [ Copy as ▾ ]   Rich text (formatted) | Markdown | [x] Bordered tables
 *  [ Email  ▾ ]    Formatted draft (.eml) | New message + paste
 *
 * Lives in its own file (plus one line in SummaryPanel.tsx) so merges from
 * upstream Meetily rarely conflict.
 */
import { RefObject, useCallback, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, ClipboardCopy, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { MeetingSummary } from '@/types';
import type { BlockNoteSummaryViewRef } from '@/components/AISummary/BlockNoteSummaryView';
import Analytics from '@/lib/analytics';
import {
  copySummaryAsMarkdown,
  copySummaryAsRichText,
  emailSummary,
  EmailMode,
  ExportContext,
  loadEmailMode,
  NoSummaryError,
  saveEmailMode,
} from '@/lib/rich-export';

const TABLES_KEY = 'meetily.richExport.borderedTables';

function loadBorderedTables(): boolean {
  try {
    return globalThis.localStorage?.getItem(TABLES_KEY) === '1';
  } catch {
    return false;
  }
}

const pasteKey = () =>
  typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent) ? '⌘V' : 'Ctrl+V';

interface SummaryExportButtonsProps {
  summaryRef: RefObject<BlockNoteSummaryViewRef>;
  aiSummary: MeetingSummary | null;
  meetingTitle: string;
  meeting: { id: string; created_at: string };
}

export function useSummaryExport({ summaryRef, aiSummary, meetingTitle, meeting }: SummaryExportButtonsProps) {
  const [borderedTables, setBorderedTables] = useState<boolean>(loadBorderedTables);
  const [emailMode, setEmailMode] = useState<EmailMode>(loadEmailMode);
  const [busy, setBusy] = useState(false);

  const ctx = useCallback((): ExportContext => ({
    editor: summaryRef.current,
    aiSummary,
    meetingTitle,
    createdAt: meeting.created_at,
    options: { borderedTables },
  }), [summaryRef, aiSummary, meetingTitle, meeting.created_at, borderedTables]);

  const run = useCallback(async (name: string, action: () => Promise<void>, success: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      Analytics.trackButtonClick(name, 'meeting_details');
    } catch (err) {
      if (err instanceof NoSummaryError) {
        toast.error('No summary content available');
      } else {
        console.error(`[rich-export] ${name} failed`, err);
        toast.error(`${name === 'email_summary' ? 'Could not open email' : 'Copy failed'}: ${(err as Error)?.message ?? err}`);
      }
    } finally {
      setBusy(false);
    }
  }, []);

  const copyRich = useCallback(
    () => run('copy_summary_rich_text', () => copySummaryAsRichText(ctx()),
      `Summary copied as rich text. Paste with ${pasteKey()} into Outlook, Word, Mail or Teams.`),
    [run, ctx]);

  const copyMarkdown = useCallback(
    () => run('copy_summary_markdown', () => copySummaryAsMarkdown(ctx()), 'Summary copied as markdown'),
    [run, ctx]);

  const sendEmail = useCallback((mode: EmailMode = emailMode) => {
    if (mode !== emailMode) {
      setEmailMode(mode);
      saveEmailMode(mode);
    }
    return run('email_summary', () => emailSummary(ctx(), mode),
      mode === 'draft'
        ? 'Email draft opened. The summary is also on the clipboard.'
        : `New email opened. Press ${pasteKey()} in the message body to paste the summary.`);
  }, [run, ctx, emailMode]);

  const toggleBorderedTables = useCallback((value: boolean) => {
    setBorderedTables(value);
    try {
      globalThis.localStorage?.setItem(TABLES_KEY, value ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  }, []);

  return { busy, borderedTables, emailMode, copyRich, copyMarkdown, sendEmail, toggleBorderedTables };
}

export function SummaryExportButtons(props: SummaryExportButtonsProps) {
  const { busy, borderedTables, emailMode, copyRich, copyMarkdown, sendEmail, toggleBorderedTables } =
    useSummaryExport(props);

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" title="Copy summary as rich text or markdown" disabled={busy}
            className="cursor-pointer" data-testid="summary-copy-as">
            <ClipboardCopy />
            <span className="hidden @[40rem]:inline">Copy as</span>
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={copyRich} data-testid="summary-copy-rich">
            Rich text (formatted)
          </DropdownMenuItem>
          <DropdownMenuItem onClick={copyMarkdown} data-testid="summary-copy-markdown">
            Markdown
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={borderedTables}
            onCheckedChange={v => toggleBorderedTables(!!v)}
            onSelect={e => e.preventDefault()}
            title="Off: tables paste as “A | B | C” lines, which look the same in every app. On: real bordered tables."
          >
            Bordered tables
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ButtonGroup>
        <Button variant="outline" size="sm" disabled={busy} className="cursor-pointer"
          title={emailMode === 'draft' ? 'Open a formatted email draft' : 'Open a new email and paste the summary'}
          onClick={() => sendEmail()} data-testid="summary-email">
          <Mail />
          <span className="hidden @[40rem]:inline">Email</span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={busy} className="cursor-pointer px-1.5"
              title="Email options" data-testid="summary-email-options">
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Send summary by email</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => sendEmail('draft')}>
              {emailMode === 'draft' ? '✓ ' : ''}Formatted draft (Outlook, Thunderbird)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => sendEmail('paste')}>
              {emailMode === 'paste' ? '✓ ' : ''}New message, paste summary (any mail app)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ButtonGroup>
    </div>
  );
}
