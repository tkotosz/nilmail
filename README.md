# nilmail

Sort your Gmail inbox one swipe at a time. nilmail shows your inbox conversations as a deck of cards, unread or read, and every swipe does something in Gmail.

It runs in the browser on a computer and installs as an app on Android. It is a private app: only the Google accounts on its allow-list can sign in.

## What it does

- **Two decks.** The picker in the header switches between them; the app always opens on Unread.
  - Unread: unread inbox conversations, newest first. The Gmail search that fills it can be changed in settings.
  - Read: inbox conversations already read, to clear out mail that stayed in the inbox. It loads a few at a time, however large the inbox.
  - Each card shows the latest message: sender, subject, date and Gmail's preview text.
  - The picker shows how many unread and read conversations are in the inbox.
  - Refresh, next to it, starts again from the newest conversation and brings back skipped ones.
- **Four swipes, four actions, per deck.** Each direction has an action you choose in settings, separately for each deck. The defaults are:
  - right: Archive (also marks it read)
  - left: Delete (moves it to the Bin)
  - up: Read (opens the whole conversation)
  - down: Mark read in the Unread deck, Skip in the Read deck

  The same actions are on the buttons under the card and on the arrow keys.
- **Card buttons.** All from sender applies the next action to every conversation from that sender in the deck. Unsubscribe shows when the sender offers it.
- **The read view** (swipe up) also offers Reply, which opens the conversation in Gmail, and Skip.
- **Undo** reverses any of the last 20 actions in Gmail. Use the bar that appears after each action, or Ctrl+Z.
- **Private by design.** Mail goes straight from Gmail to your device. The server part only renews the sign-in and stores nothing.

## Running it

```sh
npm install
npm run dev     # http://127.0.0.1:4173
```

Signing in needs a Google login client and three secrets; [docs/setup.md](docs/setup.md) walks through it, including the Cloudflare and GitHub setup for deploying.

## Checks

```sh
npm run lint && npm run typecheck && npm test
npm run test:e2e   # browser walkthrough against a fake Gmail; needs Chrome
```

More in [AGENTS.md](AGENTS.md) and [docs/architecture.md](docs/architecture.md).
