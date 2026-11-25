import { Fragment, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import {
  ensureGlossaryLoaded,
  getGlossaryEntry,
  getMaxGlossKeyLen,
  getSentenceSpans,
  isGlossaryReady,
  lookupGlossaryKey,
  subscribeGlossary,
} from './glossary';

const TOKEN = /\{([^{}|]+)\|([^{}|]+)\}/g;

type Segment =
  | {
      kind: 'text';
      value: string;
      start: number;
      end: number;
    }
  | {
      kind: 'ruby';
      base: string;
      parts: string[];
      reading: string;
      start: number;
      end: number;
    };

function kataToHira(text: string): string {
  return text.replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

function parseSegments(text: string) {
  const segments: Segment[] = [];
  const charReadings: string[] = [];
  const forbiddenSplits = new Set<number>();
  let plain = '';
  let last = 0;

  const pushText = (chunk: string) => {
    const start = plain.length;
    for (const ch of chunk) {
      plain += ch;
      charReadings.push(ch);
    }
    segments.push({ kind: 'text', value: chunk, start, end: plain.length });
  };

  for (const match of text.matchAll(TOKEN)) {
    const idx = match.index ?? 0;
    if (idx > last) {
      pushText(text.slice(last, idx));
    }

    const base = match[1];
    const parts = match[2].trim().split(/[\s・]+/).filter(Boolean);
    const reading = parts.join('');
    const start = plain.length;
    const baseChars = [...base];
    plain += base;

    if (parts.length === baseChars.length) {
      for (const part of parts) {
        charReadings.push(part);
      }
    } else {
      charReadings.push(reading);
      for (let i = 1; i < baseChars.length; i += 1) {
        charReadings.push('');
      }
    }

    const end = plain.length;
    for (let pos = start + 1; pos < end; pos += 1) {
      forbiddenSplits.add(pos);
    }

    segments.push({ kind: 'ruby', base, parts, reading, start, end });
    last = idx + match[0].length;
  }

  if (last < text.length) {
    pushText(text.slice(last));
  }

  return { segments, plain, charReadings, forbiddenSplits };
}

function renderRuby(seg: Extract<Segment, { kind: 'ruby' }>, key: number | string) {
  return (
    <ruby key={key} aria-label={`${seg.base}（${seg.reading}）`}>
      {seg.base}
      <rt data-reading={seg.reading} aria-hidden="true" />
    </ruby>
  );
}

function renderSlice(segments: Segment[], start: number, end: number, prefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let idx = 0;
  for (const seg of segments) {
    if (seg.end <= start) continue;
    if (seg.start >= end) break;
    if (seg.kind === 'ruby') {
      nodes.push(renderRuby(seg, `${prefix}-r-${idx++}`));
    } else {
      const from = Math.max(0, start - seg.start);
      const to = Math.min(seg.value.length, end - seg.start);
      if (to > from) {
        nodes.push(seg.value.slice(from, to));
      }
    }
  }
  return nodes;
}

/**
 * 把 {漢字|かん じ} / {今日|きょう} 渲染成标准 HTML <ruby>：
 * - 读音用空格（或中点）分隔且段数等于字数时：单字对齐（モノルビ），保留在同一 <ruby> 内
 * - 读音不分隔时（单字或熟字训/当て字）：整词居中（グループルビ）
 * - 传入 glossary 时，优先按逐句语境词元跨度渲染（含助词精确语法解释），回退最长匹配
 */
export function Furigana({ text, glossary = false }: { text: string; glossary?: boolean }) {
  const glossaryReady = useSyncExternalStore(subscribeGlossary, isGlossaryReady, isGlossaryReady);

  useEffect(() => {
    if (glossary && !glossaryReady) {
      void ensureGlossaryLoaded();
    }
  }, [glossary, glossaryReady]);

  const { segments, plain, charReadings, forbiddenSplits } = parseSegments(text);

  if (!glossary || !glossaryReady) {
    return (
      <>
        {segments.map((seg, idx) =>
          seg.kind === 'ruby' ? renderRuby(seg, idx) : <Fragment key={idx}>{seg.value}</Fragment>,
        )}
      </>
    );
  }

  const sentenceSpans = getSentenceSpans(plain);
  if (sentenceSpans) {
    const nodes: ReactNode[] = [];
    let key = 0;
    let cursor = 0;

    for (const [start, end, spanKey] of sentenceSpans) {
      if (start < cursor || end > plain.length) continue;
      if (start > cursor) {
        nodes.push(...renderSlice(segments, cursor, start, `g${key++}`));
      }
      const entry = getGlossaryEntry(spanKey);
      const isParticle = entry?.p === '助';
      nodes.push(
        <span
          key={key++}
          className={isParticle ? 'gloss-word is-particle' : 'gloss-word'}
          data-gloss-key={spanKey}
          data-pos={entry?.p}
        >
          {renderSlice(segments, start, end, `s${key}`)}
        </span>,
      );
      cursor = end;
    }
    if (cursor < plain.length) {
      nodes.push(...renderSlice(segments, cursor, plain.length, `t${key++}`));
    }
    return <>{nodes}</>;
  }

  const nodes: ReactNode[] = [];
  let key = 0;
  let pos = 0;

  while (pos < plain.length) {
    let matchedLen = 0;
    let matchedKey: string | null = null;
    const maxTry = Math.min(getMaxGlossKeyLen(), plain.length - pos);

    for (let len = maxTry; len >= 1; len -= 1) {
      if (forbiddenSplits.has(pos + len)) continue;
      const surface = plain.slice(pos, pos + len);
      const reading = kataToHira(charReadings.slice(pos, pos + len).join(''));
      const found = lookupGlossaryKey(surface, reading);
      if (found) {
        matchedLen = len;
        matchedKey = found;
        break;
      }
    }

    if (matchedKey && matchedLen > 0) {
      const entry = getGlossaryEntry(matchedKey);
      const isParticle = entry?.p === '助';
      nodes.push(
        <span
          key={key++}
          className={isParticle ? 'gloss-word is-particle' : 'gloss-word'}
          data-gloss-key={matchedKey}
          data-pos={entry?.p}
        >
          {renderSlice(segments, pos, pos + matchedLen, `w${key}`)}
        </span>,
      );
      pos += matchedLen;
    } else {
      const rubySeg = segments.find((seg) => seg.kind === 'ruby' && seg.start === pos);
      if (rubySeg) {
        nodes.push(renderRuby(rubySeg as Extract<Segment, { kind: 'ruby' }>, key++));
        pos = rubySeg.end;
      } else {
        nodes.push(plain[pos]);
        pos += 1;
      }
    }
  }

  return <>{nodes}</>;
}
