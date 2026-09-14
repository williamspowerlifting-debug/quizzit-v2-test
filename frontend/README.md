# Quizzit frontend

React + TypeScript + Vite implementation.

The application is intentionally a normal Vite SPA rather than another giant HTML file. Features are grouped by responsibility and API access is centralised in `src/api.ts`.

For the first migration, the UI talks to the existing Worker API. This means the new frontend can be tested against the existing backend before the backend route split is introduced.
