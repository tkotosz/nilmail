# nilmail

A swipe-to-sort app for a Gmail inbox: a React app that calls the Gmail API directly, and a Cloudflare Worker that only handles Google sign-in. The interface, code, comments and docs are American English.

## Commands

- `npm run dev`: local server with live reload on http://127.0.0.1:4173 (`NILMAIL_PORT` changes the port). Signing in needs `.dev.vars`; see `docs/setup.md`.
- `npm run format`: Prettier; `npm run lint` fails on unformatted files.
- `npm run lint`, `npm run typecheck`, `npm test`: run all three before committing; CI runs them on every pull request.
- `npm run test:e2e`: browser walkthrough against a fake Gmail, run after UI or flow changes; it needs Chrome (or `NILMAIL_CHROME`). Screenshots land in `test/e2e/screenshots/`.
- `npm run build:pages`: the bundle CI deploys. The label under the logo comes from `NILMAIL_VERSION` (the deploy sets the release tag or the commit); without it, a build uses the current branch and commit.
- `npm run icons`: renders the PNG icons from `public/icon.svg`.

## Layout

- `src/core/`: platform-neutral types and rules. Imports nothing from `web` or `worker`.
  - `actions.ts`: what actions change in Gmail, and their undo.
  - `deck.ts`: the deck reducer, batch loading and finding all from a sender.
  - `message.ts`: Gmail threads to cards and read-view messages.
  - `settings.ts`, `gmail.ts`, `types.ts`.
- `src/worker/`: the Worker entry (`index.ts`) and the sign-in routes (`auth.ts`).
- `src/web/`: the React app.
  - `App.tsx`: sign-in state.
  - `Sorter.tsx`: the sorting screen, wiring the deck to Gmail.
  - `gmail-http.ts`: the Gmail client.
  - `session.ts`: access tokens.
  - `unsubscribe.ts`: unsubscribing from a sender, from the browser.
  - `components/`: the swipe card, mail card, read view and settings.
- `test/`: unit tests (`*.test.ts`) and the end-to-end walkthrough (`e2e/`, with `fake-gmail.ts`).
- `scripts/`: the esbuild build, the dev server and the icon renderer. `public/`: static files and the service worker.

## Rules that are easy to break

- **Mail never passes through the Worker.** The Worker only exchanges and renews tokens. Gmail calls go from the browser to `gmail.googleapis.com`. Do not add routes that proxy or store mail.
- **Unsubscribe goes from the browser.** The one-click request (RFC 8058) is a `no-cors` POST straight to the sender, so the app cannot read the answer and says "sent", never "confirmed". Unsubscribe is a button, not a swipe: only conversations with a `List-Unsubscribe` header offer it. A `mailto:` unsubscribe opens the user's mail app; sending mail from nilmail would need a permission beyond `gmail.modify`.
- **Gmail changes go through `stepsFor` and `undoSteps`.** An action removes only labels the thread has, so its undo restores the thread exactly. Cover new actions in `test/actions.test.ts`.
- **One decision at a time.** `Sorter` sends every decision's Gmail changes through its queue, so an undo cannot overtake the change it undoes. A decision that covers all from a sender changes its threads a few at a time inside one queued task (`applyChanges`), and a thread Gmail refuses goes back to the deck alone. Do not call `applyToGmail` or `applyChanges` outside the queue.
- **The deck reducer is the only place cards move.** Screens dispatch `DeckEvent`s. Cover reducer changes in `test/deck.test.ts`.
- **Email HTML stays sandboxed.** `MessageBody` renders it in an iframe without `allow-scripts`, with a content security policy that blocks scripts and, unless images are allowed, remote images. The frame has `allow-same-origin` only so the page can size it. Never add `allow-scripts` while `allow-same-origin` is there.
- **The permission is `gmail.modify`.** It can read, label, archive and move to the Bin, but not delete permanently. Asking for more needs a new consent from every user. `openid email` is there only so the callback learns the account's address.
- **The allow-list comes before Gmail.** Sign-in takes two trips to Google: the first asks only for the address (`openid email`), and only a listed address goes on to the Gmail permission. Keep Gmail out of the first trip: that is what keeps strangers from the unverified-app warning and from Google's 100-account limit. `ALLOWED_EMAILS` is checked after each trip and again on every `/api/auth/token` renewal; a refused account's token is revoked at once. Without the list, sign-in reports "not set up". Addresses never go in the repository: they live in `.dev.vars` and Cloudflare secrets. Cover changes in `test/auth.test.ts`.
- **The privacy page must stay true.** `public/privacy.html` tells users what nilmail accesses, where data goes and what the server handles; Google's sign-in settings link to it. Update it (and its date) with any change to permissions, cookies, storage or data flow.
- **No `wrangler.jsonc`.** A Wrangler config file would become the source of truth for the Pages project's plain-text variables and drop `ALLOWED_EMAILS` set in the dashboard. Deploys pass the project name and the output folder on the command line instead.
- **Sign-in cookies.** The session cookie is `nilmail_session` (path `/api`, SameSite=Strict), holding `{ email, refreshToken }` encrypted; the sign-in state cookie is `nilmail_state` (path `/api/auth`, SameSite=Lax, since Google's redirect back is a cross-site navigation). Changing `SESSION_KEY` signs every device out.
- **Saved settings.** They live in `localStorage` under `nilmail.settings.v1` and pass through `restoreSettings`. Changing their shape needs a new key or handling in `restoreSettings`. A label swipe keeps its label's id and name per direction; a label swipe without a valid label falls back to the default swipe.
- **TypeScript 6.** typescript-eslint does not support TypeScript 7 yet; keep `typescript` on 6.x until it does.
