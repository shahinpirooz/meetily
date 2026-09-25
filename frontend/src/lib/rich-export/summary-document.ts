/**
 * Builds the markdown document that rich-text copy and email send (fork
 * addition). Mirrors the upstream "Copy" button's sources so all exports
 * contain the same summary: the editor's current markdown, then the stored
 * markdown, then the legacy section format.
 */
import type { MeetingSummary } from '@/types';

export interface SummaryMarkdownSource {
  getMarkdown?: () => Promise<string>;
}

export async function getSummaryMarkdown(
  editor: SummaryMarkdownSource | null | undefined,
  aiSummary: MeetingSummary | null,
): Promise<string> {
  let md = '';
  if (editor?.getMarkdown) {
    try {
      md = (await editor.getMarkdown()) || '';
    } catch (err) {
      console.warn('[rich-export] editor markdown failed, using stored summary', err);
    }
  }
  if (!md.trim() && aiSummary && typeof (aiSummary as any).markdown === 'string') {
    md = (aiSummary as any).markdown;
  }
  if (!md.trim() && aiSummary) {
    md = Object.entries(aiSummary)
      .filter(([key]) => !['markdown', 'summary_json', '_section_order', 'MeetingName'].includes(key))
      .map(([, section]: [string, any]) => {
        if (section && typeof section === 'object' && 'title' in section && Array.isArray(section.blocks)) {
          return `## ${section.title}\n\n` + section.blocks.map((b: any) => `- ${b.content}`).join('\n');
        }
        return '';
      })
      .filter(s => s.trim())
      .join('\n\n');
  }
  return md.trim();
}

export function formatMeetingDate(createdAt: string | undefined, locale = 'en-US'): string {
  if (!createdAt) return '';
  const d = new Date(createdAt);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Title + date header, then the summary. If the summary already starts with a
 * top-level heading, that heading is kept and no second title is added.
 */
export function composeSummaryDocument(opts: {
  title: string;
  createdAt?: string;
  summaryMarkdown: string;
}): string {
  const summary = opts.summaryMarkdown.trim();
  const date = formatMeetingDate(opts.createdAt);
  const hasOwnTitle = /^#\s+\S/.test(summary);
  const header = hasOwnTitle ? '' : `# ${opts.title || 'Meeting Summary'}\n\n`;
  const meta = date ? `**Date:** ${date}\n\n` : '';
  if (hasOwnTitle) {
    const firstBreak = summary.indexOf('\n');
    const titleLine = firstBreak === -1 ? summary : summary.slice(0, firstBreak);
    const rest = firstBreak === -1 ? '' : summary.slice(firstBreak + 1).trimStart();
    return `${titleLine}\n\n${meta}${rest}`.trim() + '\n';
  }
  return `${header}${meta}${summary}`.trim() + '\n';
}

export function emailSubject(title: string): string {
  const t = (title || '').trim();
  return t ? `Meeting summary: ${t}` : 'Meeting summary';
}
