# nilmail

Sort your Gmail one swipe at a time. nilmail shows your conversations in piles, as a deck of cards, and every swipe does something in Gmail.

It runs in the browser on a computer and installs as an app on Android. It is a private app: only the Google accounts on its allow-list can sign in.

## What it does

- **Piles.** A pile is a set of filters with its own swipes; the picker in the header switches between them, and the app opens on the first.
  - Filters: unread, read or either; in the inbox, archived or anywhere; labels it has; labels it doesn't have; and, under More filters, category, older than, from, has an attachment and has none of your labels. Any Gmail search covers the rest.
  - Unread (unread inbox mail) is the one pile at the start. It can be edited, reordered or deleted like any other; add a Read pile (read inbox mail) or any other you need.
  - A pile loads a few conversations at a time, however much mail matches.
  - Each card shows the latest message: sender, subject, date and Gmail's preview text.
  - The picker shows each pile's count: exact where Gmail keeps one (the inbox, or a pile on a single label), otherwise Gmail's estimate, shown as `~120`.
  - Refresh, next to it, starts again from the newest conversation and brings back skipped ones.
- **Four swipes, four actions, per pile.** Each direction has an action you choose in settings, separately for each pile. The defaults are:
  - right: Archive (also marks it read)
  - left: Delete (moves it to the Bin)
  - up: Read (opens the whole conversation)
  - down: Mark read in Unread, Skip in piles you add

  The same actions are on the buttons under the card and on the arrow keys.
- **Label actions** move mail between piles: Add labels (one or more, and optionally archive), Remove label, and Remove all labels (only labels you made; Inbox, Starred and the like stay).
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
