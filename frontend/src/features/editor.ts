import type { Sentence, Word } from "../types";
import { answerKey, splitIntoSentences, wordsFromText } from "../utils";


export function createTimedSentences(text: string, timedWords: Array<{ text: string; start: number; end: number }>): Sentence[] {
  const rawSentences = splitIntoSentences(text);
  let wordIndex = 0;

  return rawSentences.map(rawText => {
    const tokens = rawText.match(/\S+\s*/g) || [];
    const words: Word[] = [];
    let start: number | undefined;
    let end: number | undefined;

    for (const tokenWithSpace of tokens) {
      const token = tokenWithSpace.trim();
      const cleanToken = answerKey(token);
      let matchIndex = -1;

      for (let i = wordIndex; i < Math.min(wordIndex + 6, timedWords.length); i++) {
        if (answerKey(timedWords[i].text || "") === cleanToken && cleanToken) {
          matchIndex = i;
          break;
        }
      }

      if (matchIndex >= 0) {
        const matched = timedWords[matchIndex];
        start ??= matched.start / 1000;
        end = matched.end / 1000;
        words.push({ text: token, start: matched.start / 1000, end: matched.end / 1000 });
        wordIndex = matchIndex + 1;
      } else {
        words.push({ text: token });
      }
    }

    return {
      text: rawText,
      words,
      start,
      end: end ?? (start !== undefined ? start + 5 : undefined),
    };
  });
}

export function createSentences(text: string): Sentence[] {
  return splitIntoSentences(text).map(s => ({ text: s, words: wordsFromText(s) }));
}

export function applyAiGaps(
  sentences: Sentence[],
  aiSections: { sentence: string; answers: string[] }[],
): Sentence[] {
  if (!Array.isArray(aiSections) || !aiSections.length) {
    return sentences;
  }

  const normalise = (text: string) =>
    text
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[.!?,;:]+$/g, "");

  return sentences.map(sentence => {
    const sentenceText = normalise(sentence.text);

    // First try an exact sentence match.
    let match = aiSections.find(
      x => normalise(x.sentence) === sentenceText,
    );

    // If the AI has replaced the selected word(s) with _____,
    // match the remaining words instead.
    if (!match) {
      match = aiSections.find(x => {
        const aiText = normalise(x.sentence);

        if (!aiText.includes("_____")) return false;

        const aiParts = aiText
          .split("_____")
          .map(part => part.trim())
          .filter(Boolean);

        if (!aiParts.length) return false;

        let position = 0;

        return aiParts.every(part => {
          const found = sentenceText.indexOf(part, position);

          if (found === -1) return false;

          position = found + part.length;
          return true;
        });
      });
    }

    if (!match) return sentence;

    const answers = new Set(
      (match.answers || [])
        .filter(Boolean)
        .map(answerKey),
    );

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
