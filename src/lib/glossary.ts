import glossaryData from '../data/glossary.json';

export interface GlossaryEntry {
  /** 表层读音（平假名） */
  r?: string;
  /** 辞书形原形（仅活用/变形时提供） */
  l?: string;
  /** 原形读音 */
  lr?: string;
  /** 词性 */
  p: string;
  /** 中文释义 */
  z: string;
}

export type GlossarySpan = [start: number, end: number, key: string];

interface GlossaryPayload {
  entries: Record<string, GlossaryEntry>;
  spans: Record<string, GlossarySpan[]>;
}

const payload = glossaryData as unknown as GlossaryPayload;
const entries = payload.entries;
const spans = payload.spans;

let maxLen = 1;
for (const key of Object.keys(entries)) {
  const clean = key.replace(/#\d+$/, '');
  const sep = clean.indexOf('|');
  const len = sep === -1 ? clean.length : sep;
  if (len > maxLen) maxLen = len;
}

export const MAX_GLOSS_KEY_LEN = maxLen;

export function getSentenceSpans(plain: string): readonly GlossarySpan[] | null {
  return Object.hasOwn(spans, plain) ? spans[plain] : null;
}

/**
 * 结合语境读音优先匹配多音词键（`表层|读音`），否则回退精确表层键。
 */
export function lookupGlossaryKey(surface: string, reading: string): string | null {
  if (reading) {
    const exact = `${surface}|${reading}`;
    if (Object.hasOwn(entries, exact)) return exact;
  }
  if (Object.hasOwn(entries, surface)) return surface;
  return null;
}

export function getGlossaryEntry(key: string): (GlossaryEntry & { surface: string }) | null {
  if (!Object.hasOwn(entries, key)) return null;
  const clean = key.replace(/#\d+$/, '');
  const sep = clean.indexOf('|');
  const surface = sep === -1 ? clean : clean.slice(0, sep);
  return { ...entries[key], surface };
}
