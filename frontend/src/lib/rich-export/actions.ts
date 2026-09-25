/**
 * The three summary export actions behind the fork's buttons, free of React
 * so they can be tested directly: copy as rich text, copy as markdown, and
 * send by email.
 */
import type { MeetingSummary } from '@/types';
import { copyPlainText, copyRichText } from './clipboard';
import { EmailMode, openEmail } from './email';
import type { RichTextOptions } from './markdown-to-html';
import { composeSummaryDocument, emailSubject, getSummaryMarkdown, SummaryMarkdownSource } from './summary-document';

export interface ExportContext {
  editor: SummaryMarkdownSource | null | undefined;
  aiSummary: MeetingSummary | null;
  meetingTitle: string;
  createdAt?: string;
  options?: RichTextOptions;
}

// The renderer (react-markdown + react-dom/server) loads on first use, so the
// meeting page doesn't grow by ~100 KB for users who never export.
const renderer = () => import('./markdown-to-html');
const toHtml = async (md: string, opts?: RichTextOptions) => (await renderer()).markdownToEmailHtml(md, opts);
const toPlain = async (md: string) => (await renderer()).markdownToPlainText(md);

export class NoSummaryError extends Error {
  constructor() {
    super('No summary content available');
  }
}

export async function buildSummaryDocument(ctx: ExportContext): Promise<string> {
  const summary = await getSummaryMarkdown(ctx.editor, ctx.aiSummary);
  if (!summary) throw new NoSummaryError();
  return composeSummaryDocument({ title: ctx.meetingTitle, createdAt: ctx.createdAt, summaryMarkdown: summary });
}

export async function copySummaryAsRichText(ctx: ExportContext): Promise<void> {
  // Start the clipboard write synchronously (inside the click) with pending
  // values, so WebKit keeps the user gesture while the markdown is fetched.
  const doc = buildSummaryDocument(ctx);
  await copyRichText({
    html: doc.then(md => toHtml(md, ctx.options)),
    plain: doc.then(md => toPlain(md)),
  });
}

export async function copySummaryAsMarkdown(ctx: ExportContext): Promise<void> {
  await copyPlainText(buildSummaryDocument(ctx));
}

/**
 * Sends the summary by email. The formatted summary always goes on the
 * clipboard first, so the user can paste it even if the mail app ignores
 * the draft's body.
 */
export async function emailSummary(ctx: ExportContext, mode: EmailMode): Promise<void> {
  const docPromise = buildSummaryDocument(ctx);
  const htmlPromise = docPromise.then(md => toHtml(md, ctx.options));
  const plainPromise = docPromise.then(md => toPlain(md));
  await copyRichText({ html: htmlPromise, plain: plainPromise });
  const [html, plain] = await Promise.all([htmlPromise, plainPromise]);
  await openEmail({ subject: emailSubject(ctx.meetingTitle), html, plain }, mode);
}
