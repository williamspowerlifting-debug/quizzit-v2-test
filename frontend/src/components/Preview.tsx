import { useEffect, useMemo, useState } from "react";
import type { Activity, Sentence } from "../types";

function clean(value: string) {
  return value.trim().toLowerCase().replace(/^[^\p{L}\p{N}'-]+|[^\p{L}\p{N}'-]+$/gu, "");
}

export function Preview({ activity, onClose }: { activity: Activity; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [score, setScore] = useState<number | null>(null);

  const sentence: Sentence | undefined = activity.sentences[index];
  const total = useMemo(() => activity.sentences.reduce((n, s) => n + s.words.filter(w => w.isGap).length, 0), [activity.sentences]);

  useEffect(() => setIndex(0), [activity.name]);

  function entries(s: Sentence) {
    let gap = 0;
    return s.words.map((word, wordIndex) => word.isGap ? { word, wordIndex, gapIndex: gap++ } : { word, wordIndex, gapIndex: -1 });
  }

  function submit() {
    if (!sentence) return;
    if (index < activity.sentences.length - 1) {
      setIndex(index + 1);
      return;
    }
    let correct = 0;
    activity.sentences.forEach((s, si) => entries(s).forEach(x => {
      if (x.gapIndex >= 0 && clean(answers[`${si}:${x.gapIndex}`] || "") === clean(x.word.text)) correct++;
    }));
    setScore(total ? Math.round(correct / total * 100) : 100);
  }

  return <div className="preview-overlay">
    <section className="preview-modal card">
      <div className="section-head"><div><span className="preview-label">Student preview</span><h1>{activity.name}</h1><p className="muted">This is what students will see.</p></div><button onClick={onClose}>✕ Close</button></div>
      {score !== null ? <div className="score"><strong>{score}%</strong><p>Preview complete.</p><button className="primary" onClick={() => { setScore(null); setIndex(0); setAnswers({}); }}>Try again</button></div> : sentence ? <>
        <div className="video-frame">{activity.youtubeVideoId ? <iframe src={`https://www.youtube.com/embed/${activity.youtubeVideoId}`} allowFullScreen /> : activity.videoUrl ? <video controls src={activity.videoUrl} /> : null}</div>
        <p className="muted">Sentence {index + 1} of {activity.sentences.length}</p>
        <div className="student-sentence">{entries(sentence).map(({ word, gapIndex, wordIndex }) => word.isGap ? <input key={wordIndex} value={answers[`${index}:${gapIndex}`] || ""} onChange={e => setAnswers(a => ({ ...a, [`${index}:${gapIndex}`]: e.target.value }))} onKeyDown={e => { if (e.key === "Enter") submit(); }} placeholder="…" /> : <span key={wordIndex}>{word.text}</span>)}</div>
        <div className="preview-footer"><span className="muted">Preview mode — nothing is submitted.</span><button className="primary big" onClick={submit}>{index === activity.sentences.length - 1 ? "Finish" : "Submit"}</button></div>
      </> : <p className="muted">Add a transcript first.</p>}
    </section>
  </div>;
}
