/**
 * Markdown -> email-safe rich text (HTML with inline styles) and plain text.
 *
 * Fork addition (rich-text export). Ported from the MD2RT converter, keeping
 * its paste-target lessons:
 *  - every style is inline, because mail clients strip <style> blocks
 *  - text gets an explicit font, because Word/Outlook fall back to Times New
 *    Roman for unstyled pasted HTML
 *  - tables default to pipe-delimited monospaced lines ("A | B | C"), which
 *    look the same in every app; real bordered tables are opt-in
 *  - lists nested 2 spaces under "1." are treated as nested (LLM output often
 *    does this even though CommonMark wants 3)
 *
 * Parsing uses react-markdown + remark-gfm, which Meetily already ships.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

export interface RichTextOptions {
  /** Real bordered tables instead of pipe-delimited lines. Default false. */
  borderedTables?: boolean;
}

export const RICH_STYLE = {
  bodyFont: "Aptos, Calibri, 'Segoe UI', -apple-system, 'Helvetica Neue', Arial, sans-serif",
  monoFont: "Consolas, Menlo, 'Cascadia Mono', 'SF Mono', 'Courier New', monospace",
  bodyPt: 11,
  codePt: 10,
  headingPt: [20, 16, 14, 12, 11, 11],
  linkColor: '#0563C1',
  codeBackground: '#F2F2F2',
  quoteColor: '#595959',
  borderColor: '#BFBFBF',
  headerBackground: '#F2F2F2',
} as const;

const S = RICH_STYLE;
const pt = (v: number) => `${v}pt`;

// ------------------------------------------------------------------ leniency

const LIST_RE = /^( *)([-*+]|\d{1,9}[.)])( +)(?=\S)/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Shifts list items that sit between a parent's marker and its content column
 * over to the content column, so "1. a\n  - b" nests like people expect.
 */
export function normalizeListIndent(markdown: string): string {
  const out: string[] = [];
  let stack: Array<[number, number]> = []; // [markerIndent, contentIndent]
  let shiftFrom: number | null = null;
  let delta = 0;
  let inFence: string | null = null;

  for (let line of markdown.split('\n')) {
    const fm = FENCE_RE.exec(line);
    if (inFence) {
      if (fm && fm[1][0] === inFence) inFence = null;
      out.push(line);
      continue;
    }
    if (fm) inFence = fm[1][0];
    if (!line.trim()) {
      out.push(line);
      continue;
    }
    const indent = line.length - line.replace(/^ +/, '').length;
    if (shiftFrom !== null && indent < shiftFrom) {
      shiftFrom = null;
      delta = 0;
    }
    const m = LIST_RE.exec(line);
    if (m) {
      while (stack.length && indent <= stack[stack.length - 1][0] && !(shiftFrom !== null && indent >= shiftFrom)) {
        stack.pop();
      }
      let eff = indent + (shiftFrom !== null ? delta : 0);
      const top = stack[stack.length - 1];
      if (top && top[0] < eff && eff < top[1]) {
        shiftFrom = indent;
        delta = top[1] - indent;
        eff = indent + delta;
      }
      stack.push([eff, eff + m[2].length + Math.min(m[3].length, 4)]);
      if (shiftFrom !== null && indent >= shiftFrom) line = ' '.repeat(delta) + line;
    } else if (shiftFrom !== null && indent >= shiftFrom) {
      line = ' '.repeat(delta) + line;
    } else if (indent < 2) {
      stack = [];
    }
    out.push(line);
  }
  return out.join('\n');
}

// ------------------------------------------------------------------ hast helpers

type HastNode = { type: string; tagName?: string; value?: string; children?: HastNode[] };

function hastText(node: HastNode | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.value ?? '';
  if (node.tagName === 'br') return ' ';
  return (node.children ?? []).map(hastText).join('');
}

function tableRows(table: HastNode): string[][] {
  const rows: string[][] = [];
  const walk = (n: HastNode) => {
    if (n.tagName === 'tr') {
      rows.push((n.children ?? [])
        .filter(c => c.tagName === 'td' || c.tagName === 'th')
        .map(c => hastText(c).replace(/\s+/g, ' ').trim()));
      return;
    }
    (n.children ?? []).forEach(walk);
  };
  walk(table);
  return rows;
}

// ------------------------------------------------------------------ components

