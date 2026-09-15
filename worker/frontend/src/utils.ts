import type { Sentence, Word } from "./types";

export function splitIntoSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .match(/[^.!?]+[.!?]+|[^.!?]+$/g)
    ?.map(s => s.trim())
    .filter(Boolean) || [];
}

export function wordsFromText(text: string): Word[] {
  const parts = text.match(/\S+\s*/g) || [];
  return parts.map((text) => ({ text }));
}

export function transcriptText(sentences: Sentence[]) {
  return sentences.map(s => s.text).join(" ");
}

export function answerKey(word: string) {
  return word
    .replace(/^[^\p{L}\p{N}'-]+|[^\p{L}\p{N}'-]+$/gu, "")
    .toLowerCase();
}

export function normaliseActivity(raw: any): ActivityLike {
  const source = Array.isArray(raw?.sentences) ? raw.sentences : [];
  const sentences = source.map((s: any) => {
    const compactWords = Array.isArray(s?.words) ? s.words : [];
    const words = compactWords.length && compactWords.some((w: any) => w?.t !== undefined)
      ? compactWords.map((w: any) => ({ text: w.t || w.text || "", start: w.start, end: w.end, isGap: !!(w.g || w.isGap) }))
      : compactWords.length
        ? compactWords.map((w: any) => ({ text: w.text || "", start: w.start, end: w.end, isGap: !!w.isGap }))
        : wordsFromText(s.text || "");
    return {
      text: s.text || words.map((w: Word) => w.text).join(" "),
      words,
      sectionEnd: !!(s.sectionEnd || s.x),
      mergedGroupId: s.mergedGroupId || null,
      start: Number.isFinite(s.start) ? s.start : Number.isFinite(s.s) ? s.s : undefined,
      end: Number.isFinite(s.end) ? s.end : Number.isFinite(s.e) ? s.e : undefined,
    };
  });
  return {
    ...raw,
    name: raw?.name || raw?.title || "Untitled Activity",
    sentences,
    tags: Array.isArray(raw?.tags) ? raw.tags : [],
  };
}

export type ActivityLike = {
  name: string;
  sentences: Sentence[];
  tags: string[];
  [key: string]: any;
};
