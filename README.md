# Quizzit v2

A clean rebuild of the Quizzit ESL listening-activity platform.

## Architecture

- Frontend: React + TypeScript + Vite
- Backend: Cloudflare Worker + TypeScript
- Storage: Cloudflare D1 (teacher/classroom data) and KV `LESSONS` (student-share payloads)
- Video: Bunny Stream/TUS
- Transcription: AssemblyAI
- AI: OpenRouter
- YouTube import: Tunelio/Quizzit's existing transcript pipeline

## Important

This is a parallel replacement for the current production app. Do not replace the production GitHub Pages site until the complete teacher -> video -> transcript -> activity -> student workflow has been tested.

The backend keeps the existing API contracts so the existing D1/KV data model remains compatible.

## Frontend setup

```bash
cd frontend
npm install
npm run dev
```

Set `VITE_WORKER_URL` in `.env` if you use a different Worker.

Build:

```bash
npm run build
```

The Vite output is `frontend/dist/`.

## Worker setup

```bash
cd worker
npm install
npx wrangler login
npx wrangler deploy
```

Configure secrets:

- `BUNNY_API_KEY`
- `BUNNY_LIBRARY_ID`
- `BUNNY_CDN_HOST`
- `ASSEMBLYAI_API_KEY`
- `OPENROUTER_KEY`
- `TRANSCRIPT_API_KEY`
- `TUNELIO_API_KEY`

Bindings:

- D1: `DB`
- KV: `LESSONS`

See `worker/wrangler.toml`.

## Google Sign-In

The current Google client ID is retained for compatibility. If you create a new Google OAuth client, change `GOOGLE_CLIENT_ID` in both the Worker and `frontend/src/config.ts`.

## Deployment

For GitHub Pages, deploy `frontend/dist` using your preferred GitHub Pages workflow. The Vite config uses a relative base path so the SPA can be hosted from a repository subpath.



## GitHub Web Test Deployment

This test repository is configured for GitHub Pages using the repository name `quizzit-v2-test`.

If you rename the repository, update `frontend/vite.config.ts` and change:

```ts
base: "/quizzit-v2-test/",
```

to match the new repository name.

The frontend intentionally uses the existing Quizzit Worker for the first V2 test. Do not deploy the Worker yet.
