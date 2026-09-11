import { useEffect, useState } from "react";
import { api } from "../api";
import { useApp } from "../store";
import { Progress } from "../components/Progress";
import { TranscriptEditor } from "../components/TranscriptEditor";
import { createSentences, applyAiGaps } from "./editor";
import { importDriveVideo, importYoutube, uploadLocalVideo, extractYoutubeId } from "./video";
import type { Sentence } from "../types";

const TAGS = ["B1", "B2", "C1", "Business", "General English", "Listening"];

export function Builder({ onSaved }: { onSaved: () => void }) {
  const { teacher, activity, setActivity, video, setVideo } = useApp();
  const [source, setSource] = useState<"local"|"drive"|"youtube">("local");
  const [url, setUrl] = useState("");
  const [level, setLevel] = useState("B1");
  const [status, setStatus] = useState("Choose a video to begin.");
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [studentLink, setStudentLink] = useState("");

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
        const rawText = data.text || data.transcript?.map((x:any)=>x.text).join(" ") || "";
        let sentences = createSentences(rawText);
        if (Array.isArray(data.transcript) && data.transcript.length && sentences.length) {
          try {
            const refined = await api.refineYoutube(data.transcript, sentences);
            sentences = refined.sentences || sentences;
          } catch { /* keep usable transcript if timing refinement is unavailable */ }
        }
        setActivity(a=>({...a, videoMode:"youtube", videoUrl:url.trim(), youtubeVideoId:ytId, youtubeTitle:data.title || null, sentences, originalTranscript:rawText}));
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
        const sentences=createSentences(data.text || "");
        setActivity(a=>({...a, sentences, originalTranscript:data.text || ""}));
        setProgress(100); setStatus("Transcript ready.");
        return;
      }
      if (data.error) throw new Error(data.error);
      setProgress(Math.min(98, progress + 1));
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
    if (!teacher) return;
    setSaving(true);
    try {
      const lesson= {...activity, name:activity.name || "Untitled Activity"};
      const link=await api.saveLesson(lesson);
      const saved=await api.saveActivity({...lesson, lessonId:link.id});
      setActivity(a=>({...a, exerciseId:saved.exerciseId, lessonId:link.id}));
      const linkUrl = `${location.origin}${location.pathname}?id=${encodeURIComponent(link.id)}`;
      setStudentLink(linkUrl);
      setStatus("Saved.");
      onSaved();
    } catch(e) { setStatus(e instanceof Error ? e.message : "Save failed."); }
    finally { setSaving(false); }
  }

  return <div className="builder">
    <section className="card">
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
      {video && <div className="video-frame">{video.source==="youtube" || activity.videoMode==="youtube" ? <iframe src={`https://www.youtube.com/embed/${activity.youtubeVideoId}`} allowFullScreen /> : <iframe src={video.embedUrl} allow="autoplay;encrypted-media" allowFullScreen />}</div>}
      {!video && activity.videoMode==="youtube" && activity.youtubeVideoId && <div className="video-frame"><iframe src={`https://www.youtube.com/embed/${activity.youtubeVideoId}`} allowFullScreen /></div>}
    </section>

    <TranscriptEditor sentences={activity.sentences} onChange={s=>setActivity(a=>({...a,sentences:s}))}/>

    <section className="card">
      <div className="section-head"><h2>AI gap generation</h2></div>
      <div className="level-row"><label>CEFR level</label><select value={level} onChange={e=>setLevel(e.target.value)}><option>B1</option><option>B2</option><option>C1</option><option>A2</option></select><button disabled={busy || !activity.sentences.length} onClick={generateGaps}>Generate gaps</button></div>
      <div className="tag-row">{TAGS.map(t=><button key={t} className={activity.tags.includes(t)?"tag active":"tag"} onClick={()=>setActivity(a=>({...a,tags:a.tags.includes(t)?a.tags.filter(x=>x!==t):[...a.tags,t]}))}>{t}</button>)}</div>
    </section>

    <div className="sticky-actions"><span>{status}</span><div className="actions">{studentLink && <button onClick={()=>navigator.clipboard.writeText(studentLink)}>Copy Student Link</button>}<button className="primary" disabled={saving || !activity.sentences.length} onClick={save}>{saving?"Saving…":"Save Activity"}</button></div></div>
  </div>;
}
