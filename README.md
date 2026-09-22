# Social Tools Suite

A single Node.js website containing the two original tools:

- **TikVerify** — bulk TikTok link checker/verifier with exports and Create Service.
- **TikTok Explorer** — profile/video explorer using the existing RapidAPI setup.
- **Instagram Explorer** — a separate profile/media explorer with the same workflow as TikTok Explorer: search history, profile stats, posts/Reels, media-type filtering, sorting, pagination, bulk selection, submitted tracking, link copying, CSV/JSON export, and a keyboard-navigable detail view.

## Separate TikTok + Instagram tools

TikTok Explorer is not replaced. Instagram Explorer is added beside it as a separate iframe and server route (`/instagram-explorer`) so each tool keeps its own state and local history.

### Instagram API setup

The Instagram Explorer defaults to HikerAPI. Put one or more HikerAPI access keys in `INSTAGRAM_API_KEYS` (comma-separated) or `HIKER_API_KEYS` on Render. You can also place them in `config.js` under `instagramApi.keys`. The default provider uses `GET /v1/user/by/username` for profile lookup and `GET /v1/user/medias/chunk` for paginated media.

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

No PHP, Composer, npm packages, or build step are required.

## Security change

The old Explorer exposed RapidAPI keys in browser JavaScript. In this Node version the keys are read from `.env` by the server and Explorer calls `/api/explorer` instead.

If this project will be shared publicly, replace the supplied RapidAPI keys with your own private keys and do not commit `.env`.
