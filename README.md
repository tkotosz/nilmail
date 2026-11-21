# nilmail

Sort your Gmail inbox one swipe at a time. nilmail shows your unread inbox conversations as a deck of cards, and every swipe does something in Gmail.

It runs in the browser on a computer and installs as an app on Android. It works for a single Google account: the one that owns its Google login client.

## What it does

- **The deck.**
  - It holds unread inbox conversations, newest first. The Gmail search that fills it can be changed in settings.
  - Each card shows the latest message: sender, subject, date and Gmail's preview text.
  - A counter shows how many unread conversations are left in the inbox.
- **Four swipes, four actions.** Each direction has an action you choose in settings. The defaults are:
  - right: Archive (also marks it read)
  - left: Delete (moves it to the Bin)
  - up: Read (opens the whole conversation)
  - down: Skip (leaves it unread)

  The same actions are on the buttons under the card and on the arrow keys.
- **The remaining actions** without a swipe appear as small buttons on the card: Mark read and Reply by default. Reply opens the conversation in Gmail.
- **Undo** reverses any of the last 20 actions in Gmail. Use the bar that appears after each action, the header button, or Ctrl+Z.
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
