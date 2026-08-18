# TikTok Node Suite

A single Node.js website containing the two original tools:

- **TikVerify** — bulk TikTok link checker/verifier with exports and Create Service.
- **TikTok Explorer** — profile/video explorer using RapidAPI.

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

No PHP, Composer, npm packages, or build step are required.

## Security change

The old Explorer exposed RapidAPI keys in browser JavaScript. In this Node version the keys are read from `.env` by the server and Explorer calls `/api/explorer` instead.

If this project will be shared publicly, replace the supplied RapidAPI keys with your own private keys and do not commit `.env`.
