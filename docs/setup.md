# Setup

nilmail needs three things set up once: a Google login client in Personal mode, a Cloudflare Pages project with the login secrets, and the GitHub secrets the deploy workflow uses. Running it locally needs only the first.

The examples use these addresses; replace them if your Pages project gets a different name:

- production: `https://nilmail.pages.dev`
- preview (every push to `main`): `https://preview.nilmail.pages.dev`
- local: `http://127.0.0.1:4173`

## 1. Google login client (Personal mode)

Personal mode limits sign-in to the Google account that creates the project. It needs no review by Google, shows no "unverified app" screen, and keeps the sign-in alive instead of ending it after 7 days. A Personal-mode project can never be switched to another type.

1. Sign in to the Google Cloud console with the Gmail account nilmail should sort.
2. Open the Personal mode onboarding page: <https://console.cloud.google.com/auth/overview/personal>
3. Pick **Create a new project**, or let it create `personal-mode-app`.
4. Application type: **Web application**. Add these **Authorized redirect URIs**:
   - `https://nilmail.pages.dev/api/auth/callback`
   - `https://preview.nilmail.pages.dev/api/auth/callback`
   - `http://127.0.0.1:4173/api/auth/callback`
5. Accept the terms and click **Continue**.
6. Copy the **Client ID** and the **Client secret** from the dialog. The secret is shown only once.
7. Enable the Gmail API for the project: <https://console.cloud.google.com/apis/library/gmail.googleapis.com> → **Enable**.

Redirect URIs can be edited later under **Google Auth Platform → Clients** in the same project.

## 2. Session key

The session key encrypts the cookie that keeps you signed in. Make one with:

```sh
openssl rand -base64 32
```

Changing it later signs every device out.

## 3. Local use

Create `.dev.vars` in the repository root. It is git-ignored; never commit it.

```sh
GOOGLE_CLIENT_ID=…apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=…
SESSION_KEY=…
```

Then run `npm run dev` and open <http://127.0.0.1:4173>. Use exactly that address: `localhost` is a different address to Google and to the cookie.

## 4. Cloudflare Pages project

1. Create the project, with `main` as its production branch:

   ```sh
   npx wrangler pages project create nilmail --production-branch=main
   ```

2. Add the three values as secrets for both environments:

   ```sh
   for name in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET SESSION_KEY; do
     npx wrangler pages secret put $name --project-name nilmail
     npx wrangler pages secret put $name --project-name nilmail --env preview
   done
   ```

   The dashboard works too: **Workers & Pages → nilmail → Settings → Variables and Secrets**, once for Production and once for Preview.

## 5. GitHub

In the repository's **Settings → Secrets and variables → Actions**, add:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`: a token with the **Cloudflare Pages: Edit** permission.

After that:

- Every push to `main` that passes CI deploys to the preview address.
- Publishing a GitHub release deploys to production.

## 6. Install on the phone

Open the production address in Chrome on Android, sign in, then **⋮ → Add to Home screen** (or the **Install** button in the app).
