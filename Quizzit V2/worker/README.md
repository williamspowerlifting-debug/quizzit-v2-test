# Quizzit v2 Worker

The worker entry point is `src/index.ts`.

`src/compat-worker.js` contains the existing proven API implementation. It is intentionally retained behind the v2 entry boundary for the first migration release so that the rewrite does not simultaneously change the Bunny/AssemblyAI/YouTube/D1 behaviour that has already been tested.

After the new client has been validated, the compatibility file can be split into `auth`, `video`, `transcription`, `activities`, `classrooms`, and `student` route modules without changing the public API.

## Deploy

1. Replace the placeholder D1 and KV IDs in `wrangler.toml`.
2. Log in with `npx wrangler login`.
3. Add the secrets listed in the root README.
4. Run `npm install`.
5. Run `npm run deploy`.
