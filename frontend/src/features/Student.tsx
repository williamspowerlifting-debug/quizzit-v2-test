import { useEffect, useState } from "react";
import { api } from "../api";
import type { Activity, Sentence } from "../types";

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
  const [score, setScore] = useState<number | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!lessonId) return;
    api.loadLesson(lessonId).then(setActivity).catch(e => setMessage(e instanceof Error ? e.message : "Could not load activity."));
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
      setIndex(0); setAnswers({}); setScore(null); setMessage("");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not load activity."); }
  }
  function gapEntries(sentence: Sentence) {
    let n = 0;
    return sentence.words.map((word, wordIndex) => {
      if (!word.isGap) return { word, wordIndex, gapIndex: -1 };
      return { word, wordIndex, gapIndex: n++ };
    });
  }
  async function submit() {
    if (!activity) return;
    const sentence = activity.sentences[index];
    const gaps = gapEntries(sentence).filter(x => x.gapIndex >= 0);
    const correctHere = gaps.reduce((n, g) => {
      const value = answers[`${index}:${g.gapIndex}`] || "";
      return n + (cleanAnswer(value) === cleanAnswer(g.word.text) ? 1 : 0);
    }, 0);
    if (index < activity.sentences.length - 1) {
      setIndex(index + 1);
      return;
    }
    const total = activity.sentences.reduce((n, s) => n + s.words.filter(w => w.isGap).length, 0);
    let correct = correctHere;
    activity.sentences.slice(0, -1).forEach((s, si) => {
      gapEntries(s).filter(x => x.gapIndex >= 0).forEach(g => {
        if (cleanAnswer(answers[`${si}:${g.gapIndex}`] || "") === cleanAnswer(g.word.text)) correct++;
      });
    });
    const pct = total ? Math.round((correct / total) * 100) : 100;
    setScore(pct);
    await api.submitAttempt({ token, activityId: activity.exerciseId || "", correctAnswers: correct, totalQuestions: total, scorePercent: pct }).catch(() => {});
  }

  if (activity) {
    const sentence = activity.sentences[index];
    return <section className="card student-card">
      <div className="section-head"><div><h1>{activity.name}</h1><p className="muted">Sentence {index + 1} of {activity.sentences.length}</p></div></div>
      {score !== null ? <div className="score"><strong>{score}%</strong><p>Activity complete.</p><button onClick={() => setActivity(null)}>Back to activities</button></div> : <>
        <div className="video-frame">{activity.youtubeVideoId ? <iframe src={`https://www.youtube.com/embed/${activity.youtubeVideoId}`} allowFullScreen /> : activity.videoUrl ? <video controls src={activity.videoUrl} /> : null}</div>
        <div className="student-sentence">{gapEntries(sentence).map(({ word, gapIndex, wordIndex }) => word.isGap ? <input key={wordIndex} aria-label="Gap answer" value={answers[`${index}:${gapIndex}`] || ""} onChange={e => setAnswers(a => ({ ...a, [`${index}:${gapIndex}`]: e.target.value }))} onKeyDown={e => { if (e.key === "Enter") submit(); }} /> : <span key={wordIndex}>{word.text}</span>)}</div>
        <button className="primary big" onClick={submit}>Submit</button>
      </>}
    </section>;
  }
  if (dashboard) return <section className="card"><h1>Welcome, {dashboard.name}</h1>{(dashboard.activities || []).map((a: any) => <article className="activity-item" key={a.activity_id}><div><h3>{a.name}</h3></div><button onClick={() => start(a.activity_id)}>Start</button></article>)}{message && <p className="status">{message}</p>}</section>;
  if (room) return <section className="card"><h1>{room.classroomName}</h1><p>Select your name.</p><select value={studentId} onChange={e => setStudentId(e.target.value)}><option value="">Choose your name…</option>{room.students.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select><button className="primary big" disabled={!studentId} onClick={login}>Continue</button>{message && <p className="status">{message}</p>}</section>;
  return <section className="login-card"><div className="brand big"><span className="brand-mark">Q</span><span>Quizzit</span></div><h1>Student login</h1><p>Enter the classroom code your teacher gave you.</p><input placeholder="Class code" value={code} onChange={e => setCode(e.target.value)} onKeyDown={e => { if (e.key === "Enter") findClass(); }} /><button className="primary big" onClick={findClass}>Continue</button>{message && <p className="status">{message}</p>}</section>;
}
