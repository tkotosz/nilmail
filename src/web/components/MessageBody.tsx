import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ImageOff } from 'lucide-react';
import { darkenEmail } from '../email-dark.ts';

/**
 * The frame's own rules: nothing loads except styles, fonts and (when allowed) images; no scripts run (the sandbox also
 * forbids them); links open outside the app.
 */
function frameDocument(html: string, images: boolean): string {
  const imageSources = images ? 'https: http: data:' : 'data:';
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${imageSources}; style-src 'unsafe-inline' https: http:; font-src https: http: data:">
<meta name="referrer" content="no-referrer">
<base target="_blank">
<style>html,body{margin:0;padding:0;overflow:hidden}body{font:15px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;color:#1f2430;background:#fff;overflow-wrap:break-word;padding:2px}img:not(table img){max-width:100%;height:auto}pre{white-space:pre-wrap}</style>
</head><body>${html}</body></html>`;
}

/** Whether the email would load pictures from the internet. */
const hasRemoteImages = (html: string) => /<img[^>]+src\s*=\s*["']?https?:|url\(\s*["']?https?:/i.test(html);

/**
 * An HTML email in a sandboxed frame. The frame shares the page's origin only so the page can size it, zoom a wide
 * newsletter out to fit, and darken it in the dark theme; without scripts the email cannot use that access.
 */
function HtmlFrame({ html, images }: { html: string; images: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);
  /** Hidden until zoomed and darkened, so the raw email never flashes up. */
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    let waiting = 0;
    let observer: ResizeObserver | undefined;
    const measure = (doc: Document) => setHeight(Math.ceil(doc.documentElement.getBoundingClientRect().height) + 4);
    // Runs as soon as the email's text is parsed, not after every picture has downloaded, which can take seconds.
    const prepare = () => {
      const doc = element.contentDocument;
      // The frame starts on an empty page; the email's own document comes from `srcdoc`.
      if (!doc || doc.URL !== 'about:srcdoc' || doc.readyState === 'loading' || !doc.body) {
        waiting = requestAnimationFrame(prepare);
        return;
      }
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) darkenEmail(doc);
      // The frame hides its overflow, so the page's own width is the frame's; the body's width is the email's.
      const wide = Math.max(doc.documentElement.scrollWidth, doc.body.scrollWidth);
      const room = element.clientWidth;
      if (wide > room + 2) doc.body.style.zoom = String(room / wide);
      measure(doc);
      setReady(true);
      // Pictures arriving later make the email taller.
      observer = new ResizeObserver(() => measure(doc));
      observer.observe(doc.body);
    };
    waiting = requestAnimationFrame(prepare);
    return () => {
      cancelAnimationFrame(waiting);
      observer?.disconnect();
    };
  }, [html, images]);

  return (
    <iframe
      ref={frame}
      className="message-frame"
      title="Email content"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={frameDocument(html, images)}
      style={{ height, visibility: ready ? 'visible' : 'hidden' }}
    />
  );
}

const urlPattern = /(https?:\/\/[^\s<>"')\]]+)/g;

function PlainText({ text }: { text: string }) {
  const pieces: ReactNode[] = text.split(urlPattern).map((piece, index) =>
    index % 2 === 1 ? (
      <a key={index} href={piece} target="_blank" rel="noopener noreferrer">
        {piece}
      </a>
    ) : (
      piece
    ),
  );
  return <div className="message-text">{pieces}</div>;
}

export function MessageBody({ html, text, loadImages }: { html: string | null; text: string | null; loadImages: boolean }) {
  const [images, setImages] = useState(loadImages);
  if (html) {
    return (
      <>
        {!images && hasRemoteImages(html) && (
          <button type="button" className="quiet-button show-images" onClick={() => setImages(true)}>
            <ImageOff size={16} aria-hidden="true" /> Show images
          </button>
        )}
        <HtmlFrame key={String(images)} html={html} images={images} />
      </>
    );
  }
  if (text) return <PlainText text={text} />;
  return <p className="message-empty">This message has no text.</p>;
}
