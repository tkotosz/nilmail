# Architecture

nilmail has three parts in one package:
- a platform-neutral core
- a Cloudflare Worker that handles Google sign-in
- a React single-page app that talks to the Gmail API directly

esbuild bundles the app and the Worker. Cloudflare Pages serves the static files and runs the Worker for `/api` routes.

```
browser                                              Cloudflare
┌──────────────────────────────────────┐  /api/auth  ┌─────────────────────────┐
│ src/web                              │────────────▶│ src/worker              │
│ Sorter screen ─ deck reducer         │  access     │ sign-in, token renewal, │──▶ Google OAuth
│      │            (src/core)         │  token      │ sign-out                │
│      ▼                               │             └─────────────────────────┘
│ gmail-http ──────────────────────────┼──────────────────────────────────────────▶ Gmail API
│ localStorage: settings               │   mail goes straight to the browser
└──────────────────────────────────────┘
```

## Core

`src/core` holds plain types and functions with no browser or Worker dependencies.
- `types.ts`: cards, actions, settings and the read view's message shape.
- `actions.ts`: what each action changes in Gmail, as a list of steps, and the steps that undo them.
- `deck.ts`: the deck as a reducer (cards waiting, threads seen, undo history) and `loadCards`, which fetches the next batch through the `Gmail` interface.
- `gmail.ts`: the parts of Gmail's thread resource the app reads, the `Gmail` interface, and `applyToGmail`.
- `message.ts`: turning Gmail threads into cards and read-view messages (headers, MIME parts, base64url, character sets).
- `settings.ts`: defaults and restoring saved settings.

## Worker

`src/worker/auth.ts` serves four routes:
- `GET /api/auth/start` sends the browser to Google's consent screen with offline access to Gmail.
- `GET /api/auth/callback` trades the code for a refresh token and stores it, AES-GCM encrypted, in an HttpOnly cookie.
- `POST /api/auth/token` turns that cookie into a one-hour access token.
- `POST /api/auth/logout` revokes the token at Google and clears the cookie.

The Worker stores nothing and never sees mail.

`src/worker/index.ts` routes requests and, in local development, serves the embedded static files.

## Web app

`App.tsx` checks the sign-in by asking Gmail for the account's address, then shows the welcome screen or the `Sorter`.

`Sorter.tsx` owns the deck reducer and wires it to Gmail:
- It loads batches when the deck runs low.
- It applies each decision to the deck at once, and sends the Gmail steps through a queue that runs one change at a time.
- When Gmail refuses a change, the card returns to the deck.

`session.ts` keeps the access token in memory and renews it before it expires. `gmail-http.ts` is the Gmail client.

The read view renders HTML email in a sandboxed frame with no scripts and a restrictive content security policy.

## Key decisions

- **Personal-mode Google client.** Only the owner's account can sign in, with no Google review and no 7-day token expiry; opening the app to others would need a different client type and Google's verification.
- **A Worker for tokens only.** Google issues refresh tokens only to a server holding the client secret; keeping the token in an encrypted cookie avoids a database, and Gmail calls go straight from the browser so mail never passes through Cloudflare.
- **Conversations, not messages.** Gmail's inbox is a list of threads, so every action applies to the whole thread.
- **Optimistic decisions, one Gmail change at a time.** The deck reacts at once; the queue keeps an undo from overtaking the change it undoes.
- **Undo restores exact labels.** An action removes only labels the thread had, and its undo adds back only those, so undo never leaves a thread different from before.
- **Every batch starts from the first page.** Decisions change which threads match the search, which makes old page tokens skip threads; the deck remembers what it has seen instead.
- **Folders instead of workspaces.** One app and one build; the folder boundary keeps the core platform-neutral without package wiring.
