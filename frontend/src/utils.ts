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
  const sentences = Array.isArray(raw?.sentences) ? raw.sentences : [];
  return {
    ...raw,
    name: raw?.name || raw?.title || "Untitled Activity",
    sentences: sentences.map((s: any) => ({
      text: s.text || "",
      words: Array.isArray(s.words)
        ? s.words.map((w: any) => ({ text: w.text || "", start: w.start, end: w.end, isGap: !!w.isGap }))
        : wordsFromText(s.text || ""),
      sectionEnd: !!s.sectionEnd,
      mergedGroupId: s.mergedGroupId || null,
    })),
    tags: Array.isArray(raw?.tags) ? raw.tags : [],
  };
}

export type ActivityLike = {
  name: string;
  sentences: Sentence[];
  tags: string[];
  [key: string]: any;
};
