# Google verification: opening nilmail beyond 100 people

nilmail runs as an unverified Google app. Google allows that for fewer than 100 people, all known personally to the owner, and counts it as personal use ([OAuth 2.0 Policies](https://developers.google.com/identity/protocols/oauth2/policies), [When is verification not needed](https://support.google.com/cloud/answer/13464323)). Until the app is verified:
- everyone sees the "unverified app" warning once
- Google lets at most 100 accounts grant access over the project's whole life

This page collects what it takes to get the shared Google project verified, so the warning goes away and the 100-account limit is lifted. Nothing here is needed while nilmail stays among people the owner knows. Facts were checked in November 2026; Google changes its process, so re-check the linked pages before starting.

## Why verification is a big step for nilmail

nilmail asks for `gmail.modify`, a **restricted** scope: it can read and change mail. Restricted scopes get the strictest review Google has:
1. brand verification
2. a review of how each scope is used
3. an independent security assessment, repeated every year

Apps with only sensitive scopes (such as `gmail.send`) skip the security assessment. nilmail can't, because sorting needs to change labels and move mail to the Bin.

## What Google requires

### 1. Brand verification (comes first)

Data-access verification can only be requested once the branding is published ([Brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)).

- **A public home page** that clearly belongs to the app. It must be reachable without signing in.
- **A privacy policy** on the same domain as the home page, linked from the consent screen.
- **Authorized domains**: the top private domain of the home page, the privacy policy and the redirect URIs.
- **Proven ownership of that domain in Google Search Console**, done by a project Owner or Editor.
- **A support email and a developer contact email**, kept current: Google sends the yearly reverification notices there.
- Optional: a logo. It's shown only after verification.

The automated branding check takes minutes; a manual review usually takes 2–3 business days.

### 2. Data-access verification (restricted scopes)

From [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification):

- **Declare the scopes** on the project's **Data access** page: `gmail.modify`, `openid`, `email`.
- **Justify each one** with the least privilege needed. Describe how the app uses `gmail.modify`, and why a narrower scope isn't enough: `gmail.readonly` can't archive, mark read or move to the Bin.
- **A demo video**, uploaded to YouTube as Unlisted. It shows:
  - how a user starts the sign-in and grants access
  - the consent screen with the app name, and the OAuth client ID visible in the address bar
  - the feature each scope enables
- **Up to three documentation links**, such as the home page and the privacy policy.
- **Follow-up questions** from Google's Trust & Safety team arrive by email.

Google says this "can potentially take several weeks".

### 3. Security assessment (CASA), every 12 months

- **When it's required:** apps that can access restricted data "from or through a third-party server" need an assessment by an independent lab that Google approves, under the App Defense Alliance's CASA framework. nilmail's sign-in Function holds every user's tokens, so assume this applies.
- **Repeats:** at least every 12 months after the lab's approval letter.
- **Cost:** the lab charges the app owner. Reports put the Tier 2 assessment at TAC Security, Google's preferred lab, at about $540–$1,800 a year ([bright-softwares](https://bright-softwares.com/blog/en/google-workspace/the-50000-gmail-add-on-myth-what-google-s-casa-certification-really-costs), [Switch Labs](https://www.switchlabs.dev/post/casa-tier-2-tier-3-security-review-providers-pricing-and-the-cheapest-option)). Other labs quote more. These are third-party reports, not Google prices.
- **Self scans:** reportedly no longer accepted for restricted scopes.
- **Turnaround:** reports range from about a week to two months.

### 4. Limited Use (applies to every app, verified or not)

The [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy) limits what may be done with Gmail data:
- use it only for features users can see in the app
- don't transfer or sell it, and don't use it for ads
- don't let people read it without the user's agreement

nilmail already works this way: mail never leaves the user's browser.

The privacy policy has to say so. The usual sentence, seen in many verified apps, is:

> nilmail's use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements.

## What would change in nilmail

- **A domain of your own,** attached to the Cloudflare Pages project, with redirect URIs and Search Console ownership moved to it. Whether a `pages.dev` address can pass domain verification is unclear; your own domain avoids the question. It costs a yearly registration fee.
- **A public home page** that explains the app, separate from the sign-in screen. The privacy policy already exists at `/privacy`, with the Limited Use statement; review it against Google's requirements.
- **The allow-list:**
  - Keep it to stay invitation-only without the warning.
  - Or add a way to let everyone in. Today an empty list blocks everyone, on purpose.
- **The sign-in Function** stays as it is. Its token handling is exactly what the security assessment looks at. The Function never stores mail, which keeps the assessment small.
- **Cloudflare's free plan** covers far more users than this: each signed-in user costs a few sign-in requests a day against the daily 100,000.

## Order of work

1. **The domain:** register it, attach it to the Pages project, and add its redirect URIs to the Google client.
2. **The pages:** write the home page and the privacy policy, with the Limited Use statement, and deploy them.
3. **Domain ownership:** prove it in Google Search Console.
4. **Branding:** fill in the **Branding** page (home page, privacy policy, authorized domain, contacts), run **Verify Branding**, and publish it.
5. **The demo video:** record it and upload it to YouTube as Unlisted.
6. **Data-access verification:** declare the scopes on **Data access**, then answer the questions in the **Verification Center** (justification, video, links).
7. **The security assessment:** book it with an approved lab when Google asks, and fix whatever it finds.
8. **After approval:** the warning disappears and the cap is lifted. Put a reminder in the calendar for the yearly reassessment.

## Open questions to settle at that point

- **Does a `pages.dev` address pass domain verification?** Assume no, and plan for your own domain.
- **Does the assessment apply when the server only passes tokens?** Google's wording ("from or through a third-party server") suggests yes, so plan for it.
- **What are the current CASA tiers and prices?** Check them with the labs at the time.
