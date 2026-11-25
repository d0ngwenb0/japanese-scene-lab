#!/usr/bin/env node
/**
 * 从 src/data/scenarios.json 对每句话进行语境化词元切分与释义标注（含每一个助词的精确语法解释），
 * 结合 {漢字|かん じ} 上下文读音与出现位置生成 `{ entries, spans }` 到 src/data/glossary.json。
 *
 * 用法：
 *   npm run glossary:gen
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scenariosPath = join(root, 'src', 'data', 'scenarios.json');
const glossaryPath = join(root, 'src', 'data', 'glossary.json');

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(join(root, '.env.local'));
loadEnvFile(join(root, '.env'));

const apiKeys = [
  ...(process.env.GEMINI_API_KEYS || '').split(',').map((s) => s.trim()).filter(Boolean),
  ...(process.env.GEMINI_API_KEY ? [process.env.GEMINI_API_KEY.trim()] : []),
];
if (!apiKeys.length) {
  throw new Error('缺少 GEMINI_API_KEY / GEMINI_API_KEYS，请在 .env.local 中配置。');
}

const TOKEN_RE = /\{([^{}|]+)\|([^{}|]+)\}/g;
const MODEL = 'gemini-4-hydrogen';
const ALLOWED_POS = new Set(['名', '動', '形', '副', '助', '接', '感', '表現', '敬語']);

function kataToHira(text) {
  return text.replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

function parseSentence(ja) {
  let plain = '';
  const charReadings = [];
  const forbiddenSplits = new Set();
  const tokens = [];
  let last = 0;

  for (const match of ja.matchAll(TOKEN_RE)) {
    const idx = match.index ?? 0;
    if (idx > last) {
      const gap = ja.slice(last, idx);
      for (const ch of gap) {
        plain += ch;
        charReadings.push(ch);
      }
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
    tokens.push({ base, reading, start, end });
    last = idx + match[0].length;
  }

  if (last < ja.length) {
    const tail = ja.slice(last);
    for (const ch of tail) {
      plain += ch;
      charReadings.push(ch);
    }
  }

  const readingForRange = (start, end) =>
    kataToHira(charReadings.slice(start, end).join(''));

  return { ja, plain, forbiddenSplits, tokens, readingForRange };
}

async function callGemini(prompt, keyOffset = 0) {
  let lastErr = null;
  for (let attempt = 0; attempt < apiKeys.length * 3; attempt += 1) {
    const key = apiKeys[(keyOffset + attempt) % apiKeys.length];
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.15,
              responseMimeType: 'application/json',
            },
          }),
        },
      );
      if (!res.ok) {
        lastErr = new Error(`${MODEL} ${res.status}: ${(await res.text()).slice(0, 300)}`);
        continue;
      }
      const payload = await res.json();
      const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) continue;
      return JSON.parse(text);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Gemini API 请求失败');
}

const scenarios = JSON.parse(readFileSync(scenariosPath, 'utf8'));

// 按纯日文句子去重（例如 JLPT 问句与最后一句台词完全一致）
const sentenceByPlain = new Map();
for (const scene of scenarios) {
  const candidates = [
    ...scene.lines.map((l) => ({ id: `${scene.id}/${l.id}`, ja: l.ja })),
    ...(scene.jlpt
      ? [
          { id: `${scene.id}/q`, ja: scene.jlpt.question },
          ...scene.jlpt.options.map((opt, idx) => ({ id: `${scene.id}/o${idx}`, ja: opt })),
        ]
      : []),
  ];
  for (const item of candidates) {
    const parsed = parseSentence(item.ja);
    if (!sentenceByPlain.has(parsed.plain)) {
      sentenceByPlain.set(parsed.plain, { id: item.id, ...parsed });
    }
  }
}

const allSentences = [...sentenceByPlain.values()];

function buildPrompt(batchSentences) {
  const items = batchSentences.map((s, idx) => ({
    i: idx,
    id: s.id,
    plain: s.plain,
    ja: s.ja,
  }));

  return `你是一位专业日语语法与词典编纂专家。请对下面每一句日语学习语料做**逐词切分与语境释义标注**（必须包含每一个助词在当前句子中的准确语法解释）。

待标注句子 JSON：
${JSON.stringify(items, null, 2)}

请返回一个 JSON 对象，键为每个句子的 "id"，值为按句子从左到右顺序排列的词元数组：
{
  "<id>": [
    { "s": "原句精确子串", "p": "词性", "z": "语境释义", "l": "原形(可选)", "lr": "原形读音(可选)" }
  ]
}

严格规范：
1. **p（词性）只能选一个**："名" / "動" / "形" / "副" / "助" / "接" / "感" / "表現" / "敬語"。
2. **所有助词必须标注（p: "助"）**，并给出**在该句中的最合理、最准确的语法解释**（中文 ≤ 22 字）：
   - 格助词/提示助词/副助词/接续助词/终助词全部单独提取：如 は、が、を、に、で、と、の、も、へ、や、か、よ、ね、から、まで、までに、ので、のに、けど、けれど、ほど、くらい、だけ、など、でも、って、つつ、より、しか、ながら、ずつ 等。
   - **禁止**把 です / でしょう / でした / できます 误拆成助词「で」；禁止把 デプロイはいつ 误切为「はい」+「つ」；禁止把 いかがですか 误切为「はい」+「かが」；禁止把 しやすく / かもしれません 误切为「もし」。
   - 同一助词在不同句子要给出符合当前语境的解释，例如：
     - 「渋谷で降りて」中的 で → "表动作发生的场所（在…）"
     - 「現金でお願いします」中的 で → "表支付方式或手段（用…）"
     - 「人身事故で止まっている」中的 で → "表原因、理由（因为…）"
     - 「駅に着く」中的 に → "表移动到达点（到…）"
     - 「六時半に変更」中的 に → "表变更后的结果（改为…）"
     - 「行くのをやめました」中的 の → "将前面动词短语名词化"
     - 「駅の近く」中的 の → "表所属或修饰（相当于「的」）"
     - 「お願いしたいのですが」中的 のですが → "表委婉铺垫，引出请求或说明"（或者 ので/が 各自准确解释）
     - 複合助词如「には」「にも」「では」「とは」「への」「での」「との」「からの」「までの」可拆成两个单助词（例如 の + は / に + は），以便分别看清每个助词的作用，除非作为固定语法（如「までに」表截止期限、「ので」表原因、「のに」表转折）。
3. **所有实词与关键表达必须覆盖**：
   - 覆盖全部汉字词、汉字+送假名动词/形容词（活用形填写 "l" 辞书形和 "lr" 平假名读音，如 "s":"届いて", "l":"届く", "lr":"とどく"）、片假名外来语、副词、接续词、感叹词、敬语表达。
   - 句末常见「です / ます / ました / ません / でした」可整体标为 "敬語" 或省略（绝对不要拆开标「で」）。
   - 标点符号（、。？！…「」・）不要提取。
4. **字形精确对齐**：每一个 "s" 必须与该句 "plain" 字段中的连续字符完全一致（不得修改汉字、假名或全半角），且大致按从左到右顺序出现，不得把 {漢字|かん じ} 标签拆成半截。`;
}

function isFalseParticleSplit(sent, idx, end, surface, pos) {
  const ctx2 = sent.plain.slice(idx, idx + 2);
  const ctx3 = sent.plain.slice(idx, idx + 3);
  const ctx4 = sent.plain.slice(idx, idx + 4);
  if (surface === 'で' && /^(?:です|でし|でき)/.test(ctx2)) return true;
  if (surface === 'はい' && (ctx3 === 'はいつ' || ctx4 === 'はいかが')) return true;
  if (surface === 'もし' && (ctx4 === 'もしやす' || sent.plain.slice(Math.max(0, idx - 1), idx + 5).includes('かもしれ'))) return true;
  if (pos === '助' && /^[、。？！…「」・\s]$/.test(surface)) return true;
  return false;
}

function alignSentenceTokens(sent, rawTokens) {
  const spans = [];
  let cursor = 0;

  for (const tok of rawTokens) {
    if (!tok || typeof tok.s !== 'string' || typeof tok.z !== 'string' || typeof tok.p !== 'string') continue;
    const s = tok.s.trim();
    const p = ALLOWED_POS.has(tok.p.trim()) ? tok.p.trim() : '名';
    const z = tok.z.trim();
    if (!s || !z) continue;
    if (/^[、。？！…「」・\s]+$/.test(s)) continue;

    let searchFrom = cursor;
    let foundIdx = -1;
    while (searchFrom < sent.plain.length) {
      const idx = sent.plain.indexOf(s, searchFrom);
      if (idx === -1) break;
      const end = idx + s.length;
      if (sent.forbiddenSplits.has(idx) || sent.forbiddenSplits.has(end)) {
        searchFrom = idx + 1;
        continue;
      }
      if (isFalseParticleSplit(sent, idx, end, s, p)) {
        searchFrom = idx + 1;
        continue;
      }
      foundIdx = idx;
      break;
    }

    if (foundIdx === -1) continue;
    const end = foundIdx + s.length;
    const reading = sent.readingForRange(foundIdx, end);
    const l = typeof tok.l === 'string' && tok.l.trim() && tok.l.trim() !== s ? tok.l.trim() : undefined;
    const lr = l && typeof tok.lr === 'string' && tok.lr.trim() ? kataToHira(tok.lr.trim()) : undefined;

    spans.push({ start: foundIdx, end, s, r: reading, p, z, l, lr });
    cursor = end;
  }

  return spans;
}

const BATCH_SIZE = 12;
const batches = [];
for (let i = 0; i < allSentences.length; i += BATCH_SIZE) {
  batches.push(allSentences.slice(i, i + BATCH_SIZE));
}

console.log(`正在为 ${allSentences.length} 个去重句子生成含助词的语境切分与释义，共 ${batches.length} 批…`);

const alignedByPlain = new Map();

async function processBatch(batch, idx) {
  const result = await callGemini(buildPrompt(batch), idx);
  let okCount = 0;
  for (const sent of batch) {
    const rawTokens = result?.[sent.id];
    if (!Array.isArray(rawTokens)) continue;
    const aligned = alignSentenceTokens(sent, rawTokens);
    if (aligned.length > 0) {
      alignedByPlain.set(sent.plain, aligned);
      okCount += 1;
    }
  }
  console.log(`  批次 ${idx + 1}/${batches.length} 完成（命中 ${okCount}/${batch.length} 句）`);
}

// 控制并发为 5，避免触发速率限制
for (let i = 0; i < batches.length; i += 5) {
  await Promise.all(batches.slice(i, i + 5).map((b, j) => processBatch(b, i + j)));
}

// 补漏：若有个别句子遗漏或缺少核心实词/常见助词，单独重试一次
function findMissingOrWeakSentences() {
  const missing = [];
  for (const sent of allSentences) {
    const aligned = alignedByPlain.get(sent.plain);
    if (!aligned || aligned.length === 0) {
      missing.push(sent);
      continue;
    }
    const covered = new Uint8Array(sent.plain.length);
    for (const sp of aligned) {
      for (let k = sp.start; k < sp.end; k += 1) covered[k] = 1;
    }
    let uncoveredKanji = false;
    for (const tok of sent.tokens) {
      for (let k = tok.start; k < tok.end; k += 1) {
        if (!covered[k]) uncoveredKanji = true;
      }
    }
    if (uncoveredKanji) missing.push(sent);
  }
  return missing;
}

const retryList = findMissingOrWeakSentences();
if (retryList.length > 0) {
  console.log(`发现 ${retryList.length} 句存在遗漏词元，正在自动补标注…`);
  for (let i = 0; i < retryList.length; i += 10) {
    await processBatch(retryList.slice(i, i + 10), i + 3);
  }
}

for (const sent of allSentences) {
  const aligned = alignedByPlain.get(sent.plain);
  if (!aligned || aligned.length === 0) {
    throw new Error(`句子未能对齐生成词元：${sent.id} ${sent.plain}`);
  }
}

// 组装去重后的 entries 与 spans
const entries = {};
const surfaceVariants = new Map(); // surface -> Map<signature, key>

function getOrCreateEntryKey(sp) {
  const isPureKana = /^[ぁ-んァ-ヶー]+$/.test(sp.s);
  const reading = isPureKana ? undefined : sp.r;
  const sig = JSON.stringify([sp.s, reading ?? '', sp.l ?? '', sp.lr ?? '', sp.p, sp.z]);

  if (!surfaceVariants.has(sp.s)) {
    surfaceVariants.set(sp.s, new Map());
  }
  const variants = surfaceVariants.get(sp.s);
  if (variants.has(sig)) {
    return variants.get(sig);
  }

  let key = sp.s;
  if (Object.hasOwn(entries, key)) {
    let idx = 2;
    while (Object.hasOwn(entries, `${sp.s}#${idx}`)) {
      idx += 1;
    }
    key = `${sp.s}#${idx}`;
  }

  const entry = { p: sp.p, z: sp.z };
  if (reading) entry.r = reading;
  if (sp.l) {
    entry.l = sp.l;
    if (sp.lr && sp.lr !== sp.l) entry.lr = sp.lr;
  }
  entries[key] = entry;
  variants.set(sig, key);
  return key;
}

const spans = {};
for (const sent of allSentences) {
  const aligned = alignedByPlain.get(sent.plain);
  spans[sent.plain] = aligned.map((sp) => [sp.start, sp.end, getOrCreateEntryKey(sp)]);
}

const sortedEntries = Object.fromEntries(
  Object.keys(entries)
    .sort((a, b) => a.localeCompare(b, 'ja'))
    .map((k) => [k, entries[k]]),
);
const sortedSpans = Object.fromEntries(
  Object.keys(spans)
    .sort((a, b) => a.localeCompare(b, 'ja'))
    .map((k) => [k, spans[k]]),
);

const payload = { entries: sortedEntries, spans: sortedSpans };
writeFileSync(glossaryPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

const particleEntries = Object.values(sortedEntries).filter((e) => e.p === '助').length;
const totalSpans = Object.values(sortedSpans).reduce((sum, arr) => sum + arr.length, 0);
console.log(
  `已写入 src/data/glossary.json：${Object.keys(sortedEntries).length} 个词条（其中助词 ${particleEntries} 条），${Object.keys(sortedSpans).length} 句 / ${totalSpans} 个词元跨度`,
);
