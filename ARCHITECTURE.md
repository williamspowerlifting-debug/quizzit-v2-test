# Quizzit v2 architecture

## Design goals

1. Keep UI state out of the DOM.
2. Keep API calls out of components wherever possible.
3. Keep video-source differences behind a video service.
4. Keep the existing D1/KV contracts intact during migration.
5. Make the teacher editor independent from Bunny, AssemblyAI and OpenRouter implementation details.
6. Make the student experience work from either a public lesson link or a classroom session.
7. Keep large local uploads direct-to-Bunny using TUS so Cloudflare's request-body limit is not in the upload path.

## Current migration boundary

The new React frontend is the replacement application. The Worker entry point is also new, but delegates to the proven Worker implementation in `src/compat-worker.js` for the first deployment.

This is deliberate: changing the frontend architecture and the production video/backend pipeline simultaneously would make failures difficult to attribute. Once V2 is validated, the compatibility Worker can be split into the route modules below without changing the frontend API client.

## Target Worker modules

```text
src/
  index.ts
  router.ts
  middleware/
    cors.ts
    teacherAuth.ts
    studentAuth.ts
  services/
    bunny.ts
    assemblyai.ts
    openrouter.ts
    youtube.ts
    lessons.ts
    activities.ts
    classrooms.ts
  routes/
    auth.ts
    video.ts
    transcription.ts
    ai.ts
    activities.ts
    classrooms.ts
    student.ts
```

## Video readiness

There is one conceptual rule: AssemblyAI must only receive a URL after the exact MP4 is publicly available. Local uploads use Bunny TUS, followed by finalization and readiness polling. Google Drive uses Bunny Fetch and the same readiness service. Polling is 2 seconds in V2 instead of 5 seconds.

## Data compatibility

The existing tables and JSON activity shape are intentionally retained in the first V2 release. No destructive migration is required.