function components(opts: RichTextOptions): Components {
  const cell = `border:1px solid ${S.borderColor};padding:3pt 6pt;vertical-align:top;`;
  const heading = (level: number) =>
    ({ children }: { children?: React.ReactNode }) =>
      React.createElement(
        `h${level}`,
        {
          style: {
            margin: '12pt 0 6pt 0',
            fontFamily: S.bodyFont,
            fontSize: pt(S.headingPt[level - 1]),
            fontWeight: 'bold',
          },
        },
        children,
      );

  return {
    h1: heading(1),
    h2: heading(2),
    h3: heading(3),
    h4: heading(4),
    h5: heading(5),
    h6: heading(6),
    p: ({ children }) => <p style={{ margin: '0 0 8pt 0' }}>{children}</p>,
    strong: ({ children }) => <b>{children}</b>,
    em: ({ children }) => <i>{children}</i>,
    del: ({ children }) => <s>{children}</s>,
    a: ({ href, children }) => (
      <a href={href} style={{ color: S.linkColor, textDecoration: 'underline' }}>{children}</a>
    ),
    ul: ({ children, node }) => {
      const nested = (node as any)?.position && isNested(node as any);
      return <ul style={{ margin: nested ? '0' : '0 0 8pt 0', paddingLeft: '24pt' }}>{children}</ul>;
    },
    ol: ({ children, start, node }) => {
      const nested = isNested(node as any);
      return (
        <ol start={start} style={{ margin: nested ? '0' : '0 0 8pt 0', paddingLeft: '24pt' }}>{children}</ol>
      );
    },
    li: ({ children }) => {
      // Task list items: replace the disabled checkbox input with a glyph
      // (mail clients drop form controls).
      const kids = React.Children.toArray(children).map(child => {
        if (React.isValidElement(child) && child.type === 'input') {
          return (child.props as { checked?: boolean }).checked ? '☑ ' : '☐ ';
        }
        return child;
      });
      return <li style={{ margin: '0' }}>{kids}</li>;
    },
    input: ({ checked }) => <>{checked ? '☑ ' : '☐ '}</>,
    blockquote: ({ children }) => (
      <blockquote
        style={{
          margin: '0 0 8pt 15pt',
          paddingLeft: '8pt',
          borderLeft: `3px solid ${S.borderColor}`,
          color: S.quoteColor,
          fontStyle: 'italic',
        }}
      >
        {children}
      </blockquote>
    ),
    hr: () => <hr style={{ border: 'none', borderTop: `1px solid ${S.borderColor}`, margin: '8pt 0' }} />,
    pre: ({ node }) => {
      const code = hastText(node as any).replace(/\n$/, '');
      return (
        <pre
          style={{
            margin: '0 0 8pt 0',
            padding: '6pt 8pt',
            background: S.codeBackground,
            fontFamily: S.monoFont,
            fontSize: pt(S.codePt),
            whiteSpace: 'pre-wrap',
          }}
        >
          {code}
        </pre>
      );
    },
    code: ({ children }) => (
      <code style={{ fontFamily: S.monoFont, fontSize: pt(S.codePt), background: S.codeBackground }}>{children}</code>
    ),
    table: ({ children, node }) => {
      if (!opts.borderedTables) {
        // Bold header line, dash divider, one line per row. No space padding:
        // Outlook collapses repeated spaces, which destroys aligned columns.
        const rows = tableRows(node as any);
        if (!rows.length) return null;
        const header = rows[0].join(' | ');
        const lines: React.ReactNode[] = [<b key="h">{header}</b>, '-'.repeat(Math.min(60, Math.max(header.length, 10)))];
        rows.slice(1).forEach(r => lines.push(r.join(' | ')));
        return (
          <p style={{ margin: '0 0 8pt 0', fontFamily: S.monoFont, fontSize: pt(S.codePt) }}>
            {lines.map((l, i) => (
              <React.Fragment key={i}>
                {i > 0 && <br />}
                {l}
              </React.Fragment>
            ))}
          </p>
        );
      }
      return (
        <table
          style={{
            borderCollapse: 'collapse',
            margin: '0 0 8pt 0',
            fontFamily: S.bodyFont,
            fontSize: pt(S.bodyPt),
          }}
        >
          {children}
        </table>
      );
    },
    th: ({ children, style }) => (
      <th
        style={{
          ...cssText(cell),
          background: S.headerBackground,
          fontWeight: 'bold',
          textAlign: ((style as any)?.textAlign as any) || 'left',
        }}
      >
        {children}
      </th>
    ),
    td: ({ children, style }) => (
      <td style={{ ...cssText(cell), textAlign: ((style as any)?.textAlign as any) || 'left' }}>{children}</td>
    ),
    img: ({ src, alt }) => <img src={src} alt={alt ?? ''} />,
  };
}

function isNested(node: any): boolean {
  // react-markdown doesn't give parents; nested lists start past column 1.
  return !!node?.position && node.position.start.column > 1;
}

function cssText(css: string): React.CSSProperties {
  const out: Record<string, string> = {};
  css.split(';').filter(Boolean).forEach(decl => {
    const [k, v] = decl.split(':');
    out[k.trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v.trim();
  });
  return out as React.CSSProperties;
}

// ------------------------------------------------------------------ public API

/** Markdown -> HTML fragment with inline styles, ready for the clipboard or an email body. */
export function markdownToEmailHtml(markdown: string, opts: RichTextOptions = {}): string {
  const md = normalizeListIndent((markdown ?? '').replace(/\r\n?/g, '\n'));
  const body = renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components(opts)} skipHtml>
      {md}
    </ReactMarkdown>,
  );
  return `<div style="font-family:${S.bodyFont.replace(/"/g, '&quot;')};font-size:${pt(S.bodyPt)};">${body}</div>`;
}

/** Markdown -> readable plain text (the text/plain flavor and email fallback). */
export function markdownToPlainText(markdown: string): string {
  const md = normalizeListIndent((markdown ?? '').replace(/\r\n?/g, '\n'));
  const lines: string[] = [];
  let inFence = false;
  for (const raw of md.split('\n')) {
    if (FENCE_RE.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      lines.push(raw);
      continue;
    }
    let line = raw;
    if (/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line) && line.includes('-') && line.includes('|')) {
      continue; // table delimiter row
    }
    if (/^\s*([-*_]\s*){3,}$/.test(line)) {
      lines.push('―'.repeat(24));
      continue;
    }
    line = line
      .replace(/^(\s*)#{1,6}\s+/, '$1')
      .replace(/^(\s*)>\s?/, '$1')
      .replace(/^(\s*)[-*+]\s+\[( |x|X)\]\s+/, (_, s, c) => `${s}${c === ' ' ? '☐' : '☑'} `)
      .replace(/^(\s*)[-*+]\s+/, '$1• ')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_, t, u) => (t === u ? u : `${t} (${u})`))
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      .replace(/(\*|_)(\S(?:.*?\S)?)\1/g, '$2')
      .replace(/~~(.+?)~~/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, '$1');
    if (/^\s*\|.*\|\s*$/.test(line)) {
      line = line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()).join(' | ');
    }
    lines.push(line.replace(/\s+$/, ''));
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
