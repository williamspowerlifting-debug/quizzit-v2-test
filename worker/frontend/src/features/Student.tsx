import { useEffect, useState } from "react";
import { api } from "../api";
import type { Activity, Sentence } from "../types";
import { TimedMedia } from "../components/TimedMedia";

function cleanAnswer(value: string) {
  return value.trim().toLowerCase().replace(/^[^\p{L}\p{N}'-]+|[^\p{L}\p{N}'-]+$/gu, "");
}

export function Student({ lessonId }: { lessonId?: string } = {}) {
  const [code, setCode] = useState("");
  const [room, setRoom] = useState<{ classroomId: string; classroomName: string; students: any[] } | null>(null);
  const [studentId, setStudentId] = useState("");
  const [token, setToken] = useState(localStorage.getItem("quizzit.studentToken") || "");
  const [dashboard, setDashboard] = useState<any>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState<Record<number, boolean>>({});
  const [score, setScore] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [replayKey, setReplayKey] = useState(0);

  // Public lesson loading is intentionally handled by App/lessonId in the existing V2 flow.
  // The effect was previously here; App supplies the loaded lesson to the route in production.
  useEffect(() => {
    if (!lessonId) return;
    api.loadLesson(lessonId)
      .then(setActivity)
      .catch(e => setMessage(e instanceof Error ? e.message : "Could not load activity."));
  }, [lessonId]);

  async function findClass() {
    try { setRoom(await api.classroomByCode(code.trim().toUpperCase())); setMessage(""); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Class not found."); }
  }
  async function login() {
    if (!room) return;
    try {
      const d = await api.studentLogin(room.classroomId, studentId);
      localStorage.setItem("quizzit.studentToken", d.token);
      setToken(d.token);
      setDashboard(await api.studentDashboard(d.token));
    } catch (e) { setMessage(e instanceof Error ? e.message : "Login failed."); }
  }
  async function start(id: string) {
    try {
      const d = await api.loadStudentActivity(token, id);
      setActivity(d.activity || d.lesson);
      setIndex(0); setAnswers({}); setResults({}); setSubmitted({}); setScore(null); setReplayKey(k => k + 1); setMessage("");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not load activity."); }
  }
  function gapEntries(sentence: Sentence) {
    let n = 0;
    return sentence.words.map((word, wordIndex) => word.isGap ? { word, wordIndex, gapIndex: n++ } : { word, wordIndex, gapIndex: -1 });
  }
  function submitCurrent() {
    if (!activity) return;
    const sentence = activity.sentences[index];
    const nextResults = { ...results };
    gapEntries(sentence).forEach(({ word, gapIndex }) => {
      if (gapIndex < 0) return;
      const key = `${index}:${gapIndex}`;
      nextResults[key] = cleanAnswer(answers[key] || "") === cleanAnswer(word.text);
    });
    setResults(nextResults);
    setSubmitted(s => ({ ...s, [index]: true }));
  }
  async function nextSentence() {
    if (!activity) return;
    if (index < activity.sentences.length - 1) {
      setIndex(index + 1);
      setReplayKey(k => k + 1);
      return;
    }
    const merged = { ...results };
    gapEntries(activity.sentences[index]).forEach(({ word, gapIndex }) => {
      if (gapIndex < 0) return;
      const key = `${index}:${gapIndex}`;
      merged[key] = cleanAnswer(answers[key] || "") === cleanAnswer(word.text);
    });
    const total = activity.sentences.reduce((n, s) => n + s.words.filter(w => w.isGap).length, 0);
    const correct = Object.values(merged).filter(Boolean).length;
    const pct = total ? Math.round((correct / total) * 100) : 100;
    setResults(merged); setScore(pct);
    await api.submitAttempt({ token, activityId: activity.exerciseId || "", correctAnswers: correct, totalQuestions: total, scorePercent: pct }).catch(() => {});
  }

  if (activity) {
    const sentence = activity.sentences[index];
    if (!sentence) return null;
    if (score !== null) return <section className="card student-card"><div className="score"><strong>{score}%</strong><p>Activity complete.</p><button onClick={() => { setActivity(null); setScore(null); }}>Back to activities</button></div></section>;

    const hasGaps = sentence.words.some(w => w.isGap);
    return <section className="card student-card">
      <div className="section-head"><div><h1>{activity.name}</h1><p className="muted">Sentence {index + 1} of {activity.sentences.length}</p></div></div>
      <div className="student-progress-dots">{activity.sentences.map((_, i) => <button key={i} type="button" className={`progress-dot ${i < index ? "done" : ""} ${i === index ? "current" : ""}`} onClick={() => { setIndex(i); setReplayKey(k => k + 1); }} aria-label={`Sentence ${i + 1}`} />)}</div>
      <TimedMedia key={`${replayKey}-${index}`} source={activity.videoMode} videoUrl={activity.videoUrl} youtubeVideoId={activity.youtubeVideoId} sentence={sentence} autoPlay />
      <div className="student-sentence">
        {gapEntries(sentence).map(({ word, gapIndex, wordIndex }) => {
          if (!word.isGap) return <span key={wordIndex}>{word.text}</span>;
          const key = `${index}:${gapIndex}`;
          if (submitted[index]) return results[key] ? <span key={wordIndex} className="feedback-correct">✓ {word.text}</span> : <span key={wordIndex} className="feedback-incorrect"><span className="feedback-correct-ans">✓ {word.text}</span><span className="feedback-wrong-ans">✗ {answers[key] || "(blank)"}</span></span>;
          return <input key={wordIndex} className="gap-input" aria-label="Gap answer" value={answers[key] || ""} onChange={e => setAnswers(a => ({ ...a, [key]: e.target.value }))} onKeyDown={e => { if (e.key === "Enter") submitCurrent(); }} />;
        })}
      </div>
      <div className="student-controls">
        <button className="secondary" disabled={index === 0} onClick={() => { setIndex(index - 1); setReplayKey(k => k + 1); }}>⬅ Previous</button>
        <button className="secondary" onClick={() => setReplayKey(k => k + 1)}>🔁 Replay</button>
        {hasGaps && !submitted[index] && <button className="success" onClick={submitCurrent}>✅ Submit</button>}
        {(!hasGaps || submitted[index]) && <button className="primary" onClick={nextSentence}>{index === activity.sentences.length - 1 ? "Finish" : "Next ➡"}</button>}
      </div>
      {message && <p className="status">{message}</p>}
    </section>;
  }
  if (dashboard) return <section className="card"><h1>Welcome, {dashboard.name}</h1>{(dashboard.activities || []).map((a: any) => <article className="activity-item" key={a.activity_id}><div><h3>{a.name}</h3></div><button onClick={() => start(a.activity_id)}>Start</button></article>)}{message && <p className="status">{message}</p>}</section>;
  if (room) return <section className="card"><h1>{room.classroomName}</h1><p>Select your name.</p><select value={studentId} onChange={e => setStudentId(e.target.value)}><option value="">Choose your name…</option>{room.students.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select><button className="primary big" disabled={!studentId} onClick={login}>Continue</button>{message && <p className="status">{message}</p>}</section>;
  return <section className="login-card"><div className="brand big"><span className="brand-mark">Q</span><span>Quizzit</span></div><h1>Student login</h1><p>Enter the classroom code your teacher gave you.</p><input placeholder="Class code" value={code} onChange={e => setCode(e.target.value)} onKeyDown={e => { if (e.key === "Enter") findClass(); }} /><button className="primary big" onClick={findClass}>Continue</button>{message && <p className="status">{message}</p>}</section>;
}
