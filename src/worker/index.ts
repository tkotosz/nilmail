import assets from 'nilmail-assets';
import { serveAuth, type AuthEnv } from './auth.ts';

export interface Env extends AuthEnv {
  /** Cloudflare Pages' static files; the local server embeds them instead. */
  ASSETS?: { fetch(request: Request): Promise<Response> };
}

const decodedBytes = (encoded: string) => Uint8Array.from(atob(encoded), char => char.charCodeAt(0));

export default {
  async fetch(request: Request, env: Env = {}): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/auth/')) return serveAuth(request, env);
    if (url.pathname.startsWith('/api/')) return new Response('Not found.', { status: 404 });
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed.', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    const asset = Object.hasOwn(assets, url.pathname) ? assets[url.pathname] : undefined;
    if (!asset) return env.ASSETS?.fetch(request) ?? new Response('Not found.', { status: 404 });
    const [contentType, value] = asset;
    const headers = {
      'Content-Type': contentType,
      'Cache-Control': url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'X-Robots-Tag': 'noindex, nofollow',
    };
    return new Response(request.method === 'HEAD' ? null : decodedBytes(value), { headers });
  },
};
