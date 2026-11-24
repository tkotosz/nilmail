import type { Unsubscribe } from '../core/types.ts';

/**
 * Asks the sender to stop sending, from the browser. A one-click link gets the POST that RFC 8058 describes. The sender's
 * server does not allow other sites to read its answer, so the request goes in `no-cors` mode: it is sent, but only a
 * failure to reach the server is known. A web page opens in a new tab, and an email opens in the mail app, ready to send.
 * https://www.rfc-editor.org/rfc/rfc8058#section-3.2
 */
export async function sendUnsubscribe(unsubscribe: Unsubscribe): Promise<void> {
  if (unsubscribe.kind === 'web') {
    window.open(unsubscribe.url, '_blank', 'noopener');
  } else if (unsubscribe.kind === 'mailto') {
    window.location.href = unsubscribe.url;
  } else {
    await fetch(unsubscribe.url, {
      method: 'POST',
      mode: 'no-cors',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      body: new URLSearchParams({ 'List-Unsubscribe': 'One-Click' }),
    });
  }
}

/** What the toast says once the unsubscribe has started. */
export const unsubscribeDone: Record<Unsubscribe['kind'], string> = {
  oneClick: 'Unsubscribed and archived',
  web: 'Archived. Finish unsubscribing in the new tab',
  mailto: 'Archived. Send the email to unsubscribe',
};
