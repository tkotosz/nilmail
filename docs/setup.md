# Setup

nilmail needs four things set up once:
- a Google login client
- an allow-list of the Google accounts that may sign in
- a Cloudflare Pages project holding the login secrets
- the GitHub secrets the deploy workflow uses

Running it locally needs only the first two.

First pick a name for the Cloudflare Pages project; it becomes the app's address. Names under `pages.dev` are first come, first served across all of Cloudflare, so add something of your own, such as `nilmail-yourname`; it also shows at a glance whose copy the address is. The steps below write it as `<project>`, and the app uses three addresses:

- production: `https://<project>.pages.dev`
- preview (every push to `main`): `https://preview.<project>.pages.dev`
- local: `http://127.0.0.1:4173`

Nothing in the code depends on the name: the sign-in builds its Google callback address from the address it runs on.

## 1. Google login client

Pick one of two kinds of Google project:

- **Shared (External, unverified): you and up to 99 people you know.**
  - Everyone sees Google's "unverified app" warning once, at their first sign-in.
  - The project can later go through Google's verification to open it further; see "Growing beyond 100 people".
- **Personal mode: only you.**
  - No warning, but only the account that creates the project can ever sign in.
  - It can never be switched to another type.

Either way the sign-in lasts until you sign out or revoke access; Google also ends it after six months without use.

Keep local development on a client of its own, as Google's policies advise ("Use separate projects for testing and production"):
- The deployed client gets only the `https://` callbacks.
- Its secret lives only in Cloudflare, never on a laptop.

A Personal-mode project makes a good development client for a shared setup: only you can sign in to it, with no warning. See "A client for local development" below.

### Shared (External, unverified)

1. Sign in to the Google Cloud console and create a project, such as `nilmail`.
2. **Google Auth Platform → Get started**, then **Branding:**
   - App name `nilmail`, plus a user support email and a developer contact email.
   - **Application home page:** `https://<project>.pages.dev`.
   - **Privacy policy link:** `https://<project>.pages.dev/privacy`.
   - **Authorized domains:** `<project>.pages.dev`.
   - Google requires the two links before the app can be published, though not their verification.
   - Leave the logo empty: a logo requires brand verification.
3. **Audience:**
   - User type **External**.
   - Click **Publish app** and confirm, so the status reads **In production**. Do this before anyone signs in: sign-ins made while an app is in Testing expire after 7 days.
   - If the console says the app needs verification, continue without submitting.
4. **Clients → Create client:**
   - Type **Web application**. Add these **Authorized redirect URIs**:
     - `https://<project>.pages.dev/api/auth/callback`
     - `https://preview.<project>.pages.dev/api/auth/callback`
   - Copy the **Client ID** and the **Client secret** into a password manager until they go into Cloudflare (step 4).
5. **Data access:** nothing to add. The app asks for its permissions at sign-in: `gmail.modify`, `openid` and `email`. If sign-in fails with a scope error, add those three here.
6. Enable the Gmail API: <https://console.cloud.google.com/apis/library/gmail.googleapis.com> → **Enable**.

### Personal mode

1. Sign in to the Google Cloud console with the Gmail account nilmail should sort.
2. Open the Personal mode onboarding page: <https://console.cloud.google.com/auth/overview/personal>
3. Pick **Create a new project**, or let it create `personal-mode-app`.
4. Application type **Web application**, with the two `https://` redirect URIs above.
5. Accept the terms and click **Continue**. Copy the **Client ID** and the **Client secret**; the secret is shown only once.
6. Enable the Gmail API, as above.

### A client for local development

Make a Personal-mode project as above, but give its client a single redirect URI, `http://127.0.0.1:4173/api/auth/callback`. Its client ID and secret go into `.dev.vars` (step 3).

Redirect URIs can be edited later under **Google Auth Platform → Clients**. To try the shared client itself locally, for example to see the warning screen, add the local callback to it for that test, then remove it again.

## 2. Session key and allow-list

The session key encrypts the cookie that keeps people signed in. Make one with:

```sh
openssl rand -base64 32
```

Changing it later signs every device out.

The allow-list, `ALLOWED_EMAILS`, holds the Google accounts that may sign in, separated by commas: `you@gmail.com, friend@gmail.com`. Without it nobody can sign in.
- **Checked twice:** at sign-in, and again every time a login is renewed. Taking an address off the list ends that person's access within the hour.
- **Compared the way Gmail does:** case doesn't matter, and for gmail.com addresses neither do dots.
- **Kept out of the repository:** the list is personal data, so it lives only in `.dev.vars` and in Cloudflare.

## 3. Local use

Create `.dev.vars` in the repository root, with the development client's values. It is git-ignored; never commit it.

```sh
GOOGLE_CLIENT_ID=…apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=…
SESSION_KEY=…
ALLOWED_EMAILS=you@gmail.com
```

