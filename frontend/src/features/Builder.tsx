import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useApp } from "../store";
import { Progress } from "../components/Progress";
import { TranscriptEditor } from "../components/TranscriptEditor";
import { Preview } from "../components/Preview";
import { applyAiGaps, createSentences, createTimedSentences } from "./editor";
import { importDriveVideo, importYoutube, uploadLocalVideo, extractYoutubeId } from "./video";
import { splitIntoSentences } from "../utils";

const TAGS = ["A2", "B1", "B2", "C1", "Business", "General English", "Listening"];

type LayoutMode = "stacked" | "side";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function buildYoutubeSentences(segments: any[]) {
  const validSegments = segments.filter(
    s => s && typeof s.text === "string" && s.text.trim() && Number.isFinite(s.start) && Number.isFinite(s.duration) && s.duration > 0,
  );
  const fullText = validSegments.map(s => s.text.trim()).join(" ");
  const sentenceTexts = splitIntoSentences(fullText);

  // Build approximate word timings from the caption chunks, matching the
  // original HTML implementation. This gives every sentence real boundaries
  // even before the optional AI refinement runs.
  const timedWords: Array<{ text: string; start: number; end: number }> = [];
  for (const segment of validSegments) {
    const start = Number(segment.start);
    const end = start + Number(segment.duration);
    const tokens = segment.text.trim().match(/\S+/g) || [];
    const duration = Math.max(0, end - start);
    tokens.forEach((text: string, i: number) => {
      timedWords.push({
        text,
        start: start + duration * i / Math.max(tokens.length, 1),
        end: start + duration * (i + 1) / Math.max(tokens.length, 1),
      });
    });
  }

  if (!sentenceTexts.length) return [];
  let wordIndex = 0;
  return sentenceTexts.map(text => {
    const tokens = text.match(/\S+/g) || [];
    const words = [];
    let start: number | undefined;
    let end: number | undefined;

    for (const token of tokens) {
      const clean = token.toLowerCase().replace(/[^\p{L}\p{N}'-]/gu, "");
      let match = -1;
      for (let j = wordIndex; j < Math.min(wordIndex + 8, timedWords.length); j++) {
        const candidate = timedWords[j].text.toLowerCase().replace(/[^\p{L}\p{N}'-]/gu, "");
        if (candidate === clean && clean) { match = j; break; }
      }
      if (match >= 0) {
        const w = timedWords[match];
        start ??= w.start;
        end = w.end;
        words.push({ text: token, start: w.start, end: w.end });
        wordIndex = match + 1;
      } else {
        words.push({ text: token });
      }
    }

    return { text, start, end: end ?? (start !== undefined ? start + 5 : undefined), words };
  });
}

export function Builder() {
  const { teacher, activity, setActivity, video, setVideo } = useApp();
  const [source, setSource] = useState<"local"|"drive"|"youtube">("local");
  const [url, setUrl] = useState("");
  const [level, setLevel] = useState("B1");
  const [status, setStatus] = useState("Choose a video to begin.");
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generatingLink, setGeneratingLink] = useState(false);
  const [studentLink, setStudentLink] = useState("");
  useEffect(() => {
  if (activity.lessonId) {
    setStudentLink(
      `${location.origin}${location.pathname}?id=${encodeURIComponent(activity.lessonId)}`
    );
  } else {
    setStudentLink("");
  }
}, [activity.lessonId]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [layout, setLayout] = useState<LayoutMode>(() => (localStorage.getItem("quizzit.builderLayout") as LayoutMode) || "stacked");

  const activityLoaded = !!video || !!activity.videoUrl;
  const hasGaps = useMemo(() => activity.sentences.some(s => s.words.some(w => w.isGap)), [activity.sentences]);

  useEffect(() => {
    if (!activity.sentences.length) return;
    localStorage.setItem("quizzit.draft", JSON.stringify(activity));
    if (!teacher || !activity.exerciseId) return;
    const id = setTimeout(async () => {
      try { await api.saveActivity(activity); setStatus("Autosaved"); }
      catch { setStatus("Draft saved locally"); }
    }, 1200);
    return () => clearTimeout(id);
  }, [activity, teacher]);

  function setLayoutMode(next: LayoutMode) {
    setLayout(next);
    localStorage.setItem("quizzit.builderLayout", next);
  }

  async function processVideo() {
    if (!teacher) return;
    setBusy(true); setProgress(2);
    try {
      if (source === "local") {
        const input = document.querySelector<HTMLInputElement>("#video-file");
        const file = input?.files?.[0];
        if (!file) throw new Error("Please choose a video file.");
        const asset = await uploadLocalVideo(file, activity.name, (p,m)=>{setProgress(p);setStatus(m);});
        setVideo(asset);
        setActivity(a => ({...a, videoMode:"local", videoUrl:asset.directUrl || "", lessonId:null}));
        setStatus("Video ready. Starting transcription…");
        const job = await api.transcribe(asset.directUrl!);
        await poll(job.jobId);
      } else if (source === "drive") {
        if (!url.trim()) throw new Error("Paste a Google Drive link.");
        const asset = await importDriveVideo(url.trim(), activity.name, (p,m)=>{setProgress(p);setStatus(m);});
        setVideo(asset);
        setActivity(a => ({...a, videoMode:"drive", videoUrl:asset.directUrl || "", lessonId:null}));
        const job = await api.transcribe(asset.directUrl!);
        await poll(job.jobId);
      } else {
        if (!url.trim()) throw new Error("Paste a YouTube link.");
        setStatus("Getting YouTube transcript…"); setProgress(30);
        const data = await importYoutube(url.trim(), (p,m)=>{setProgress(p);setStatus(m);});
        const ytId = extractYoutubeId(url.trim());
        const segments = Array.isArray(data.transcript) ? data.transcript : [];
        let sentences = buildYoutubeSentences(segments);
        const youtubeSentenceTexts = sentences.map(s => s.text);
        if (!youtubeSentenceTexts.length) throw new Error("YouTube did not return a usable timed transcript.");
        try {
          // The Worker expects an array of sentence strings, not Sentence objects.
          const refined = await api.refineYoutube(segments, youtubeSentenceTexts);
          if (Array.isArray(refined.sentences) && refined.sentences.length === sentences.length) {
            sentences = sentences.map((s, i) => {
              const refinedSentence = refined.sentences[i];
              return {
                ...s,
                // Keep the original timed segment as a safe fallback if the
                // refinement response does not contain a numeric boundary.
                start: typeof refinedSentence.start === "number" && Number.isFinite(refinedSentence.start)
                  ? refinedSentence.start
                  : s.start,
                end: typeof refinedSentence.end === "number" && Number.isFinite(refinedSentence.end)
                  ? refinedSentence.end
                  : s.end,
              };
            });
          }
        } catch {
          // Segment boundaries remain the safe fallback.
        }

        setActivity(a=>({...a, videoMode:"youtube", videoUrl:url.trim(), youtubeVideoId:ytId, youtubeTitle:data.title || data.metadata?.title || null, sentences, originalTranscript:youtubeSentenceTexts.join(" ")}));
        setVideo({source:"youtube", youtubeVideoId:ytId, youtubeTitle:data.title || data.metadata?.title || undefined});
        setProgress(100); setStatus("Activity ready.");
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Something went wrong.");
    } finally { setBusy(false); }
  }

  async function poll(jobId: string) {
    for (let i=0;i<300;i++) {
      const data=await api.transcribeStatus(jobId);
      if (data.done) {
        const timedWords = Array.isArray(data.words)
          ? data.words.filter((w:any) => w && typeof w.text === "string" && Number.isFinite(w.start) && Number.isFinite(w.end))
          : [];
        const sentences = timedWords.length
          ? createTimedSentences(data.text || "", timedWords)
          : createSentences(data.text || "");
        setActivity(a=>({...a, sentences, originalTranscript:data.text || ""}));
        setProgress(100); setStatus("Transcript ready.");
        return;
      }
      if (data.error) throw new Error(data.error);
      setProgress(p => Math.min(98, p + 1));
      setStatus("Transcribing…");
      await new Promise(r=>setTimeout(r,2000));
    }
    throw new Error("Transcription timed out.");
  }

  async function generateGaps() {
    if (!activity.sentences.length) return;
    setBusy(true); setStatus("AI is selecting gaps…");
    try {
      const result=await api.generateGaps(activity.sentences.map(s=>s.text).join(" "), level);
      setActivity(a=>({...a, sentences:applyAiGaps(a.sentences,result.sections)}));
      setStatus("Gaps generated.");
    } catch(e) { setStatus(e instanceof Error ? e.message : "AI gap generation failed."); }
    finally { setBusy(false); }
  }

  async function save() {
    if (!teacher || !activity.sentences.length) return;
    setSaving(true);
    try {
      const lesson = { ...clone(activity), name: activity.name || "Untitled Activity" };
      const saved = await api.saveActivity(lesson);
      setActivity(a=>({...a, exerciseId:saved.exerciseId, updatedAt:new Date().toISOString()}));
      setStatus("✓ Activity saved");
    } catch(e) { setStatus(e instanceof Error ? e.message : "Save failed."); }
    finally { setSaving(false); }
  }

  async function generateLink() {
    if (!activity.videoUrl || !hasGaps) {
      setStatus(!activity.videoUrl ? "Add a video first." : "Add at least one gap first.");
      return;
    }
    setGeneratingLink(true);
    try {
      const slim = {
        videoUrl: activity.videoUrl,
        videoMode: activity.videoMode,
        youtubeVideoId: activity.youtubeVideoId || "",
        youtubeTitle: activity.youtubeTitle || "",
        name: activity.name,
        sentences: activity.sentences.map(s => ({
          words: s.words.map(w => w.isGap ? { t:w.text, g:1 } : { t:w.text }),
          ...(Number.isFinite(s.start) ? { s: Math.round((s.start || 0) * 100) / 100 } : {}),
          ...(Number.isFinite(s.end) ? { e: Math.round((s.end || 0) * 100) / 100 } : {}),
          ...(s.sectionEnd ? { x:1 } : {}),
          ...(s.mergedGroupId ? { m:1 } : {}),
        })),
      };
      const result = await api.saveLesson(slim as any);
      const link = `${location.origin}${location.pathname}?id=${encodeURIComponent(result.id)}`;
      setStudentLink(link);
      setActivity(a=>({...a, lessonId:result.id}));
      await api.saveActivity({...activity, lessonId:result.id});
      setStatus("✓ Student link generated");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Could not generate student link.");
    } finally { setGeneratingLink(false); }
  }

  async function copyLink() {
    if (!studentLink) return;
    try { await navigator.clipboard.writeText(studentLink); setStatus("✓ Student link copied"); }
    catch { setStatus("Student link is ready to copy from the field above."); }
  }

  function renderVideo() {
    if (!activityLoaded) return null;
    if (activity.youtubeVideoId) return <iframe src={`https://www.youtube.com/embed/${activity.youtubeVideoId}`} allowFullScreen title="YouTube video" />;
    if (activity.videoUrl) return <video controls src={activity.videoUrl} />;
    return null;
  }

  return <div className="builder">
    {!activityLoaded ? <section className="card upload-card">
      <div className="section-head"><div><h1>{activity.name}</h1><p className="muted">Create a listening gap-fill activity.</p></div></div>
      <label>Activity name<input value={activity.name} onChange={e=>setActivity(a=>({...a,name:e.target.value}))}/></label>
      <div className="source-tabs">
        <button className={source==="local"?"active":""} onClick={()=>setSource("local")}>Upload video</button>
        <button className={source==="drive"?"active":""} onClick={()=>setSource("drive")}>Google Drive</button>
        <button className={source==="youtube"?"active":""} onClick={()=>setSource("youtube")}>YouTube</button>
      </div>
      {source==="local" ? <input id="video-file" type="file" accept="video/*" /> : <input placeholder={source==="drive"?"Paste Google Drive link":"Paste YouTube link"} value={url} onChange={e=>setUrl(e.target.value)} />}
      <button className="primary big" disabled={busy} onClick={processVideo}>{busy ? "Processing…" : "Process video"}</button>
      {progress>0 && <Progress value={progress} message={status}/>} 
    </section> : <>
      <section className="activity-loaded-head card">
        <div><div className="eyebrow">Activity loaded</div><h1>{activity.name}</h1><p className="muted">Your video and transcript are ready to edit.</p></div>
        <div className="actions"><button onClick={() => setLayoutMode(layout === "side" ? "stacked" : "side")}>{layout === "side" ? "▣ Stacked view" : "▣ Video + transcript"}</button></div>
      </section>

      <div className={layout === "side" ? "builder-workspace side" : "builder-workspace"}>
        <section className="card video-panel">
          <div className="section-head"><div><h2>Video</h2><p className="muted">Watch while checking the transcript.</p></div></div>
          <div className="video-frame">{renderVideo()}</div>
        </section>

        <div className="editor-column">
          <section className="card">
            <div className="section-head"><div><h2>AI gap generation</h2><p className="muted">Let Quizzit choose useful listening gaps.</p></div></div>
            <div className="level-row"><label>CEFR level</label><select value={level} onChange={e=>setLevel(e.target.value)}><option>A2</option><option>B1</option><option>B2</option><option>C1</option></select><button className="primary" disabled={busy || !activity.sentences.length} onClick={generateGaps}>{busy ? "Generating…" : "✨ Generate gaps"}</button></div>
            <div className="tag-row">{TAGS.map(t=><button key={t} className={activity.tags.includes(t)?"tag active":"tag"} onClick={()=>setActivity(a=>({...a,tags:a.tags.includes(t)?a.tags.filter(x=>x!==t):[...a.tags,t]}))}>{t}</button>)}</div>
          </section>

          <TranscriptEditor sentences={activity.sentences} onChange={s=>setActivity(a=>({...a,sentences:s}))}/>
        </div>
      </div>

      <section className="card share-card">
        <div className="section-head"><div><h2>Preview & share</h2><p className="muted">Preview exactly what students will see, then choose how you want to use the activity.</p></div></div>
        <div className="share-actions">
          <button className="primary" disabled={!hasGaps} onClick={()=>setPreviewOpen(true)}>👀 Preview</button>
          <button className="success" disabled={generatingLink || !hasGaps} onClick={generateLink}>{generatingLink ? "Generating…" : "🔗 Generate Student Link"}</button>
          {studentLink && <button onClick={copyLink}>📋 Copy link</button>}
        </div>
        {studentLink && <div className="link-box"><strong>Student link ready</strong><input readOnly value={studentLink}/></div>}
      </section>
    </>}

    {activityLoaded && <div className="sticky-actions"><span>{status}</span><div className="actions"><button className="primary" disabled={saving || !activity.sentences.length} onClick={save}>{saving ? "Saving…" : "Save Activity"}</button></div></div>}
    {previewOpen && <Preview activity={activity} onClose={()=>setPreviewOpen(false)}/>} 
  </div>;
}
