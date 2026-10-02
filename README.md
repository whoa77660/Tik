# Social Tools Suite

A single Node.js website containing the two original tools:

- **TikVerify** — bulk TikTok link checker/verifier with exports and Create Service.
- **TikTok Explorer** — profile/video explorer using the existing RapidAPI setup.
- **Instagram Explorer** — a separate profile/media explorer with the same workflow as TikTok Explorer: search history, profile stats, posts/Reels, media-type filtering, sorting, pagination, bulk selection, submitted tracking, link copying, CSV/JSON export, and a keyboard-navigable detail view.

## Separate TikTok + Instagram tools

TikTok Explorer is not replaced. Instagram Explorer is added beside it as a separate iframe and server route (`/instagram-explorer`) so each tool keeps its own state and local history.

### Instagram API setup

The Instagram Explorer uses ReefAPI. The Instagram API key is separate from TikTok. It can be changed from the Instagram Explorer **Settings** screen and stored in Firebase Realtime Database. The browser never receives the Firebase service-account credentials or the full stored key.

### Instagram Settings / Firebase

The Settings screen is Instagram-only; TikTok settings and keys are not changed. Configure Firebase Admin on the server with either `FIREBASE_SERVICE_ACCOUNT_JSON` or a local `serviceAccountKey.json`, plus `FIREBASE_DATABASE_URL=https://free-call-a148e-default-rtdb.firebaseio.com`. No separate settings password is required. When Firebase is unavailable, the Settings screen uses a local server-side key fallback. With Firebase enabled, the key is stored at `settings/instagram/reefapiKey` by default.

The Instagram data source is third-party/public-data access; private Instagram accounts are not bypassed. Review the provider and Instagram terms for your intended use.

## One-click switching

Open `/` and use the two buttons in the top bar. Each tool stays loaded in its own iframe, so switching back does not reset the other tool's page state.

## Run

1. Install Node.js 18+ (Node 24 is fine).
2. Keep `.env` beside `server.js` and set `RAPIDAPI_KEY` (the old working variable) or `RAPIDAPI_KEYS` (comma-separated multiple keys). If both are set, `RAPIDAPI_KEYS` takes priority.
3. Run:

```bash
node server.js
```

4. Open `http://localhost:3000`

Install dependencies with `npm install` before running (Firebase Admin is required for the Instagram Settings screen).

## Security change

The old Explorer exposed RapidAPI keys in browser JavaScript. In this Node version the keys are read from `.env` by the server and Explorer calls `/api/explorer` instead.

If this project will be shared publicly, replace the supplied RapidAPI keys with your own private keys and do not commit `.env`.


## Instagram Firebase settings
The bundle includes a server-side Firebase Admin service-account file and local .env for the Instagram-only Settings feature. Do not commit either file to a public repository.
Firebase database: https://free-call-a148e-default-rtdb.firebaseio.com
In Instagram Explorer, open Settings and replace the ReefAPI key directly.


Instagram performance: profile, posts and reels are fetched concurrently; the initial page no longer duplicates the profile request. Firebase Instagram-key loading is coalesced across concurrent requests.
