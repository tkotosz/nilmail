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
  - `pile.ts`: piles: their Gmail search, how to count them, and the default piles.
  - `message.ts`: Gmail threads to cards and read-view messages.
  - `settings.ts`, `gmail.ts`, `types.ts`.
- `src/worker/`: the Worker entry (`index.ts`) and the sign-in routes (`auth.ts`).
- `src/web/`: the React app.
  - `App.tsx`: sign-in state.
  - `Sorter.tsx`: the sorting screen, wiring the deck to Gmail.
  - `gmail-http.ts`: the Gmail client.
  - `session.ts`: access tokens.
  - `unsubscribe.ts`: unsubscribing from a sender, from the browser.
  - `components/`: the swipe card, mail card, read view, and settings with the pile list and pile pages.
- `test/`: unit tests (`*.test.ts`) and the end-to-end walkthrough (`e2e/`, with `fake-gmail.ts`).
- `scripts/`: the esbuild build, the dev server and the icon renderer. `public/`: static files and the service worker.

## Rules that are easy to break

- **Mail never passes through the Worker.** The Worker only exchanges and renews tokens. Gmail calls go from the browser to `gmail.googleapis.com`. Do not add routes that proxy or store mail.
- **Unsubscribe goes from the browser.** The one-click request (RFC 8058) is a `no-cors` POST straight to the sender, so the app cannot read the answer and says "sent", never "confirmed". Unsubscribe is a button, not a swipe: only conversations with a `List-Unsubscribe` header offer it. A `mailto:` unsubscribe opens the user's mail app; sending mail from nilmail would need a permission beyond `gmail.modify`.
- **Gmail changes go through `stepsFor` and `undoSteps`.** An action removes only labels the thread has, so its undo restores the thread exactly. Cover new actions in `test/actions.test.ts`.
- **One decision at a time.** `Sorter` sends every decision's Gmail changes through its queue, so an undo cannot overtake the change it undoes. A decision that covers all from a sender changes its threads a few at a time inside one queued task (`applyChanges`), and a thread Gmail refuses goes back to the deck alone. Do not call `applyToGmail` or `applyChanges` outside the queue.
- **Piles load in batches.** A pile's filters become a search (`pileSearch`): labels it must have go by id in `labelIds`, so their names never enter the search; labels it must not have use Gmail's name form (`searchLabelName`). Every pile loads through `loadCards`, a few conversations at a time: a pile can match thousands of conversations, so never list or fetch a whole search. A count is exact only when `pileCount` finds a label's numbers that give it; otherwise it is Gmail's estimate and the pile's tab must say so (`~N`). Cover changes in `test/pile.test.ts` and `test/deck.test.ts`.
- **The deck reducer is the only place cards move.** Screens dispatch `DeckEvent`s. Cover reducer changes in `test/deck.test.ts`.
- **Email HTML stays sandboxed.** `MessageBody` renders it in an iframe without `allow-scripts`, with a content security policy that blocks scripts and, unless images are allowed, remote images. The frame has `allow-same-origin` only so the page can size it, zoom a wide email out to fit, and darken it in the dark theme (`email-dark.ts`: light backgrounds turn dark and dark text light by perceived brightness; colors already dark stay, pictures are untouched). Never add `allow-scripts` while `allow-same-origin` is there.
- **The permission is `gmail.modify`.** It can read, label, archive and move to the Bin, but not delete permanently. Asking for more needs a new consent from every user. `openid email` is there only so the callback learns the account's address.
- **The allow-list comes before Gmail.** Sign-in takes two trips to Google: the first asks only for the address (`openid email`), and only a listed address goes on to the Gmail permission. Keep Gmail out of the first trip: that is what keeps strangers from the unverified-app warning and from Google's 100-account limit. `ALLOWED_EMAILS` is checked after each trip and again on every `/api/auth/token` renewal; a refused account's token is revoked at once. Without the list, sign-in reports "not set up". Addresses never go in the repository: they live in `.dev.vars` and Cloudflare secrets. Cover changes in `test/auth.test.ts`.
- **The privacy page must stay true.** `public/privacy.html` tells users what nilmail accesses, where data goes and what the server handles; Google's sign-in settings link to it. Update it (and its date) with any change to permissions, cookies, storage or data flow.
- **No `wrangler.jsonc`.** A Wrangler config file would become the source of truth for the Pages project's plain-text variables and drop `ALLOWED_EMAILS` set in the dashboard. Deploys pass the project name and the output folder on the command line instead.
- **Sign-in cookies.** The session cookie is `nilmail_session` (path `/api`, SameSite=Strict), holding `{ email, refreshToken }` encrypted; the sign-in state cookie is `nilmail_state` (path `/api/auth`, SameSite=Lax, since Google's redirect back is a cross-site navigation). Changing `SESSION_KEY` signs every device out.
- **Saved settings.** They live in `localStorage` under `nilmail.settings.v3` and pass through `restoreSettings`. Changing their shape needs a new key or handling in `restoreSettings`; settings from before piles (`v2`, `v1`) become the Unread pile. Unread is the only default pile. Labels are saved with id and name; `withCurrentLabels` refreshes the names when the app starts and drops deleted labels. Add labels needs at least one label and Remove label exactly one; otherwise the swipe falls back to its default.
- **Label actions only touch what they must.** Remove all labels removes only labels the user made (`isUserLabel`, ids starting `Label_`), never INBOX, UNREAD, STARRED or categories. Cover action changes in `test/actions.test.ts`.
- **Material 3 styles.** `src/web/styles.css` follows Material Design 3. Use its color roles (`--md-*`), the action colors (`--green`, `--green-container`, …), the shape scale (`--shape-*`) and the easing variables; never a literal color, except Google's sign-in button and email bodies, which stay white. The roles come from a scheme generated with `@material/material-color-utilities` from the seed `#ec4b2f`. Change them by generating again, not by hand, and keep the light and dark values in step. Settings save as they change (no Save button; typing is saved after a short pause, and on close); a change that cannot work yet, such as Add labels without a label, waits with a notice. So standalone on/off settings use switches (`SwitchRow`), and lists of related options, such as labels, checkboxes. New labels are created in Gmail when added. Deleting a pile asks first (`ConfirmDialog`). Settings pages are rows in rounded groups (`SettingsRows.tsx`): a row opens a menu, toggles, holds a field, or opens a page of its own; do not add outlined form fields there. The "Sign in with Google" button follows Google's branding guidelines: keep its colors, font and logo as they are.
- **TypeScript 6.** typescript-eslint does not support TypeScript 7 yet; keep `typescript` on 6.x until it does.
