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

let entries: Record<string, GlossaryEntry> = {};
let spans: Record<string, GlossarySpan[]> = {};
let maxLen = 1;
let ready = false;
let loadPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function isGlossaryReady(): boolean {
  return ready;
}

export function subscribeGlossary(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function ensureGlossaryLoaded(): Promise<void> {
  if (ready) return Promise.resolve();
  if (!loadPromise) {
    loadPromise = import('../data/glossary.json')
      .then((mod) => {
        const payload = (mod.default ?? mod) as unknown as GlossaryPayload;
        entries = payload.entries;
        spans = payload.spans;
        let nextMax = 1;
        for (const key of Object.keys(entries)) {
          const clean = key.replace(/#\d+$/, '');
          const sep = clean.indexOf('|');
          const len = sep === -1 ? clean.length : sep;
          if (len > nextMax) nextMax = len;
        }
        maxLen = nextMax;
        ready = true;
        for (const listener of listeners) {
          listener();
        }
      })
      .catch(() => {
        loadPromise = null;
      });
  }
  return loadPromise;
}

export function getMaxGlossKeyLen(): number {
  return maxLen;
}

export function getSentenceSpans(plain: string): readonly GlossarySpan[] | null {
  if (!ready) return null;
  return Object.hasOwn(spans, plain) ? spans[plain] : null;
}

/**
 * 结合语境读音优先匹配多音词键（`表层|读音`），否则回退精确表层键。
 */
export function lookupGlossaryKey(surface: string, reading: string): string | null {
  if (!ready) return null;
  if (reading) {
    const exact = `${surface}|${reading}`;
    if (Object.hasOwn(entries, exact)) return exact;
  }
  if (Object.hasOwn(entries, surface)) return surface;
  return null;
}

export function getGlossaryEntry(key: string): (GlossaryEntry & { surface: string }) | null {
  if (!ready || !Object.hasOwn(entries, key)) return null;
  const clean = key.replace(/#\d+$/, '');
  const sep = clean.indexOf('|');
  const surface = sep === -1 ? clean : clean.slice(0, sep);
  return { ...entries[key], surface };
}
