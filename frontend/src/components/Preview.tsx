import { useEffect, useMemo, useState } from "react";
import type { Activity, Sentence } from "../types";
import { TimedMedia } from "./TimedMedia";

function clean(value: string) {
  return value.trim().toLowerCase().replace(/^[^\p{L}\p{N}'-]+|[^\p{L}\p{N}'-]+$/gu, "");
}

export function Preview({ activity, onClose }: { activity: Activity; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState<Record<number, boolean>>({});
  const [score, setScore] = useState<number | null>(null);

  const sentence: Sentence | undefined = activity.sentences[index];
  const total = useMemo(
    () => activity.sentences.reduce((n, s) => n + s.words.filter(w => w.isGap).length, 0),
    [activity.sentences],
  );

  useEffect(() => {
    setIndex(0);
    setAnswers({});
    setResults({});
    setSubmitted({});
    setScore(null);
  }, [activity.name]);

  function entries(s: Sentence) {
    let gap = 0;
    return s.words.map((word, wordIndex) => word.isGap
      ? { word, wordIndex, gapIndex: gap++ }
      : { word, wordIndex, gapIndex: -1 });
  }

  function submitCurrent() {
    if (!sentence) return;
    const nextResults = { ...results };
    entries(sentence).forEach(({ word, gapIndex }) => {
      if (gapIndex < 0) return;
      const key = `${index}:${gapIndex}`;
      nextResults[key] = clean(answers[key] || "") === clean(word.text);
    });
    setResults(nextResults);
    setSubmitted(s => ({ ...s, [index]: true }));
  }

  function nextSentence() {
  if (!sentence) return;

  if (index < activity.sentences.length - 1) {
    setIndex(index + 1);
    return;
  }

  // Include the current sentence's results, which may have just been submitted.
  const currentResults = { ...results };

  entries(sentence).forEach(({ word, gapIndex }) => {
    if (gapIndex < 0) return;

    const key = `${index}:${gapIndex}`;
    currentResults[key] =
      clean(answers[key] || "") === clean(word.text);
  });

  const correct = Object.values(currentResults).filter(Boolean).length;

  setResults(currentResults);
  setScore(total ? Math.round((correct / total) * 100) : 100);
}
  function previousSentence() {
    if (index > 0) setIndex(index - 1);
  }

  function replay() {
    // TimedMedia replays when its sentence timing changes. Force a remount for replay.
    setReplayKey(k => k + 1);
  }

  const [replayKey, setReplayKey] = useState(0);

  function renderWord({ word, wordIndex, gapIndex }: ReturnType<typeof entries>[number]) {
    if (!word.isGap) return <span key={wordIndex}>{word.text}</span>;
    const key = `${index}:${gapIndex}`;
    const checked = submitted[index];
    if (checked) {
      return results[key]
        ? <span key={wordIndex} className="feedback-correct">✓ {word.text}</span>
        : <span key={wordIndex} className="feedback-incorrect"><span className="feedback-correct-ans">✓ {word.text}</span><span className="feedback-wrong-ans">✗ {answers[key] || "(blank)"}</span></span>;
    }
    return <input
      key={wordIndex}
      value={answers[key] || ""}
      onChange={e => setAnswers(a => ({ ...a, [key]: e.target.value }))}
      onKeyDown={e => {
        if (e.key === "Enter") submitCurrent();
        if (e.key === "Tab") {
          const inputs = Array.from(document.querySelectorAll<HTMLInputElement>(".preview-modal .gap-input"));
          const pos = inputs.indexOf(e.currentTarget);
          if (pos >= 0 && pos < inputs.length - 1) {
            e.preventDefault();
            inputs[pos + 1].focus();
          }
        }
      }}
      className="gap-input"
      placeholder="…"
      autoComplete="off"
      spellCheck={false}
    />;
  }

  if (score !== null) {
    return <div className="preview-overlay">
      <section className="preview-modal card">
        <div className="section-head"><div><span className="preview-label">Student preview</span><h1>{activity.name}</h1></div><button onClick={onClose}>✕ Close</button></div>
        <div className="score"><strong>{score}%</strong><p>Preview complete — nothing was submitted to students.</p><div className="preview-footer"><button className="secondary" onClick={() => { setScore(null); setIndex(0); setAnswers({}); setResults({}); setSubmitted({}); }}>Try again</button><button className="primary" onClick={onClose}>Back to editor</button></div></div>
      </section>
    </div>;
  }

  return <div className="preview-overlay">
    <section className="preview-modal card">
      <div className="section-head">
        <div><span className="preview-label">Student preview</span><h1>{activity.name}</h1><p className="muted">Preview uses the same sentence-by-sentence listening behaviour as the student activity.</p></div>
        <button onClick={onClose}>✕ Close</button>
      </div>

      {sentence ? <>
        <TimedMedia
          key={`${replayKey}-${index}`}
          source={activity.videoMode}
          videoUrl={activity.videoUrl}
          youtubeVideoId={activity.youtubeVideoId}
          sentence={sentence}
          autoPlay
        />

        <div className="progress-dots" aria-label="Preview progress">
          {activity.sentences.map((_, i) => <button key={i} type="button" className={`progress-dot ${i < index ? "done" : ""} ${i === index ? "current" : ""}`} onClick={() => setIndex(i)} aria-label={`Sentence ${i + 1}`} />)}
        </div>

        <p className="muted">Sentence {index + 1} of {activity.sentences.length}</p>
        <div className="student-sentence">{entries(sentence).map(renderWord)}</div>

        <div className="preview-footer">
          <span className="muted">Preview mode — nothing is submitted.</span>
          <div className="button-row">
            <button className="secondary" disabled={index === 0} onClick={previousSentence}>⬅ Previous</button>
            <button className="secondary" onClick={replay}>🔁 Replay</button>
            {!submitted[index] && sentence.words.some(w => w.isGap) && <button className="success" onClick={submitCurrent}>✅ Submit</button>}
            {submitted[index] && <button className="primary" onClick={nextSentence}>{index === activity.sentences.length - 1 ? "Finish" : "Next ➡"}</button>}
            {!sentence.words.some(w => w.isGap) && <button className="primary" onClick={nextSentence}>{index === activity.sentences.length - 1 ? "Finish" : "Next ➡"}</button>}
          </div>
        </div>
      </> : <p className="muted">Add a transcript first.</p>}
    </section>
  </div>;
}
