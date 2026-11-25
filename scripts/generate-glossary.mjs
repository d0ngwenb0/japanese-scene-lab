#!/usr/bin/env node
/**
 * 从 src/data/scenarios.json 提取全部日语语料的实词与固定表达，
 * 调用 Gemini 生成高质量中文释义，并结合 {漢字|かん じ} 上下文读音进行多音词消歧，
 * 输出到 src/data/glossary.json。
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
    charReadings
      .slice(start, end)
      .join('')
      .replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

  return { ja, plain, forbiddenSplits, tokens, readingForRange };
}

function kataToHira(text) {
  return text.replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

async function callGemini(prompt, keyOffset = 0) {
  let lastErr = null;
  for (let attempt = 0; attempt < apiKeys.length * 2; attempt += 1) {
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
              temperature: 0.2,
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
const parsedSentences = [];
for (const scene of scenarios) {
  for (const line of scene.lines) {
    parsedSentences.push({ id: `${scene.id}/${line.id}`, ...parseSentence(line.ja) });
  }
  if (scene.jlpt) {
    parsedSentences.push({ id: `${scene.id}/q`, ...parseSentence(scene.jlpt.question) });
    scene.jlpt.options.forEach((opt, idx) => {
      parsedSentences.push({ id: `${scene.id}/o${idx}`, ...parseSentence(opt) });
    });
  }
}

const BATCH_SIZE = 5;
const batches = [];
for (let i = 0; i < scenarios.length; i += BATCH_SIZE) {
  batches.push(scenarios.slice(i, i + BATCH_SIZE));
}

function buildPrompt(batchScenarios) {
  const linesText = [];
  for (const s of batchScenarios) {
    linesText.push(`【${s.id}】`);
    for (const l of s.lines) {
      linesText.push(`- ${parseSentence(l.ja).plain}`);
    }
    if (s.jlpt) {
      linesText.push(`- ${parseSentence(s.jlpt.question).plain}`);
      for (const opt of s.jlpt.options) {
        linesText.push(`- ${parseSentence(opt).plain}`);
      }
    }
  }

  return `你是一位专业日语词典编纂专家。请从下面日语学习场景台词中，提取所有有学习价值的**实词、动词短语、形容词、副词、外来语、重要寒暄/敬语/连词表达**。

台词列表：
${linesText.join('\n')}

要求：
1. 返回一个 JSON 数组（不要 markdown 代码块），每个元素格式：
   {
     "s": "原句中完全一致的表层字符串（如 届いて、特急券、冷たい、ノイズキャンセリング、かしこまりました、ちなみに）",
     "r": "s 的平假名读音（如果 s 本身已是纯平假名或纯片假名则可省略或留空）",
     "l": "仅当 s 为活用/变形时填写辞书形原形（如 届いて -> 届く、乗り換え -> 乗り換える、安くて -> 安い）；否则省略",
     "lr": "仅当填写了 l 时填写 l 的平假名读音（如 とどく）；否则省略",
     "p": "词性标签，只能从以下选一个：名 / 動 / 形 / 副 / 接 / 感 / 表現 / 敬語",
     "z": "准确简洁的中文释义（不超过22个字；敬语请标注如：查看（「見る」的谦让语）；注意贴合台词中的真实语义）"
   }
2. 抽取规范：
   - 必须尽量完整覆盖句中的每一个实词（所有汉字词、汉字+送假名的动词/形容词活用片段、片假名外来语、常见功能副词/接续词如 ちなみに / ばっちり / さっそく / ぜんぜん / できるだけ / しみる / すっかり）。
   - 对于复合词，优先保留完整的常用词（例如「特急券」「本人確認書類」「振替輸送」「定期検診」「ノイズキャンセリング」「予約アプリ」），同时也可适度拆出高频子词。
   - **不要**提取单独的助词（は、が、を、に、で、と、の、も、か、よ、ね、へ、から、まで 等）或光秃秃的助动词/敬体词尾（です、ます、ました、ません、でした、て、いる 等），也不要提取标点符号。
   - 动词/形容词的 "s" 应是原句中真实出现的词形（例如原句是「冷たいものを飲むと」，可提「冷たい」「もの」「飲む」，其中「冷たい」「飲む」本身就是原形则不填 l；若原句是「届いていないか」，提 "s": "届いて", "l": "届く", "lr": "とどく"；若原句是「降りられた」，提 "s": "降りられた", "l": "降りる" 或提「降り」）。
   - "s" 必须严格逐字匹配上述台词里的字符（含全半角一致）。`;
}

console.log(`正在从 ${scenarios.length} 个场景（${parsedSentences.length} 句）抽取词条，共 ${batches.length} 批…`);
const rawItems = [];

const batchResults = await Promise.all(
  batches.map(async (batch, idx) => {
    const res = await callGemini(buildPrompt(batch), idx);
    console.log(`  批次 ${idx + 1}/${batches.length} 完成（${Array.isArray(res) ? res.length : 0} 条）`);
    return Array.isArray(res) ? res : [];
  }),
);
for (const arr of batchResults) rawItems.push(...arr);

// 验证每个词条是否在语料中按合法边界出现，并收集其上下文读音
const ALLOWED_POS = new Set(['名', '動', '形', '副', '接', '感', '表現', '敬語']);
const SKIP_SURFACES = new Set([
  'は', 'が', 'を', 'に', 'で', 'と', 'の', 'も', 'か', 'よ', 'ね', 'へ', 'や', 'な',
  'です', 'ます', 'ました', 'ません', 'でした', 'でしょう', 'たい', 'ない', 'いる', 'ある', 'する',
  'こと', 'もの', 'よう', 'ほう', 'ため',
]);

function collectValidItems(items, targetMap) {
  for (const item of items) {
    if (!item || typeof item.s !== 'string' || typeof item.z !== 'string' || typeof item.p !== 'string') {
      continue;
    }
    const surface = item.s.trim();
    const pos = ALLOWED_POS.has(item.p.trim()) ? item.p.trim() : '名';
    const zh = item.z.trim();
    if (!surface || !zh || surface.length > 16) continue;
    if (SKIP_SURFACES.has(surface)) continue;
    if (/^[ぁ-んー、。？！…「」・\s]+$/.test(surface) && surface.length < 2) continue;

    // 在语料中匹配所有合法非切分边界的出现位置
    const observedReadings = new Set();
    for (const sent of parsedSentences) {
      let from = 0;
      while (true) {
        const idx = sent.plain.indexOf(surface, from);
        if (idx === -1) break;
        const end = idx + surface.length;
        if (!sent.forbiddenSplits.has(idx) && !sent.forbiddenSplits.has(end)) {
          observedReadings.add(sent.readingForRange(idx, end));
        }
        from = idx + 1;
      }
    }
    if (!observedReadings.size) continue;

    const lemma = typeof item.l === 'string' && item.l.trim() && item.l.trim() !== surface ? item.l.trim() : undefined;
    const lemmaReading = lemma && typeof item.lr === 'string' && item.lr.trim() ? kataToHira(item.lr.trim()) : undefined;
    const itemReading = typeof item.r === 'string' && item.r.trim() ? kataToHira(item.r.trim()) : undefined;

    if (!targetMap.has(surface)) {
      targetMap.set(surface, new Map());
    }
    const readingBucket = targetMap.get(surface);

    // 若语料里同一表层词出现多个上下文读音，或 AI 给出的读音能匹配其中之一
    for (const ctxRead of observedReadings) {
      // 如果同一 surface 有多个不同读音，且 item 明确提供了 r 且与当前 ctxRead 差异较大，则跳过不匹配的读音
      if (observedReadings.size > 1 && itemReading && ctxRead !== itemReading) {
        continue;
      }
      if (!readingBucket.has(ctxRead)) {
        const entry = { p: pos, z: zh };
        if (!/^[ぁ-んァ-ヶー]+$/.test(surface)) {
          entry.r = ctxRead;
        }
        if (lemma) {
          entry.l = lemma;
          if (lemmaReading && lemmaReading !== lemma) {
            entry.lr = lemmaReading;
          }
        }
        readingBucket.set(ctxRead, entry);
      }
    }

    // 兜底：若该 surface 在语料中有多个读音且上面的过筛导致某个读音未写入，先暂存第一个条目待缺口补全
    if (observedReadings.size > 1 && itemReading) {
      for (const ctxRead of observedReadings) {
        if (!readingBucket.has(ctxRead) && !targetMap.get(surface).size) {
          const entry = { p: pos, z: zh };
          if (!/^[ぁ-んァ-ヶー]+$/.test(surface)) entry.r = ctxRead;
          if (lemma) {
            entry.l = lemma;
            if (lemmaReading && lemmaReading !== lemma) entry.lr = lemmaReading;
          }
          readingBucket.set(ctxRead, entry);
        }
      }
    }
  }
}

const surfaceMap = new Map();
collectValidItems(rawItems, surfaceMap);

// 检查哪些语料中的汉字/片假名词尚未被任何已收录词条覆盖，做一次精准补漏
function findMissingTokens() {
  const allKeys = new Set(surfaceMap.keys());
  const maxLen = Math.max(1, ...[...allKeys].map((k) => k.length));
  const uncovered = new Set();

  for (const sent of parsedSentences) {
    const covered = new Uint8Array(sent.plain.length);
    for (let pos = 0; pos < sent.plain.length; ) {
      let matched = 0;
      for (let len = Math.min(maxLen, sent.plain.length - pos); len >= 1; len -= 1) {
        if (sent.forbiddenSplits.has(pos + len)) continue;
        const sub = sent.plain.slice(pos, pos + len);
        if (allKeys.has(sub)) {
          matched = len;
          break;
        }
      }
      if (matched) {
        for (let k = pos; k < pos + matched; k += 1) covered[k] = 1;
        pos += matched;
      } else {
        pos += 1;
      }
    }
    for (const tok of sent.tokens) {
      let allCovered = true;
      for (let k = tok.start; k < tok.end; k += 1) {
        if (!covered[k]) {
          allCovered = false;
          break;
        }
      }
      if (!allCovered) {
        // 尽量连带紧随的送假名一起看
        const tailMatch = sent.plain.slice(tok.end).match(/^[ぁ-ん]{1,3}/);
        const contextWord = tok.base + (tailMatch ? tailMatch[0] : '');
        uncovered.add(`${tok.base}（上下文：${sent.plain.slice(Math.max(0, tok.start - 2), Math.min(sent.plain.length, tok.end + 5))}）`);
      }
    }
    for (const m of sent.plain.matchAll(/[ァ-ヴー]{2,}/g)) {
      const idx = m.index ?? 0;
      if (!covered[idx]) {
        uncovered.add(m[0]);
      }
    }
  }
  return [...uncovered];
}

const missingTokens = findMissingTokens();
console.log(`初轮有效词条 ${surfaceMap.size} 个；未覆盖汉字/片假名线索 ${missingTokens.length} 条`);

if (missingTokens.length > 0) {
  const CHUNK = 80;
  for (let i = 0; i < missingTokens.length; i += CHUNK) {
    const chunk = missingTokens.slice(i, i + CHUNK);
    const fillPrompt = `以下是日语学习语料中尚未收入词典的单词及所在上下文片段，请为每个词（如需要可连带后面的送假名动词/形容词活用一起截取为完整词形）生成词典条目：

${chunk.join('\n')}

要求返回 JSON 数组，每项格式：
{"s":"原句中出现的表层字符串（包含必要送假名）","r":"平假名读音","l":"若为活用形则填辞书形，否则省略","lr":"l的读音","p":"名/動/形/副/接/感/表現/敬語","z":"准确简洁中文释义（≤22字）"}`;
    const filled = await callGemini(fillPrompt, i);
    if (Array.isArray(filled)) {
      collectValidItems(filled, surfaceMap);
    }
  }
}

// 组装最终 glossary.json：
// - 同一 surface 有多个不同读音 -> 以 "surface|reading" 存储（并确保多音字每个读音都有释义）
// - 唯一读音 -> 直接以 "surface" 存储
const finalGlossary = {};
for (const [surface, readingBucket] of surfaceMap.entries()) {
  if (readingBucket.size === 1) {
    const [, entry] = [...readingBucket.entries()][0];
    finalGlossary[surface] = entry;
  } else if (readingBucket.size > 1) {
    for (const [reading, entry] of readingBucket.entries()) {
      finalGlossary[`${surface}|${reading}`] = entry;
    }
  }
}

const sortedGlossary = Object.fromEntries(
  Object.keys(finalGlossary)
    .sort((a, b) => a.localeCompare(b, 'ja'))
    .map((k) => [k, finalGlossary[k]]),
);

writeFileSync(glossaryPath, `${JSON.stringify(sortedGlossary, null, 2)}\n`, 'utf8');
const remaining = findMissingTokens();
console.log(`已写入 src/data/glossary.json：共 ${Object.keys(sortedGlossary).length} 个词条（剩余未覆盖零星线索 ${remaining.length} 条）`);
