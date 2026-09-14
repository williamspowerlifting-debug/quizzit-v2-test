import type { Sentence, Word } from "../types";
import { answerKey, splitIntoSentences, wordsFromText } from "../utils";

export function createSentences(text: string): Sentence[] {
  return splitIntoSentences(text).map(s => ({ text: s, words: wordsFromText(s) }));
}

export function applyAiGaps(
  sentences: Sentence[],
  aiSections: { sentence: string; answers: string[] }[],
): Sentence[] {
  return sentences.map(sentence => {
    const match = aiSections.find(
      x => x.sentence.trim().toLowerCase() === sentence.text.trim().toLowerCase(),
    );
    if (!match) return sentence;
    const answers = new Set(match.answers.map(answerKey));
    return {
      ...sentence,
      words: sentence.words.map(w => ({
        ...w,
        isGap: answers.has(answerKey(w.text)),
      })),
    };
  });
}

export function toggleGap(sentence: Sentence, wordIndex: number): Sentence {
  return {
    ...sentence,
    words: sentence.words.map((w, i) => i === wordIndex ? { ...w, isGap: !w.isGap } : w),
  };
}

export function rebuildSentence(sentence: Sentence, text: string): Sentence {
  const oldGaps = sentence.words.filter(w => w.isGap).map(w => answerKey(w.text));
  return {
    ...sentence,
    text,
    words: wordsFromText(text).map(w => ({ ...w, isGap: oldGaps.includes(answerKey(w.text)) })),
  };
}

export function mergeSentences(sentences: Sentence[], index: number): Sentence[] {
  if (index < 0 || index >= sentences.length - 1) return sentences;
  const a = sentences[index], b = sentences[index + 1];
  return [
    ...sentences.slice(0, index),
    {
      text: `${a.text.trim()} ${b.text.trim()}`,
      words: [...a.words, ...b.words],
      mergedGroupId: a.mergedGroupId || `merge_${Date.now()}`,
      sectionEnd: b.sectionEnd,
      start: a.start,
      end: b.end,
    },
    ...sentences.slice(index + 2),
  ];
}

export function splitMergedSentence(sentence: Sentence): Sentence[] {
  if (!sentence.mergedGroupId) return [sentence];
  const parts = splitIntoSentences(sentence.text);
  const start = Number.isFinite(sentence.start) ? sentence.start! : undefined;
  const end = Number.isFinite(sentence.end) ? sentence.end! : undefined;
  const totalChars = Math.max(1, parts.reduce((n, part) => n + part.length, 0));
  let cursor = 0;
  return parts.map((text, index) => {
    const ratioStart = cursor / totalChars;
    cursor += text.length;
    const ratioEnd = cursor / totalChars;
    return {
      text,
      words: wordsFromText(text),
      mergedGroupId: null,
      start: start !== undefined && end !== undefined ? start + (end - start) * ratioStart : undefined,
      end: start !== undefined && end !== undefined ? start + (end - start) * ratioEnd : undefined,
      sectionEnd: index === parts.length - 1 ? sentence.sectionEnd : false,
    };
  });
}
