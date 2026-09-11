import { useState } from "react";
import type { Sentence } from "../types";
import { toggleGap, mergeSentences, splitMergedSentence } from "../features/editor";

export function TranscriptEditor({
  sentences,
  onChange,
}: {
  sentences: Sentence[];
  onChange: (s: Sentence[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(sentences);

  function begin() { setDraft(sentences.map(s => ({ ...s, words: s.words.map(w => ({ ...w })) }))); setEditing(true); }
  function apply() { onChange(draft); setEditing(false); }
  function cancel() { setDraft(sentences); setEditing(false); }

  if (editing) return (
    <section className="card">
      <div className="section-head"><h2>Edit transcript</h2><span>Click a word to make/remove a gap.</span></div>
      {draft.map((s, si) => (
        <div className="sentence-editor" key={si}>
          <textarea
            value={s.text}
            onChange={e => setDraft(d => d.map((x,i) => i === si ? {...x, text:e.target.value} : x))}
          />
          <div className="word-row">
            {s.words.map((w, wi) => (
              <button
                className={w.isGap ? "word gap" : "word"}
                key={wi}
                onClick={() => setDraft(d => d.map((x,i) => i === si ? toggleGap(x, wi) : x))}
              >{w.text}</button>
            ))}
          </div>
        </div>
      ))}
      <div className="actions"><button onClick={cancel}>Cancel</button><button className="primary" onClick={apply}>Apply Changes</button></div>
    </section>
  );

  return (
    <section className="card">
      <div className="section-head"><h2>Transcript</h2><button onClick={begin}>Edit text</button></div>
      {sentences.length === 0 ? <p className="muted">Your transcript will appear here.</p> : sentences.map((s, si) => (
        <div className="sentence" key={si}>
          <div className="words">
            {s.words.map((w, wi) => <button className={w.isGap ? "word gap" : "word"} key={wi} onClick={() => onChange(sentences.map((x,i) => i === si ? toggleGap(x, wi) : x))}>{w.text}</button>)}
          </div>
          {si < sentences.length - 1 && <div className="sentence-tools"><button onClick={() => onChange(mergeSentences(sentences, si))}>Merge with next</button></div>}
          {s.mergedGroupId && <div className="sentence-tools"><button onClick={() => {
            const replacement = splitMergedSentence(s);
            onChange([...sentences.slice(0,si), ...replacement, ...sentences.slice(si+1)]);
          }}>Unmerge</button></div>}
        </div>
      ))}
    </section>
  );
}
