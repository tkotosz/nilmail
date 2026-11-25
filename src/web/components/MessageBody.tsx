import { useCallback, useState, type ReactNode } from 'react';
import { ImageOff } from 'lucide-react';

/**
 * The frame's own rules: nothing loads except styles, fonts and (when allowed) images; no scripts run (the sandbox also
 * forbids them); links open outside the app. In the dark theme the page inverts the whole frame, as Gmail darkens
 * emails; pictures are inverted once more here, so they keep their own colors.
 */
function frameDocument(html: string, images: boolean): string {
  const imageSources = images ? 'https: http: data:' : 'data:';
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${imageSources}; style-src 'unsafe-inline' https: http:; font-src https: http: data:">
<meta name="referrer" content="no-referrer">
<base target="_blank">
<style>html,body{margin:0;padding:0;overflow:hidden}body{font:15px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;color:#1f2430;background:#fff;overflow-wrap:anywhere;padding:2px}img{max-width:100%;height:auto}pre{white-space:pre-wrap}
@media (prefers-color-scheme:dark){img,picture,video,svg,[background],[style*="background-image"]{filter:invert(1) hue-rotate(180deg)}}</style>
</head><body>${html}</body></html>`;
}

/** Whether the email would load pictures from the internet. */
const hasRemoteImages = (html: string) => /<img[^>]+src\s*=\s*["']?https?:|url\(\s*["']?https?:/i.test(html);

/**
 * An HTML email in a sandboxed frame. The frame shares the page's origin only so the page can size it to its content;
 * without scripts the email cannot use that. Wide newsletters are zoomed out to fit.
 */
function HtmlFrame({ html, images }: { html: string; images: boolean }) {
  const [height, setHeight] = useState(120);
  const fit = useCallback((frame: HTMLIFrameElement) => {
    const doc = frame.contentDocument;
    if (!doc?.body) return;
    doc.body.style.zoom = '';
    const wide = doc.documentElement.scrollWidth;
    const room = frame.clientWidth;
    if (wide > room + 2) doc.body.style.zoom = String(room / wide);
    setHeight(Math.ceil(doc.documentElement.getBoundingClientRect().height) + 4);
  }, []);
  return (
    <iframe
      className="message-frame"
      title="Email content"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={frameDocument(html, images)}
      style={{ height }}
      onLoad={event => fit(event.currentTarget)}
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
