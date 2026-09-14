/**
 * Cloudflare Worker — gapfill-ai-googledrive
 *
 * Secrets: BUNNY_API_KEY, BUNNY_LIBRARY_ID, BUNNY_CDN_HOST,
 *          ASSEMBLYAI_API_KEY, OPENROUTER_KEY, TRANSCRIPT_API_KEY, TUNELIO_API_KEY
 * KV binding: LESSONS
 * D1 binding: DB (or D1)
 */

function generateId(len = 7) {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let id = "";
  for (let i = 0; i < len; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function generateReadableCode(len = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < len; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// Google OAuth client ID (used to validate token audience)
const GOOGLE_CLIENT_ID = "187762853414-v7e6kqi1e86pkf0a2s1b92c6q245ralc.apps.googleusercontent.com";

async function verifyGoogleIdToken(idToken) {
  if (!idToken) return null;
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    if (!res.ok) return null;
    const payload = await res.json();
    if (payload.aud !== GOOGLE_CLIENT_ID) return null;
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

async function getDbBinding(env) {
  return env.DB || env.D1 || env['esl-exercises'] || null;
}

async function ensureDbSchema(db) {
  if (!db) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS exercises (
    id TEXT PRIMARY KEY,
    teacher_id TEXT,
    title TEXT,
    exercise_json TEXT,
    created_at TEXT,
    updated_at TEXT
  );`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    teacher_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS teachers (
    id TEXT PRIMARY KEY,
    email TEXT,
    name TEXT,
    created_at TEXT
  );`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS student_lessons (
    id TEXT PRIMARY KEY,
    lesson_json TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );`).run();

  await db.prepare(`CREATE TABLE IF NOT EXISTS classrooms (
    id TEXT PRIMARY KEY,
    teacher_id TEXT NOT NULL,
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`).run();

  await db.prepare(`CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    classroom_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE
  );`).run();

  await db.prepare(`CREATE TABLE IF NOT EXISTS classroom_activities (
    classroom_id TEXT NOT NULL,
    activity_id TEXT NOT NULL,
    assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (classroom_id, activity_id),
    FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE,
    FOREIGN KEY (activity_id) REFERENCES exercises(id) ON DELETE CASCADE
  );`).run();

  await db.prepare(`CREATE TABLE IF NOT EXISTS student_attempts (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL,
    activity_id TEXT NOT NULL,
    attempt_number INTEGER NOT NULL,
    correct_answers INTEGER NOT NULL,
    total_questions INTEGER NOT NULL,
    score_percent INTEGER NOT NULL,
    completed_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
  );`).run();

  await db.prepare(`CREATE TABLE IF NOT EXISTS student_sessions (
    token TEXT PRIMARY KEY,
    student_id TEXT NOT NULL,
    classroom_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
  );`).run();

  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_classrooms_teacher ON classrooms(teacher_id);`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_students_classroom ON students(classroom_id);`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_attempts_student ON student_attempts(student_id);`).run();
}

async function sha256Hex(value) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function generateSessionId() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function createSession(db, teacherId) {
  const sessionId = await generateSessionId();
  const now = new Date();
  const expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  await db.prepare(
    `INSERT INTO sessions (session_id, teacher_id, created_at, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(sessionId, teacherId, now.toISOString(), expires.toISOString(), now.toISOString()).run();
  return { sessionId, expiresAt: expires };
}

async function getSession(db, sessionId) {
  if (!sessionId) return null;
  const row = await db.prepare(
    `SELECT session_id, teacher_id, expires_at FROM sessions WHERE session_id = ?`
  ).bind(sessionId).first();
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    await db.prepare(`DELETE FROM sessions WHERE session_id = ?`).bind(sessionId).run().catch(() => {});
    return null;
  }
  return row;
}

async function touchSession(db, sessionId) {
  const now = new Date().toISOString();
  await db.prepare(`UPDATE sessions SET last_seen_at = ? WHERE session_id = ?`)
    .bind(now, sessionId).run();
}

async function deleteSession(db, sessionId) {
  if (!sessionId || !db) return;
  await db.prepare(`DELETE FROM sessions WHERE session_id = ?`).bind(sessionId).run();
}

function getSessionIdFromCookie(request) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const match = cookieHeader.match(/(?:^|;\s*)session_id=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function requireTeacher(request, env) {
  const db = await getDbBinding(env);
  if (!db) return null;
  const sessionId = getSessionIdFromCookie(request);
  if (!sessionId) return null;
  const session = await getSession(db, sessionId);
  if (!session) return null;
  touchSession(db, sessionId).catch(() => {});
  return session.teacher_id;
}

async function upsertTeacher(db, id, email, name) {
  if (!db || !id) return;
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO teachers (id, email, name, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET email=excluded.email, name=excluded.name`
  ).bind(id, email || '', name || '', now).run();
}

export default {
  async fetch(request, env) {
    const url  = new URL(request.url);
    const path = url.pathname;

    const requestOrigin = request.headers.get('Origin');
    const cors = {
      "Access-Control-Allow-Origin":      requestOrigin || '*',
      "Access-Control-Allow-Methods":     "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":     "Content-Type",
      "Access-Control-Allow-Credentials": "true",
      "Vary":                             "Origin",
    };
    const ok  = (data, extra = {}) => new Response(JSON.stringify(data), {
      status:  200,
      headers: { "Content-Type": "application/json", ...cors, ...extra },
    });
    const err = (msg, status = 500) => new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { "Content-Type": "application/json", ...cors },
    });

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      if (path === "/create-bunny-video" && request.method === "POST") {
        const { title } = await request.json().catch(() => ({}));
        const res = await fetch(
          `https://video.bunnycdn.com/library/${env.BUNNY_LIBRARY_ID}/videos`,
          {
            method: "POST",
            headers: { AccessKey: env.BUNNY_API_KEY, "Content-Type": "application/json" },
            body: JSON.stringify({ title: title || "exercise" }),
          }
        );
        if (!res.ok) return err("Bunny create failed: " + res.status);

        const data = await res.json();
        const expirationTime = Math.floor(Date.now() / 1000) + (24 * 60 * 60);
        const signature = await sha256Hex(
          String(env.BUNNY_LIBRARY_ID) +
          String(env.BUNNY_API_KEY) +
          String(expirationTime) +
          String(data.guid)
        );

        return ok({
          guid: data.guid,
          libraryId: env.BUNNY_LIBRARY_ID,
          cdnHost: env.BUNNY_CDN_HOST,
          tusEndpoint: "https://video.bunnycdn.com/tusupload",
          authorizationSignature: signature,
          authorizationExpire: expirationTime,
        });
      }

      // FIXED: finalization now checks the actual public CDN object.
      if (path === "/finalize-bunny-upload" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const guid = body.guid || body.videoId || body.id;
        if (!guid) return err("Missing guid", 400);

        const res = await fetch(
          `https://video.bunnycdn.com/library/${env.BUNNY_LIBRARY_ID}/videos/${guid}`,
          {
            headers: {
              AccessKey: env.BUNNY_API_KEY,
              Accept: "application/json"
            }
          }
        );

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          return err(
            data.message || data.error || `Bunny finalization check failed: ${res.status}`,
            res.status
          );
        }

        const bunnyStatus = Number(data.status);
        const failed = bunnyStatus === 5 || bunnyStatus === 6;
        const hasMP4Fallback = data.hasMP4Fallback === true;
        const available = String(data.availableResolutions || "");

        const candidates = available.split(",")
          .map(x => x.trim())
          .filter(x => /^\d+p$/.test(x))
          .sort((a, b) => parseInt(a) - parseInt(b));

        const resolution = candidates.includes("360p")
          ? "360p"
          : (candidates[0] || (hasMP4Fallback ? "360p" : null));

        const candidateUrl = resolution
          ? `https://${env.BUNNY_CDN_HOST}/${guid}/play_${resolution}.mp4`
          : null;

        let cdnReady = false;
        let cdnProbeStatus = null;

        if (!failed && bunnyStatus === 4 && hasMP4Fallback && candidateUrl) {
          try {
            let probe = await fetch(candidateUrl, {
              method: "GET",
              headers: { Range: "bytes=0-0" }
            });
            cdnProbeStatus = probe.status;
            cdnReady = probe.status === 200 || probe.status === 206;

            if (!cdnReady && (probe.status === 404 || probe.status === 405)) {
              const headProbe = await fetch(candidateUrl, { method: "HEAD" });
              cdnProbeStatus = headProbe.status;
              cdnReady = headProbe.ok;
            }
          } catch (_) {
            cdnReady = false;
            cdnProbeStatus = 0;
          }
        }

        const done = bunnyStatus === 4 && hasMP4Fallback && !!candidateUrl && cdnReady;
        const cdnUrl = done ? candidateUrl : null;

        const error = failed
          ? (data.message || data.error || "Bunny reported that the video upload/encoding failed.")
          : null;

        return ok({
          ok: true,
          guid,
          done,
          failed,
          error,
          cdnUrl,
          cdnReady,
          cdnProbeStatus,
          encodeProgress: Number(data.encodeProgress) || 0,
          bunnyStatus,
          availableResolutions: data.availableResolutions || null,
          hasMP4Fallback
        });
      }

      if (path === "/upload-bunny-chunk" && request.method === "PUT") {
        const guid = url.searchParams.get("guid");
        if (!guid) return err("Missing guid", 400);
        const res = await fetch(
          `https://video.bunnycdn.com/library/${env.BUNNY_LIBRARY_ID}/videos/${guid}`,
          { method: "PUT", headers: { AccessKey: env.BUNNY_API_KEY }, body: request.body, duplex: "half" }
        );
        if (!res.ok) return err("Bunny upload failed: " + res.status);
        return ok({ ok: true });
      }

      // FIXED: this endpoint must NOT say "done" merely because Bunny status == 4.
      // It probes the real CDN MP4 first.
      if (path === "/bunny-status" && request.method === "GET") {
        const guid = url.searchParams.get("guid");
        if (!guid) return err("Missing guid", 400);

        const res = await fetch(
          `https://video.bunnycdn.com/library/${env.BUNNY_LIBRARY_ID}/videos/${guid}`,
          { headers: { AccessKey: env.BUNNY_API_KEY } }
        );
        if (!res.ok) return err("Bunny status failed: " + res.status);

        const data = await res.json();
        const bunnyStatus = Number(data.status);
        const failed = bunnyStatus === 5 || bunnyStatus === 6;
        const hasMP4Fallback = data.hasMP4Fallback === true;

        const available = String(data.availableResolutions || "");
        const candidates = available.split(",")
          .map(x => x.trim())
          .filter(x => /^\d+p$/.test(x))
          .sort((a, b) => parseInt(a) - parseInt(b));

        const resolution = candidates.includes("360p")
          ? "360p"
          : (candidates[0] || (hasMP4Fallback ? "360p" : null));

        const candidateUrl = resolution
          ? `https://${env.BUNNY_CDN_HOST}/${guid}/play_${resolution}.mp4`
          : null;

        let cdnReady = false;
        let cdnProbeStatus = null;

        if (!failed && bunnyStatus === 4 && candidateUrl) {
          try {
            // Status 4 means Bunny has finished encoding, but the public CDN
            // object can appear a little later. Probe the actual MP4.
            let probe = await fetch(candidateUrl, {
              method: "GET",
              headers: { Range: "bytes=0-0" }
            });

            cdnProbeStatus = probe.status;
            cdnReady = probe.status === 200 || probe.status === 206;

            if (!cdnReady && (probe.status === 404 || probe.status === 405)) {
              const headProbe = await fetch(candidateUrl, { method: "HEAD" });
              cdnProbeStatus = headProbe.status;
              cdnReady = headProbe.status === 200 || headProbe.status === 206;
            }
          } catch (_) {
            cdnReady = false;
            cdnProbeStatus = 0;
          }
        }

        const done =
          bunnyStatus === 4 &&
          !!candidateUrl &&
          cdnReady;

        const cdnUrl = done ? candidateUrl : null;

        const error = failed
          ? (data.message ||
             data.error ||
             "Bunny reported that the video upload/encoding failed.")
          : null;

        return ok({
          done,
          failed,
          error,
          cdnUrl,
          cdnReady,
          cdnProbeStatus,
          encodeProgress: Number(data.encodeProgress) || 0,
          bunnyStatus,
          availableResolutions: data.availableResolutions || null,
          hasMP4Fallback
        });
      }

      if (path === "/transcribe" && request.method === "POST") {
        const { audioUrl } = await request.json().catch(() => ({}));
        if (!audioUrl) return err("Missing audioUrl", 400);
        const res = await fetch("https://api.assemblyai.com/v2/transcript", {
          method: "POST",
          headers: { authorization: env.ASSEMBLYAI_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({
            audio_url: audioUrl,
            speech_models: ["universal-3-5-pro","universal-2"],
            punctuate: true,
            format_text: true,
            disfluencies: false,
          }),
        });
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          return err("AssemblyAI submit failed: " + (e.error || res.status));
        }
        const data = await res.json();
        return ok({ pending: true, jobId: data.id });
      }

      if (path === "/transcribe-status" && request.method === "GET") {
        const jobId = url.searchParams.get("jobId");
        if (!jobId) return err("Missing jobId", 400);
        const res = await fetch(`https://api.assemblyai.com/v2/transcript/${jobId}`, {
          headers: { authorization: env.ASSEMBLYAI_API_KEY },
        });
        if (!res.ok) return err("AssemblyAI status failed: " + res.status);
        const data = await res.json();
        if (data.status === "completed") {
          const words = (data.words || []).map(w => ({ text: w.text, start: w.start, end: w.end }));
          return ok({ done: true, text: data.text || "", words });
        } else if (data.status === "error") {
          return ok({ done: false, error: data.error || "Transcription failed" });
        } else {
          return ok({ done: false });
        }
      }

      if (path === "/generate-gaps" && request.method === "POST") {
        const { transcript, level } = await request.json().catch(() => ({}));
        if (!transcript) return err("Missing transcript", 400);

        const prompt =
`You are an English language teacher creating a gap-fill listening exercise at ${level || "B1"} CEFR level.

Given the following transcript, select the most appropriate words to remove as gaps for students at this level.

Rules:
- Choose content words (nouns, verbs, adjectives, key adverbs) — NOT grammar/function words like "the", "a", "is", "and"
- Choose words suitable for ${level || "B1"} difficulty
- Aim for roughly one gap per sentence, more for longer sentences
- Return ONLY valid JSON, nothing else

Return this exact structure:
{
  "sections": [
    { "sentence": "the original sentence text", "answers": ["word1"] },
    { "sentence": "another sentence", "answers": ["word2", "word3"] }
  ]
}

Transcript:
${transcript}`;

        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: "Bearer " + env.OPENROUTER_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "openai/gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
            temperature: 0.3,
          }),
        });
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          return err("OpenRouter failed: " + (e.error?.message || res.status));
        }
        const data = await res.json();
        let result;
        try { result = JSON.parse(data.choices[0].message.content); }
        catch (e) { return err("AI returned invalid JSON", 502); }
        return ok(result);
      }

      if (path === "/save-lesson" && request.method === "POST") {
        const lesson = await request.json().catch(() => null);
        if (!lesson || !lesson.videoUrl) return err("Missing or invalid lesson", 400);

        if (env.LESSONS) {
          let id = generateId();
          if (await env.LESSONS.get(id)) id = generateId();
          await env.LESSONS.put(id, JSON.stringify(lesson), { expirationTtl: 31_536_000 });
          return ok({ id });
        }

        const db = await getDbBinding(env);
        if (!db) return err("No lesson storage is bound (configure KV LESSONS or D1)", 500);
        await ensureDbSchema(db);
        let id = generateId();
        if (await db.prepare(`SELECT id FROM student_lessons WHERE id = ?`).bind(id).first()) id = generateId();
        const expiresAt = new Date(Date.now() + 31_536_000_000).toISOString();
        await db.prepare(`INSERT INTO student_lessons (id, lesson_json, expires_at) VALUES (?, ?, ?)`)
          .bind(id, JSON.stringify(lesson), expiresAt).run();
        return ok({ id });
      }

      if (path === "/load-lesson" && request.method === "GET") {
        const id = url.searchParams.get("id");
        if (!id) return err("Missing id", 400);

        if (env.LESSONS) {
          const raw = await env.LESSONS.get(id);
          if (!raw) return err("Lesson not found", 404);
          return ok(JSON.parse(raw));
        }

        const db = await getDbBinding(env);
        if (!db) return err("No lesson storage is bound (configure KV LESSONS or D1)", 500);
        await ensureDbSchema(db);
        const row = await db.prepare(`SELECT lesson_json, expires_at FROM student_lessons WHERE id = ?`).bind(id).first();
        if (!row || new Date(row.expires_at) < new Date()) {
          if (row) await db.prepare(`DELETE FROM student_lessons WHERE id = ?`).bind(id).run();
          return err("Lesson not found", 404);
        }
        return ok(JSON.parse(row.lesson_json));
      }

      if (path === "/gdrive-to-bunny" && request.method === "POST") {
        const { driveUrl, title } = await request.json().catch(() => ({}));
        if (!driveUrl) return err("Missing driveUrl", 400);

        let fileId = null;
        const m1 = driveUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
        const m2 = driveUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        if (m1) fileId = m1[1];
        else if (m2) fileId = m2[1];
        if (!fileId) return err("Could not extract Google Drive file ID.", 400);

        const downloadUrl =
          `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;

        const fetchRes = await fetch(
          `https://video.bunnycdn.com/library/${env.BUNNY_LIBRARY_ID}/videos/fetch`,
          {
            method: "POST",
            headers: {
              AccessKey: env.BUNNY_API_KEY,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              url: downloadUrl,
              title: title || "Google Drive import",
            }),
          }
        );

        const fetchData = await fetchRes.json().catch(() => ({}));
        if (!fetchRes.ok) {
          const detail = fetchData.message || fetchData.error || fetchRes.status;
          return err(
            `Bunny could not fetch the Google Drive video (${detail}). Make sure the Drive file is shared publicly and is a direct video file.`,
            502
          );
        }

        const guid = fetchData.guid || fetchData.id || fetchData.videoId;
        if (!guid) return err("Bunny accepted the Drive import but did not return a video ID.", 502);

        return ok({
          guid,
          libraryId: env.BUNNY_LIBRARY_ID,
          cdnHost: env.BUNNY_CDN_HOST
        });
      }

      if (path === "/import-video" && request.method === "POST") {
        try {
          const body = await request.json();
          const url = body.url;
          if (!url) return err("Missing video URL.", 400);

          const tunelioUrl = `https://tunelio.dev/create?quality=360p&url=${encodeURIComponent(url)}`;
          const res = await fetch(tunelioUrl, {
            headers: { "Authorization": `Bearer ${env.TUNELIO_API_KEY}` }
          });
          const data = await res.json();
          if (!res.ok) {
            return err(data.message || data.error || "Tunelio request failed.", res.status);
          }
          return ok(data);
        } catch (e) {
          return err(e.message || "Import failed.", 500);
        }
      }

      if (path === "/save-teacher-exercise" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body) return err("Missing request body", 400);

        let teacherId = await requireTeacher(request, env);
        if (!teacherId) {
          teacherId = body.teacherId || null;
        }
        if (!teacherId) return err("Not authenticated", 401);
        const exerciseId = body.exerciseId || ("ex_" + generateId(10));
        const now = new Date().toISOString();

        const exerciseData = {
          exerciseId,
          teacherId,
          name: body.name || "Untitled Exercise",
          createdAt: body.createdAt || now,
          updatedAt: now,
          lessonId: body.lessonId || null,
          videoMode: body.videoMode || null,
          videoUrl: body.videoUrl || "",
          youtubeVideoId: body.youtubeVideoId || null,
          youtubeTitle: body.youtubeTitle || null,
          sentences: body.sentences || [],
          tags: Array.isArray(body.tags) ? body.tags : [],
          originalTranscript: body.originalTranscript || null,
        };

        if (exerciseData.lessonId) {
          try {
            if (env.LESSONS) {
              const existingLessonRaw = await env.LESSONS.get(exerciseData.lessonId);

              if (existingLessonRaw) {
                let existingLesson = {};
                try {
                  existingLesson = JSON.parse(existingLessonRaw);
                } catch (e) {
                  existingLesson = {};
                }

                const updatedLesson = {
                  ...existingLesson,
                  videoUrl: exerciseData.videoUrl || existingLesson.videoUrl || "",
                  videoMode: exerciseData.videoMode || existingLesson.videoMode || null,
                  youtubeVideoId: exerciseData.youtubeVideoId || existingLesson.youtubeVideoId || null,
                  youtubeTitle: exerciseData.youtubeTitle || existingLesson.youtubeTitle || null,
                  sentences: exerciseData.sentences || [],
                  title: exerciseData.name || existingLesson.title || existingLesson.name || "",
                  updatedAt: exerciseData.updatedAt
                };

                await env.LESSONS.put(
                  exerciseData.lessonId,
                  JSON.stringify(updatedLesson),
                  { expirationTtl: 31_536_000 }
                );
              }
            } else {
              const dbForLesson = await getDbBinding(env);

              if (dbForLesson) {
                await ensureDbSchema(dbForLesson);

                const lessonRow = await dbForLesson.prepare(
                  `SELECT lesson_json FROM student_lessons WHERE id = ?`
                ).bind(exerciseData.lessonId).first();

                if (lessonRow) {
                  let existingLesson = {};
                  try {
                    existingLesson = JSON.parse(lessonRow.lesson_json || '{}');
                  } catch (e) {
                    existingLesson = {};
                  }

                  const updatedLesson = {
                    ...existingLesson,
                    videoUrl: exerciseData.videoUrl || existingLesson.videoUrl || "",
                    videoMode: exerciseData.videoMode || existingLesson.videoMode || null,
                    youtubeVideoId: exerciseData.youtubeVideoId || existingLesson.youtubeVideoId || null,
                    youtubeTitle: exerciseData.youtubeTitle || existingLesson.youtubeTitle || null,
                    sentences: exerciseData.sentences || [],
                    title: exerciseData.name || existingLesson.title || existingLesson.name || "",
                    updatedAt: exerciseData.updatedAt
                  };

                  await dbForLesson.prepare(
                    `UPDATE student_lessons SET lesson_json = ? WHERE id = ?`
                  ).bind(
                    JSON.stringify(updatedLesson),
                    exerciseData.lessonId
                  ).run();
                }
              }
            }
          } catch (syncError) {
            console.warn("Could not sync existing student link:", syncError);
          }
        }

        const db = await getDbBinding(env);
        if (db) {
          await ensureDbSchema(db);
          try { await upsertTeacher(db, teacherId, '', ''); } catch (e) {}

          await db.prepare(
            `INSERT INTO exercises (id, teacher_id, title, exercise_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               teacher_id=excluded.teacher_id, title=excluded.title, exercise_json=excluded.exercise_json, updated_at=excluded.updated_at`)
            .bind(exerciseId, exerciseData.teacherId, exerciseData.name, JSON.stringify(exerciseData), exerciseData.createdAt, exerciseData.updatedAt)
            .run();

          return ok({ exerciseId });
        }

        if (!env.LESSONS) return err("KV namespace LESSONS not bound", 500);
        await env.LESSONS.put("teacher_ex_" + exerciseId, JSON.stringify(exerciseData), { expirationTtl: 31_536_000 });

        const indexKey = "teacher_index_" + teacherId;
        let index = [];
        const rawIndex = await env.LESSONS.get(indexKey);
        if (rawIndex) { try { index = JSON.parse(rawIndex); } catch {} }

        const existingIdx = index.findIndex(e => e.exerciseId === exerciseId);
        const indexEntry = {
          exerciseId,
          name: exerciseData.name,
          createdAt: exerciseData.createdAt,
          updatedAt: now,
          lessonId: exerciseData.lessonId,
          videoUrl: exerciseData.videoUrl,
          sentenceCount: (body.sentences || []).length,
          gapCount: (body.sentences || []).reduce((n, s) => n + (s.words || []).filter(w => w.g).length, 0),
          sentences: body.sentences || [],
        };

        if (existingIdx >= 0) index[existingIdx] = indexEntry;
        else index.unshift(indexEntry);

        if (index.length > 200) index = index.slice(0, 200);
        await env.LESSONS.put(indexKey, JSON.stringify(index), { expirationTtl: 31_536_000 });

        return ok({ exerciseId });
      }

      if (path === "/list-teacher-exercises" && request.method === "GET") {
        const teacherId = url.searchParams.get("teacherId");
        if (!teacherId) return err("Missing teacherId", 400);

        const db = await getDbBinding(env);
        if (db) {
          await ensureDbSchema(db);
          const rows = await db.prepare(
            `SELECT id, title, exercise_json, created_at, updated_at FROM exercises WHERE teacher_id = ? ORDER BY updated_at DESC LIMIT 200`
          ).bind(teacherId).all();
          const results = (rows && rows.results) ? rows.results : [];
          const exercises = results.map(r => {
            let parsed = {};
            try { parsed = JSON.parse(r.exercise_json || '{}'); } catch (e) { parsed = {}; }
            return {
              exerciseId: r.id,
              name: r.title || parsed.name || parsed.title || '',
              createdAt: r.created_at || parsed.createdAt || parsed.created_at || null,
              updatedAt: r.updated_at || parsed.updatedAt || parsed.updated_at || null,
              lessonId: parsed.lessonId || parsed.lesson_id || null,
              videoUrl: parsed.videoUrl || parsed.video_url || null,
              sentences: parsed.sentences || [],
              tags: Array.isArray(parsed.tags) ? parsed.tags : [],
            };
          });
          return ok({ exercises });
        }

        if (!env.LESSONS) return err("KV namespace LESSONS not bound", 500);
        const rawIndex = await env.LESSONS.get("teacher_index_" + teacherId);
        if (!rawIndex) return ok({ exercises: [] });
        let index = [];
        try { index = JSON.parse(rawIndex); } catch {}
        return ok({ exercises: index });
      }

      if (path === "/verify-google-token" && request.method === "POST") {
        const { idToken } = await request.json().catch(() => ({}));
        if (!idToken) return err("Missing idToken", 400);
        const payload = await verifyGoogleIdToken(idToken);
        if (!payload) return err("Invalid or expired idToken", 401);
        return ok({ valid: true, payload });
      }

      if (path === "/google-login" && request.method === "POST") {
        const { idToken, oldTeacherId } = await request.json().catch(() => ({}));
        if (!idToken) return err("Missing idToken", 400);
        const payload = await verifyGoogleIdToken(idToken);
        if (!payload) return err("Invalid or expired idToken", 401);
        const teacherId = "g_" + payload.sub;

        const db = await getDbBinding(env);
        if (!db) return err("Database not available", 500);
        await ensureDbSchema(db);
        await upsertTeacher(db, teacherId, payload.email || '', payload.name || '');

        if (oldTeacherId && typeof oldTeacherId === 'string' && oldTeacherId.startsWith('t_') && env.LESSONS) {
          try {
            const rawIndex = await env.LESSONS.get("teacher_index_" + oldTeacherId);
            const oldIndex = rawIndex ? JSON.parse(rawIndex) : [];
            for (const entry of (Array.isArray(oldIndex) ? oldIndex : [])) {
              const exId = entry.exerciseId;
              if (!exId) continue;
              const raw = await env.LESSONS.get("teacher_ex_" + exId);
              if (!raw) continue;
              const exerciseData = JSON.parse(raw);
              exerciseData.teacherId = teacherId;
              await db.prepare(
                `INSERT INTO exercises (id, teacher_id, title, exercise_json, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET teacher_id=excluded.teacher_id, title=excluded.title,
                 exercise_json=excluded.exercise_json, updated_at=excluded.updated_at`
              ).bind(exId, teacherId, exerciseData.name || '', JSON.stringify(exerciseData),
                     exerciseData.createdAt || new Date().toISOString(),
                     exerciseData.updatedAt || new Date().toISOString()).run();
              await env.LESSONS.delete("teacher_ex_" + exId);
            }
            await env.LESSONS.delete("teacher_index_" + oldTeacherId);
          } catch (migErr) {
            console.warn("Migration error during /google-login:", migErr);
          }
        }

        const { sessionId, expiresAt } = await createSession(db, teacherId);
        const cookieValue = `session_id=${encodeURIComponent(sessionId)}; HttpOnly; Secure; SameSite=None; Max-Age=2592000; Path=/`;
        return ok(
          { ok: true, teacherId, name: payload.name || '', email: payload.email || '' },
          { "Set-Cookie": cookieValue }
        );
      }

      if (path === "/logout" && request.method === "POST") {
        const db = await getDbBinding(env);
        if (db) {
          const sessionId = getSessionIdFromCookie(request);
          await deleteSession(db, sessionId);
        }
        const clearCookie = `session_id=; HttpOnly; Secure; SameSite=None; Max-Age=0; Path=/`;
        return ok({ ok: true }, { "Set-Cookie": clearCookie });
      }

      if (path === "/migrate-teacher-exercises" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const { oldTeacherId } = body || {};
        const newTeacherId = await requireTeacher(request, env);
        if (!newTeacherId) return err("Not authenticated", 401);
        if (!oldTeacherId || typeof oldTeacherId !== 'string') return ok({ migrated: 0 });
        if (!oldTeacherId.startsWith('t_')) return ok({ migrated: 0 });

        const db = await getDbBinding(env);
        let migrated = 0;
        const rawIndex = env.LESSONS ? await env.LESSONS.get("teacher_index_" + oldTeacherId) : null;
        let oldIndex = [];
        if (rawIndex) { try { oldIndex = JSON.parse(rawIndex); } catch (e) { oldIndex = []; } }
        if (!oldIndex.length) return ok({ migrated: 0 });

        if (db) {
          await ensureDbSchema(db);
          for (const entry of oldIndex) {
            try {
              const exId = entry.exerciseId;
              if (!exId) continue;
              const existRes = await db.prepare(`SELECT id, teacher_id FROM exercises WHERE id = ?`).bind(exId).first();
              const existRow = existRes && existRes.results ? existRes.results[0] : existRes;
              if (existRow && existRow.teacher_id === newTeacherId) continue;

              let raw = null;
              if (env.LESSONS) raw = await env.LESSONS.get("teacher_ex_" + exId);
              if (!raw) continue;
              const exerciseData = JSON.parse(raw);
              exerciseData.teacherId = newTeacherId;

              await db.prepare(
                `INSERT INTO exercises (id, teacher_id, title, exercise_json, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET
                   teacher_id=excluded.teacher_id, title=excluded.title, exercise_json=excluded.exercise_json, updated_at=excluded.updated_at`
              ).bind(exId, exerciseData.teacherId, exerciseData.name || '', JSON.stringify(exerciseData), exerciseData.createdAt || new Date().toISOString(), exerciseData.updatedAt || new Date().toISOString()).run();

              migrated++;
              if (env.LESSONS) await env.LESSONS.delete("teacher_ex_" + exId);
            } catch (e) {}
          }
          if (env.LESSONS) await env.LESSONS.delete("teacher_index_" + oldTeacherId);
          return ok({ migrated });
        }

        if (env.LESSONS) {
          const newIndexKey = "teacher_index_" + newTeacherId;
          let newIndex = [];
          const rawNew = await env.LESSONS.get(newIndexKey);
          if (rawNew) { try { newIndex = JSON.parse(rawNew); } catch (e) { newIndex = []; } }

          for (const entry of oldIndex) {
            try {
              const exId = entry.exerciseId;
              if (!exId) continue;
              const raw = await env.LESSONS.get("teacher_ex_" + exId);
              if (!raw) continue;
              const exerciseData = JSON.parse(raw);
              exerciseData.teacherId = newTeacherId;
              await env.LESSONS.put("teacher_ex_" + exId, JSON.stringify(exerciseData), { expirationTtl: 31_536_000 });
              if (!newIndex.find(e => e.exerciseId === exId)) {
                newIndex.unshift({ exerciseId: exId, name: exerciseData.name, createdAt: exerciseData.createdAt, updatedAt: exerciseData.updatedAt, lessonId: exerciseData.lessonId, videoUrl: exerciseData.videoUrl, sentenceCount: (exerciseData.sentences || []).length, gapCount: (exerciseData.sentences || []).reduce((n,s)=> n + (s.words||[]).filter(w=>w.g).length,0), sentences: exerciseData.sentences || [] });
              }
              migrated++;
            } catch (e) {}
          }
          await env.LESSONS.put(newIndexKey, JSON.stringify(newIndex), { expirationTtl: 31_536_000 });
          await env.LESSONS.delete("teacher_index_" + oldTeacherId);
          return ok({ migrated });
        }
        return ok({ migrated: 0 });
      }

      if (path === "/load-teacher-exercise" && request.method === "GET") {
        const teacherId  = url.searchParams.get("teacherId");
        const exerciseId = url.searchParams.get("exerciseId");
        if (!teacherId || !exerciseId) return err("Missing teacherId or exerciseId", 400);

        const db = await getDbBinding(env);
        if (db) {
          await ensureDbSchema(db);
          const rowRes = await db.prepare(`SELECT id, teacher_id, title, exercise_json, created_at, updated_at FROM exercises WHERE id = ?`).bind(exerciseId).first();
          const row = rowRes && rowRes.results ? rowRes.results[0] : rowRes;
          if (!row) return err("Exercise not found", 404);
          if (row.teacher_id !== teacherId) return err("Not authorised", 403);
          let parsed = {};
          try { parsed = JSON.parse(row.exercise_json || '{}'); } catch (e) { parsed = {}; }
          return ok({
            exerciseId: row.id,
            teacherId: row.teacher_id,
            name: row.title || parsed.name || parsed.title || '',
            createdAt: row.created_at || parsed.createdAt || parsed.created_at || null,
            updatedAt: row.updated_at || parsed.updatedAt || parsed.updated_at || null,
            lessonId: parsed.lessonId || parsed.lesson_id || null,
            videoMode: parsed.videoMode || parsed.video_mode || null,
            videoUrl: parsed.videoUrl || parsed.video_url || null,
            youtubeVideoId: parsed.youtubeVideoId || parsed.youtube_video_id || null,
            youtubeTitle: parsed.youtubeTitle || parsed.youtube_title || null,
            sentences: parsed.sentences || [],
            tags: Array.isArray(parsed.tags) ? parsed.tags : [],
            originalTranscript: parsed.originalTranscript || null,
          });
        }

        if (!env.LESSONS) return err("KV namespace LESSONS not bound", 500);
        const raw = await env.LESSONS.get("teacher_ex_" + exerciseId);
        if (!raw) return err("Exercise not found", 404);
        const exercise = JSON.parse(raw);
        if (exercise.teacherId !== teacherId) return err("Not authorised", 403);
        return ok(exercise);
      }

      async function getTranscriptFromTranscriptAPI(videoUrl, apiKey) {
        const endpoint = "https://transcriptapi.com/api/v2/youtube/transcript?" + new URLSearchParams({
          video_url: videoUrl, include_timestamp: "true", send_metadata: "true"
        });
        const response = await fetch(endpoint, {
          method: "GET",
          headers: { "Authorization": `Bearer ${apiKey}`, "Accept": "application/json" }
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || data.error || "TranscriptAPI request failed.");
        return data;
      }

      if (path === "/youtube-transcript" && request.method === "POST") {
        if (!env.TRANSCRIPT_API_KEY) return err("TRANSCRIPT_API_KEY secret is missing.", 500);
        const body = await request.json().catch(() => null);
        if (!body?.youtubeUrl) return err("Missing YouTube URL.", 400);
        const transcript = await getTranscriptFromTranscriptAPI(body.youtubeUrl, env.TRANSCRIPT_API_KEY);
        return ok(transcript);
      }

      if (path === "/refine-youtube-timings" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        const { transcript, sentences } = body || {};
        if (!Array.isArray(transcript) || !Array.isArray(sentences) || !sentences.length) {
          return err("transcript and sentences are required arrays", 400);
        }
        if (!transcript.every(chunk => chunk && typeof chunk.text === "string" && Number.isFinite(chunk.start) && Number.isFinite(chunk.duration)) || 
            !sentences.every(sentence => typeof sentence === "string" && sentence.trim())) {
          return err("Invalid transcript or sentence data", 400);
        }

        const prompt = `You refine timing boundaries for a YouTube listening exercise.
Caption chunks: ${JSON.stringify(transcript)}
Exercise sentences: ${JSON.stringify(sentences)}
Return JSON only in this exact shape: {"sentences":[{"text":"exact original exercise sentence","start":0.42,"end":2.91}]}
Rules: Return exactly one object for every exercise sentence, in the same order. Copy every sentence text character-for-character. Use caption chunks only to improve sentence boundaries. Timings must be chronological and must not overlap.`;

        const ai = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: "Bearer " + env.OPENROUTER_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "openai/gpt-4o-mini", response_format: { type: "json_object" }, temperature: 0, messages: [{ role: "user", content: prompt }] }),
        });
        if (!ai.ok) {
          const error = await ai.json().catch(() => ({}));
          return err("OpenRouter failed: " + (error.error?.message || ai.status), 502);
        }
        let result;
        try { result = JSON.parse((await ai.json()).choices[0].message.content); }
        catch (e) { return err("AI returned invalid JSON", 502); }

        const refined = result && result.sentences;
        const isValid = Array.isArray(refined) && refined.length === sentences.length &&
          refined.every((item, index) => item && item.text === sentences[index] && Number.isFinite(item.start) && Number.isFinite(item.end) && item.start >= 0 && item.end > item.start && (index === 0 || item.start >= refined[index - 1].end));
        if (!isValid) return err("AI returned invalid sentence timings", 502);
        return ok({ sentences: refined });
      }

      if (path === "/align-youtube-sentences" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body) return err("Missing request body.", 400);
        const { transcript, sentences } = body;
        if (!Array.isArray(transcript) || !Array.isArray(sentences)) return err("Invalid request.", 400);

        const prompt = `You are aligning subtitles for an English listening exercise.
Caption chunks: ${JSON.stringify(transcript)}
Sentences: ${JSON.stringify(sentences)}
Return ONLY valid JSON: {"sentences":[{"start":0.00,"end":4.52}]}`;

        const ai = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: "Bearer " + env.OPENROUTER_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "openai/gpt-4o-mini", response_format: { type: "json_object" }, temperature: 0, messages: [{ role: "user", content: prompt }] }),
        });
        if (!ai.ok) return err(await ai.text(), 500);
        const data = await ai.json();
        const result = JSON.parse(data.choices[0].message.content);
        return ok(result);
      }

      if (path === "/delete-teacher-exercise" && request.method === "DELETE") {
        const body = await request.json().catch(() => ({}));
        if (!body) return err("Missing request body", 400);
        let { teacherId, exerciseId } = body;

        const sessionTeacherId = await requireTeacher(request, env);
        if (sessionTeacherId) teacherId = sessionTeacherId;
        if (!teacherId || !exerciseId) return err("Missing teacherId or exerciseId", 400);

        const db = await getDbBinding(env);
        if (db) {
          await ensureDbSchema(db);
          const rowRes = await db.prepare(`SELECT id, teacher_id FROM exercises WHERE id = ?`).bind(exerciseId).first();
          const row = rowRes && rowRes.results ? rowRes.results[0] : rowRes;
          if (!row) return ok({ deleted: true });
          if (row.teacher_id !== teacherId) return err("Not authorised", 403);
          await db.prepare(`DELETE FROM exercises WHERE id = ?`).bind(exerciseId).run();
          return ok({ deleted: true });
        }

        if (!env.LESSONS) return err("KV namespace LESSONS not bound", 500);
        const raw = await env.LESSONS.get("teacher_ex_" + exerciseId);
        if (raw) {
          const exercise = JSON.parse(raw);
          if (exercise.teacherId !== teacherId) return err("Not authorised", 403);
          await env.LESSONS.delete("teacher_ex_" + exerciseId);
        }
        const indexKey = "teacher_index_" + teacherId;
        const rawIndex = await env.LESSONS.get(indexKey);
        if (rawIndex) {
          let index = [];
          try { index = JSON.parse(rawIndex); } catch {}
          index = index.filter(e => e.exerciseId !== exerciseId);
          await env.LESSONS.put(indexKey, JSON.stringify(index), { expirationTtl: 31_536_000 });
        }
        return ok({ deleted: true });
      }

      if (path === "/generate-summary" && request.method === "POST") {
        const { transcript } = await request.json().catch(() => ({}));
        if (!transcript) return err("Missing transcript", 400);
        const prompt = `You are an English language teacher. Given the video transcript below, write a clear summary of 4-6 sentences. Plain text only, no formatting.\n\nTranscript:\n${transcript}`;
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: "Bearer " + env.OPENROUTER_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "openai/gpt-4o-mini", messages: [{ role: "user", content: prompt }], temperature: 0.4 }),
        });
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          return err("OpenRouter summary failed: " + (e.error?.message || res.status));
        }
        const data = await res.json();
        return ok({ summary: (data.choices[0].message.content || "").trim() });
      }

      if (path === "/create-classroom" && request.method === "POST") {
        const teacherId = await requireTeacher(request, env);
        if (!teacherId) return err("Not authenticated", 401);
        const { name } = await request.json().catch(() => ({}));
        if (!name) return err("Missing classroom name", 400);

        const db = await getDbBinding(env);
        if (!db) return err("Database not available", 500);
        await ensureDbSchema(db);

        const id = "c_" + generateId(8);
        let code = generateReadableCode(6);
        while (await db.prepare(`SELECT id FROM classrooms WHERE code = ?`).bind(code).first()) {
          code = generateReadableCode(6);
        }

        await db.prepare(`INSERT INTO classrooms (id, teacher_id, name, code) VALUES (?, ?, ?, ?)`).bind(id, teacherId, name, code).run();
        return ok({ classroomId: id, code });
      }

      if (path === "/list-classrooms" && request.method === "GET") {
        const teacherId = await requireTeacher(request, env);
        if (!teacherId) return err("Not authenticated", 401);
        const db = await getDbBinding(env);
        if (!db) return err("Database not available", 500);
        await ensureDbSchema(db);

        const rows = await db.prepare(`
          SELECT c.id, c.name, c.code, c.created_at,
            (SELECT COUNT(*) FROM students WHERE classroom_id = c.id) as student_count,
            (SELECT COUNT(*) FROM classroom_activities WHERE classroom_id = c.id) as activity_count
          FROM classrooms c
          WHERE c.teacher_id = ?
          ORDER BY c.created_at DESC
        `).bind(teacherId).all();

        return ok({ classrooms: rows.results || [] });
      }

      if (path === "/add-student" && request.method === "POST") {
        const teacherId = await requireTeacher(request, env);
        if (!teacherId) return err("Not authenticated", 401);
        const { classroomId, name } = await request.json().catch(() => ({}));
        if (!classroomId || !name) return err("Missing classroomId or name", 400);

        const db = await getDbBinding(env);
        await ensureDbSchema(db);

        const room = await db.prepare(`SELECT id FROM classrooms WHERE id = ? AND teacher_id = ?`).bind(classroomId, teacherId).first();
        if (!room) return err("Classroom not found or unauthorized", 403);

        const id = "s_" + generateId(8);
        await db.prepare(`INSERT INTO students (id, classroom_id, name) VALUES (?, ?, ?)`).bind(id, classroomId, name).run();
        return ok({ studentId: id, name });
      }

      if (path === "/add-students-bulk" && request.method === "POST") {
        const teacherId = await requireTeacher(request, env);
        if (!teacherId) return err("Not authenticated", 401);
        const { classroomId, names } = await request.json().catch(() => ({}));
        if (!classroomId || !Array.isArray(names) || names.length === 0) return err("Missing classroomId or names array", 400);

        const db = await getDbBinding(env);
        await ensureDbSchema(db);

        const room = await db.prepare(`SELECT id FROM classrooms WHERE id = ? AND teacher_id = ?`).bind(classroomId, teacherId).first();
        if (!room) return err("Classroom not found or unauthorized", 403);

        const stmt = db.prepare(`INSERT INTO students (id, classroom_id, name) VALUES (?, ?, ?)`);
        const queries = names.map(n => {
          const cleanName = n.trim();
          if (!cleanName) return null;
          return stmt.bind("s_" + generateId(8), classroomId, cleanName);
        }).filter(Boolean);

        if (queries.length > 0) await db.batch(queries);
        return ok({ added: queries.length });
      }

      if (path === "/assign-activity" && request.method === "POST") {
        const teacherId = await requireTeacher(request, env);
        if (!teacherId) return err("Not authenticated", 401);
        const { classroomId, activityId } = await request.json().catch(() => ({}));
        if (!classroomId || !activityId) return err("Missing classroomId or activityId", 400);

        const db = await getDbBinding(env);
        await ensureDbSchema(db);

        const room = await db.prepare(`SELECT id FROM classrooms WHERE id = ? AND teacher_id = ?`).bind(classroomId, teacherId).first();
        if (!room) return err("Classroom not found or unauthorized", 403);

        await db.prepare(`INSERT OR IGNORE INTO classroom_activities (classroom_id, activity_id) VALUES (?, ?)`).bind(classroomId, activityId).run();
        return ok({ ok: true });
      }

      if (path === "/unassign-activity" && request.method === "POST") {
        const teacherId = await requireTeacher(request, env);
        if (!teacherId) return err("Not authenticated", 401);
        const { classroomId, activityId } = await request.json().catch(() => ({}));

        const db = await getDbBinding(env);
        await ensureDbSchema(db);
        await db.prepare(`DELETE FROM classroom_activities WHERE classroom_id = ? AND activity_id = ?`).bind(classroomId, activityId).run();
        return ok({ ok: true });
      }

      if (path === "/get-classroom-by-code" && request.method === "POST") {
        const { code } = await request.json().catch(() => ({}));
        if (!code) return err("Missing classroom code", 400);

        const db = await getDbBinding(env);
        await ensureDbSchema(db);

        const room = await db.prepare(`SELECT id, name, code FROM classrooms WHERE code = ?`).bind(code.toUpperCase().trim()).first();
        if (!room) return err("Classroom not found. Please check the code.", 404);

        const students = await db.prepare(`SELECT id, name FROM students WHERE classroom_id = ? ORDER BY name ASC`).bind(room.id).all();
        return ok({ classroomId: room.id, classroomName: room.name, students: students.results || [] });
      }

      if (path === "/student-login" && request.method === "POST") {
        const { classroomId, studentId } = await request.json().catch(() => ({}));
        if (!classroomId || !studentId) return err("Missing classroomId or studentId", 400);

        const db = await getDbBinding(env);
        await ensureDbSchema(db);

        const student = await db.prepare(`SELECT id, name, classroom_id FROM students WHERE id = ? AND classroom_id = ?`).bind(studentId, classroomId).first();
        if (!student) return err("Student not found in this classroom", 404);

        const token = await generateSessionId();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

        await db.prepare(`INSERT INTO student_sessions (token, student_id, classroom_id, expires_at) VALUES (?, ?, ?, ?)`).bind(token, student.id, student.classroom_id, expiresAt).run();
        return ok({ token, studentId: student.id, name: student.name, classroomId: student.classroom_id });
      }

      if (path === "/student-dashboard" && request.method === "GET") {
        const token = url.searchParams.get("token");
        if (!token) return err("Missing token", 400);

        const db = await getDbBinding(env);
        await ensureDbSchema(db);

        const session = await db.prepare(`SELECT student_id, classroom_id, expires_at FROM student_sessions WHERE token = ?`).bind(token).first();
        if (!session || new Date(session.expires_at) < new Date()) {
          return err("Session expired. Please log in again.", 401);
        }

        const activities = await db.prepare(`
          SELECT ca.activity_id, e.title as name
          FROM classroom_activities ca
          LEFT JOIN exercises e ON ca.activity_id = e.id
          WHERE ca.classroom_id = ?
        `).bind(session.classroom_id).all();

        const attempts = await db.prepare(`
          SELECT activity_id, attempt_number, score_percent, correct_answers, total_questions, completed_at
          FROM student_attempts
          WHERE student_id = ?
          ORDER BY completed_at DESC
        `).bind(session.student_id).all();

        const student = await db.prepare(
          `SELECT id, name FROM students WHERE id = ? AND classroom_id = ?`
        ).bind(session.student_id, session.classroom_id).first();

        const classroom = await db.prepare(
          `SELECT id, name FROM classrooms WHERE id = ?`
        ).bind(session.classroom_id).first();

        return ok({
          studentId: session.student_id,
          name: student?.name || "",
          classroomId: session.classroom_id,
          classroomName: classroom?.name || "",
          activities: activities.results || [],
          attempts: attempts.results || []
        });
      }

      if (path === "/submit-attempt" && request.method === "POST") {
        const { token, activityId, correctAnswers, totalQuestions, scorePercent } = await request.json().catch(() => ({}));
        if (!token || !activityId) return err("Missing token or activityId", 400);

        const db = await getDbBinding(env);
        await ensureDbSchema(db);

        const session = await db.prepare(`SELECT student_id FROM student_sessions WHERE token = ? AND expires_at > datetime('now')`).bind(token).first();
        if (!session) return err("Invalid or expired session", 401);

        const lastAttempt = await db.prepare(`
          SELECT MAX(attempt_number) as max_attempt 
          FROM student_attempts 
          WHERE student_id = ? AND activity_id = ?
        `).bind(session.student_id, activityId).first();

        const newAttemptNumber = (lastAttempt?.max_attempt || 0) + 1;
        const attemptId = "a_" + generateId(10);

        await db.prepare(`
          INSERT INTO student_attempts (id, student_id, activity_id, attempt_number, correct_answers, total_questions, score_percent)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(attemptId, session.student_id, activityId, newAttemptNumber, correctAnswers, totalQuestions, scorePercent).run();

        return ok({ ok: true, attemptNumber: newAttemptNumber });
      }

      if (path === "/classroom-progress" && request.method === "GET") {
        const teacherId = await requireTeacher(request, env);
        if (!teacherId) return err("Not authenticated", 401);

        const classroomId = url.searchParams.get("classroomId");
        if (!classroomId) return err("Missing classroomId", 400);

        const db = await getDbBinding(env);
        await ensureDbSchema(db);

        const room = await db.prepare(`SELECT id FROM classrooms WHERE id = ? AND teacher_id = ?`).bind(classroomId, teacherId).first();
        if (!room) return err("Unauthorized", 403);

        const students = await db.prepare(`SELECT id, name FROM students WHERE classroom_id = ? ORDER BY name ASC`).bind(classroomId).all();
        const activities = await db.prepare(`
          SELECT ca.activity_id, e.title as name
          FROM classroom_activities ca
          LEFT JOIN exercises e ON ca.activity_id = e.id
          WHERE ca.classroom_id = ?
        `).bind(classroomId).all();

        const studentIds = (students.results || []).map(s => `'${s.id}'`).join(",");
        let attempts = [];
        if (studentIds.length > 0) {
          const attemptRows = await db.prepare(`
            SELECT student_id, activity_id, attempt_number, score_percent, correct_answers, total_questions, completed_at
            FROM student_attempts
            WHERE student_id IN (${studentIds})
            ORDER BY student_id, activity_id, attempt_number DESC
          `).all();
          attempts = attemptRows.results || [];
        }

        return ok({
          students: students.results || [],
          activities: activities.results || [],
          attempts: attempts
        });
      }

      if (path === "/load-student-activity" && request.method === "GET") {
        const token = url.searchParams.get("token");
        const activityId = url.searchParams.get("activityId");
        if (!token || !activityId) return err("Missing token or activityId", 400);

        const db = await getDbBinding(env);
        await ensureDbSchema(db);

        const session = await db.prepare(`
          SELECT classroom_id FROM student_sessions 
          WHERE token = ? AND expires_at > datetime('now')
        `).bind(token).first();
        if (!session) return err("Invalid or expired session", 401);

        const assignment = await db.prepare(`
          SELECT activity_id FROM classroom_activities 
          WHERE classroom_id = ? AND activity_id = ?
        `).bind(session.classroom_id, activityId).first();
        if (!assignment) return err("Activity not assigned to your classroom", 403);

        const ex = await db.prepare(`SELECT exercise_json FROM exercises WHERE id = ?`).bind(activityId).first();
        if (!ex) return err("Activity not found", 404);

        let parsed = {};
        try { parsed = JSON.parse(ex.exercise_json || '{}'); } catch (e) {}

        return ok({
          exerciseId: activityId,
          videoUrl: parsed.videoUrl || "",
          videoMode: parsed.videoMode || null,
          youtubeVideoId: parsed.youtubeVideoId || null,
          youtubeTitle: parsed.youtubeTitle || null,
          sentences: parsed.sentences || []
        });
      }

      return err("Not found", 404);

    } catch (e) {
      console.error(e);
      return err(e.message || "Internal server error", 500);
    }
  },
};