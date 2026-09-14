import { useEffect, useMemo, useState } from "react";
import type { Sentence } from "../types";
import { toggleGap, mergeSentences, splitMergedSentence, rebuildSentence } from "../features/editor";

function cloneSentences(sentences: Sentence[]) {
  return sentences.map(s => ({
    ...s,
    words: s.words.map(w => ({ ...w })),
  }));
}

export function TranscriptEditor({
  sentences,
  onChange,
}: {
  sentences: Sentence[];
  onChange: (s: Sentence[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Sentence[]>([]);
  const [past, setPast] = useState<Sentence[][]>([]);
  const [future, setFuture] = useState<Sentence[][]>([]);
  const [editPast, setEditPast] = useState<Sentence[][]>([]);
  const [editFuture, setEditFuture] = useState<Sentence[][]>([]);

  useEffect(() => {
    if (!editing) setDraft(cloneSentences(sentences));
  }, [sentences, editing]);

  const current = editing ? draft : sentences;
  const canUndo = editing ? editPast.length > 0 : past.length > 0;
  const canRedo = editing ? editFuture.length > 0 : future.length > 0;

  function commit(next: Sentence[]) {
    setPast(p => [...p, cloneSentences(sentences)]);
    setFuture([]);
    onChange(next);
  }

  function commitEdit(next: Sentence[]) {
    setEditPast(p => [...p, cloneSentences(draft)]);
    setEditFuture([]);
    setDraft(next);
  }

  function undo() {
    if (editing) {
      if (!editPast.length) return;
      const previous = editPast[editPast.length - 1];
      setEditPast(editPast.slice(0, -1));
      setEditFuture(f => [cloneSentences(draft), ...f]);
      setDraft(cloneSentences(previous));
      return;
    }
    if (!past.length) return;
    const previous = past[past.length - 1];
    setPast(past.slice(0, -1));
    setFuture(f => [cloneSentences(sentences), ...f]);
    onChange(cloneSentences(previous));
  }

  function redo() {
    if (editing) {
      if (!editFuture.length) return;
      const next = editFuture[0];
      setEditFuture(editFuture.slice(1));
      setEditPast(p => [...p, cloneSentences(draft)]);
      setDraft(cloneSentences(next));
      return;
    }
    if (!future.length) return;
    const next = future[0];
    setFuture(future.slice(1));
    setPast(p => [...p, cloneSentences(sentences)]);
    onChange(cloneSentences(next));
  }

  function begin() {
    setDraft(cloneSentences(sentences));
    setEditPast([]);
    setEditFuture([]);
    setEditing(true);
  }

  function apply() {
    const rebuilt = draft.map((sentence, index) => {
      const original = sentences[index] || sentence;
      return rebuildSentence({ ...sentence, words: original.words.map(w => ({ ...w })) }, sentence.text);
    });
    setPast(p => [...p, cloneSentences(sentences)]);
    setFuture([]);
    onChange(rebuilt);
    setEditing(false);
    setEditPast([]);
    setEditFuture([]);
  }

  function cancel() {
    setDraft(cloneSentences(sentences));
    setEditing(false);
    setEditPast([]);
    setEditFuture([]);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    const modifier = e.ctrlKey || e.metaKey;
    if (!modifier) return;
    if (e.key.toLowerCase() === "z" && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey)) {
      e.preventDefault();
      redo();
    }
  }

  const toolbar = useMemo(() => (
    <div className="editor-toolbar">
      <div>
        <h2>{editing ? "Edit transcript" : "Transcript"}</h2>
        <span className="muted">Click a word to make/remove a gap.</span>
      </div>
      <div className="actions">
        <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl/Cmd+Z)">↶ Undo</button>
        <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl/Cmd+Y)">↷ Redo</button>
        {!editing && <button onClick={begin} disabled={!sentences.length}>Edit text</button>}
      </div>
    </div>
  ), [editing, canUndo, canRedo, sentences.length, past.length, future.length, editPast.length, editFuture.length, draft, sentences]);

  if (editing) return (
    <section className="card" onKeyDown={handleKeyDown}>
      {toolbar}
      <div className="editor-help">✏️ Edit the text directly. Use the Undo/Redo buttons or Ctrl+Z / Ctrl+Y.</div>
      {draft.map((s, si) => (
        <div className="sentence-editor" key={si}>
          <textarea
            value={s.text}
            onChange={e => commitEdit(draft.map((x, i) => i === si ? { ...x, text: e.target.value } : x))}
          />
          <div className="word-row">
            {s.words.map((w, wi) => (
              <button
                type="button"
                className={w.isGap ? "word gap" : "word"}
                key={wi}
                onClick={() => commitEdit(draft.map((x, i) => i === si ? toggleGap(x, wi) : x))}
              >{w.text}</button>
            ))}
          </div>
        </div>
      ))}
      <div className="actions editor-footer">
        <button onClick={cancel}>Cancel</button>
        <button className="primary" onClick={apply}>Apply Changes</button>
      </div>
    </section>
  );

  return (
    <section className="card">
      {toolbar}
      {sentences.length === 0 ? <p className="muted">Your transcript will appear here.</p> : sentences.map((s, si) => (
        <div className="sentence" key={si}>
          <div className="words">
            {s.words.map((w, wi) => <button type="button" className={w.isGap ? "word gap" : "word"} key={wi} onClick={() => commit(sentences.map((x, i) => i === si ? toggleGap(x, wi) : x))}>{w.text}</button>)}
          </div>
          {si < sentences.length - 1 && <div className="sentence-tools"><button onClick={() => commit(mergeSentences(sentences, si))}>Merge with next</button></div>}
          {s.mergedGroupId && <div className="sentence-tools"><button onClick={() => {
            const replacement = splitMergedSentence(s);
            commit([...sentences.slice(0, si), ...replacement, ...sentences.slice(si + 1)]);
          }}>Unmerge</button></div>}
        </div>
      ))}
    </section>
  );
}
