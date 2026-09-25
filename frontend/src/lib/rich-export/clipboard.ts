/**
 * Rich-text clipboard writes for the Tauri webview (fork addition).
 *
 * Puts HTML and plain text on the clipboard together, so a normal paste into
 * Outlook, Word, Mail, Teams, OneNote or Gmail lands formatted, and plain-text
 * targets still get readable text.
 *
 * Primary path: the async Clipboard API with a ClipboardItem (WebView2 on
 * Windows, WKWebView on macOS, WebKitGTK on Linux). The item's values are
 * Promises so WebKit keeps the click's user-activation while the summary is
 * still being fetched.
 * Fallback: select a hidden rendered copy and run execCommand('copy'), which
 * also carries both flavors.
 */

export type ContentSource = string | Promise<string>;

export interface RichClipboardContent {
  html: ContentSource;
  plain: ContentSource;
}

export async function copyRichText(content: RichClipboardContent): Promise<void> {
  const html = Promise.resolve(content.html);
  const plain = Promise.resolve(content.plain);
  // Content errors (e.g. no summary) are re-thrown below; don't let the
  // second promise's copy of the same rejection go unhandled.
  html.catch(() => undefined);
  plain.catch(() => undefined);

  const hasAsyncApi =
    typeof navigator !== 'undefined' &&
    !!navigator.clipboard?.write &&
    typeof (globalThis as any).ClipboardItem !== 'undefined';

  if (hasAsyncApi) {
    try {
      const Item = (globalThis as any).ClipboardItem;
      const htmlBlob = html.then(h => new Blob([h], { type: 'text/html' }));
      const plainBlob = plain.then(p => new Blob([p], { type: 'text/plain' }));
      htmlBlob.catch(() => undefined);
      plainBlob.catch(() => undefined);
      const item = new Item({ 'text/html': htmlBlob, 'text/plain': plainBlob });
      await navigator.clipboard.write([item]);
      return;
    } catch (err) {
      console.warn('[rich-export] ClipboardItem write failed, using fallback', err);
    }
  }

  const [h, p] = await Promise.all([html, plain]);
  if (!copyWithExecCommand(h, p)) {
    throw new Error('The clipboard is not available');
  }
}

export async function copyPlainText(text: ContentSource): Promise<void> {
  const t = await Promise.resolve(text);
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(t);
    return;
  }
  if (!copyWithExecCommand(null, t)) throw new Error('The clipboard is not available');
}

/** Legacy path: a 'copy' event handler sets both flavors explicitly. */
export function copyWithExecCommand(html: string | null, plain: string): boolean {
  if (typeof document === 'undefined') return false;
  const onCopy = (e: ClipboardEvent) => {
    if (!e.clipboardData) return;
    if (html !== null) e.clipboardData.setData('text/html', html);
    e.clipboardData.setData('text/plain', plain);
    e.preventDefault();
  };
  const holder = document.createElement('div');
  holder.style.position = 'fixed';
  holder.style.left = '-9999px';
  holder.textContent = plain.slice(0, 1) || ' ';
  document.body.appendChild(holder);
  const range = document.createRange();
  range.selectNodeContents(holder);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  document.addEventListener('copy', onCopy);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } finally {
    document.removeEventListener('copy', onCopy);
    sel?.removeAllRanges();
    holder.remove();
  }
  return ok;
}
