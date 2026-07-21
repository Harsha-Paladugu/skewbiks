# Setup (Firebase + admin)

The site runs fully static. Firebase is optional and only powers sign-in, cloud
sync of per-user data (trainer progress, solver prefs), and the OO census's
shared solutions/moderation. Without it, everything falls back to localStorage
("demo mode").

## Current state — setup COMPLETE (2026-07-06)

The Firebase project **`skewbiks`** exists (Spark plan), its web app's config is
in [`js/config.js`](js/config.js), `.firebaserc` pins the project, the security
rules are deployed, and the console-only steps below (Firestore database, Google
sign-in, first-admin bootstrap) were **all completed on 2026-07-06** — the
census backend is live. This document stays as the reference walkthrough for
recreating the setup (e.g. a new Firebase project or a fresh admin).

## 1. Create the Firestore database (console-only on Spark)

[console.firebase.google.com/project/skewbiks/firestore](https://console.firebase.google.com/project/skewbiks/firestore)
→ Create database → location **nam5 (United States)** → **production mode**.

> The create wizard writes its own ruleset, overwriting the deployed one —
> redeploy after (step 4).

## 2. Enable Google sign-in

Console → Authentication → Get started → Sign-in method → **Google** → Enable.
(Authorized domains: `localhost` and `skewbiks.firebaseapp.com` are pre-listed;
add `skewbiks.com` before launch — M8 checklist.)

## 3. Become the admin

Admin is driven by an `admins/{uid}` collection (the rules trust any uid with a
doc there). Sign in on the OO page; the **About** tab shows your account's
**user id**. Create a document `admins/{your-uid}` (any contents) in the
Firebase console — console (and Firebase MCP) writes bypass the rules, which is
how you bootstrap the first admin. After that, existing admins can grant/revoke
others. `adminEmails` in `config.js` only gates the admin UI client-side; the
rules are what actually enforce writes. (uids are per-project — a uid from
another Firebase project does not carry over.)

## 4. Firestore security rules

The rules are version-controlled in [`firestore.rules`](firestore.rules) (wired up
by [`firebase.json`](firebase.json)) — they are the real authorization boundary
(`adminEmails` in `config.js` only gates the admin UI). Deploy them with:

```
firebase deploy --only firestore:rules
```

(or the Firebase MCP's deploy tool). Rules tests: see the header of
[`test/firestore.rules.test.mjs`](test/firestore.rules.test.mjs) — deps are
installed `--no-save`, and the emulator needs `firebase-tools@13` on a Java 17
machine (14+ wants Java 21).

## Notes

- The `apiKey` in `config.js` is a public client identifier, not a secret —
  access is enforced by the rules. Set `firebase: null` to fall back to demo mode.
- Deleting an approved solution (admin-only, e.g. in the console) leaves the
  derived `meta/doneMap` + `meta/stats` stale — run the Moderation tab's
  **Recompute solved bitmap** afterwards. Formats are frozen in
  [`docs/skewb-ground-truth.md`](docs/skewb-ground-truth.md) §"OO census
  persistence formats".
- The algorithm sheet does not use Firestore. Editing happens in the algs JSON
  (directly or via the Algorithms page's Export) — see [README.md](README.md).