Then run `npm run dev` and open <http://127.0.0.1:4173>. Use exactly that address: `localhost` is a different address to Google and to the cookie.

To check the allow-list, sign in once with a Google account that is not on it: nilmail should say it is private right after you pick the account, before Google asks for Gmail. With a Personal-mode development client, Google refuses other accounts itself, so this check needs the shared client or a deployed preview.

## 4. Cloudflare Pages project

1. Create a **Direct Upload** Pages project in the Cloudflare dashboard:
   1. **Workers & Pages → Create application**. Everything on that page creates a Cloudflare Workers project. Instead, click the link at the bottom: **"Need to use the legacy Pages workflow? Continue to Pages"**.
   2. Choose direct upload ("Upload assets"), name the project `<project>` and click **Create project**. You can leave the upload page: the first deploy fills the project.
   3. In the project's **Settings**, make sure the production branch is `main`.

   Don't use `wrangler pages project create`: recent Wrangler versions turn it into a Workers project unless forced.

   Cloudflare has folded Pages into Workers and calls Pages "legacy" since autumn 2026. Existing Pages projects keep working, and nilmail's build and deploy are written for Pages.

2. Add the four values as secrets for both environments:

   ```sh
   PROJECT=nilmail   # your <project>
   for name in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET SESSION_KEY ALLOWED_EMAILS; do
     npx wrangler pages secret put $name --project-name $PROJECT
     npx wrangler pages secret put $name --project-name $PROJECT --env preview
   done
   ```

   The dashboard works too: **Workers & Pages → <project> → Settings → Variables and Secrets**, once for Production and once for Preview.

Cloudflare Pages applies changed secrets to new deployments only. After changing one, such as adding someone to `ALLOWED_EMAILS`, redeploy: re-run the Deploy workflow, or **Retry deployment** on the latest deployment in the dashboard.

## 5. GitHub

In the repository's **Settings → Secrets and variables → Actions**, add:

- Secret `CLOUDFLARE_ACCOUNT_ID`
- Secret `CLOUDFLARE_API_TOKEN`: a token with the **Cloudflare Pages: Edit** permission.
- Variable `PAGES_PROJECT`: your `<project>`. Without it the deploy workflow uses `nilmail`.

After that:

- Every push to `main` that passes CI deploys to the preview address.
- Publishing a GitHub release deploys to production.

## 6. Install on the phone

Open the production address in Chrome on Android, sign in, then **⋮ → Add to Home screen** (or the **Install** button in the app).

## Sharing with people you know

To invite someone:
1. Add their address to `ALLOWED_EMAILS`, in both environments.
2. Redeploy.
3. Send them the link with a note like this:

> nilmail sorts your Gmail inbox with swipes. When you sign in, Google first asks which account to use, then asks for Gmail access. Google warns that the app isn't verified, because it's a small private app: if it shows a full warning page, click **Advanced → Go to nilmail (unsafe)**. Then tick the Gmail permission. Google describes it as reading, writing and sending email; nilmail only reads, archives, marks read and moves to the Bin. Your mail goes straight from Gmail to your phone or browser; nothing is stored on a server. You can remove its access any time at myaccount.google.com/permissions.

What to keep in mind:

- **Google's terms.** Unverified use is allowed for fewer than 100 people, all known personally to you.
  - Google's OAuth policies count that as personal use, not as a production app ([OAuth 2.0 Policies](https://developers.google.com/identity/protocols/oauth2/policies)).
  - The help page lists it as "Limited audience apps" ([When is verification not needed](https://support.google.com/cloud/answer/13464323)).
  - The console's **In production** status is a different thing: it only ends Testing mode and its 7-day sign-ins.
- **100 accounts for the life of the project.** Google counts every account that grants the permission after the warning, and the count can never be reset.
  - Sign-in checks the allow-list before asking for Gmail, so someone who finds the address and signs in is stopped before the warning and doesn't use up a place.
  - Only someone who deliberately builds Google's Gmail permission link by hand could use one up. The client ID in that link is public by design.
- **Some accounts can't use unverified apps:** Workspace accounts whose administrator blocks them, and accounts in Google's Advanced Protection.
- **People trust the owner.** The owner runs the code and holds the secrets, and every user's Google tokens pass through the owner's Cloudflare Function. Mail itself goes only between Gmail and each person's browser.
- **Fallback.** If Google ever refuses unverified use, switch the project back to **Testing** and add each person under **Audience → Test users**. Everyone then signs in again every 7 days; nothing else changes.

## Growing beyond 100 people

Going past 100 users, or removing the warning, needs Google's verification of the shared project:
- a domain of your own, with a public home page and a privacy policy
- a demo video
- a paid independent security assessment, repeated every year

[docs/verification.md](verification.md) has the requirements, the costs and the steps.
