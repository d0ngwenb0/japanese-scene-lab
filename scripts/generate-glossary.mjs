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

const apiKeys = [...new Set([
  ...(process.env.GEMINI_API_KEYS || '').split(',').map((s) => s.trim()),
  ...Object.entries(process.env)
    .filter(([k]) => /^GEMINI_API_KEY\d*$/.test(k))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => (v || '').trim()),
].filter(Boolean))];
if (!apiKeys.length) {
  throw new Error('缺少 GEMINI_API_KEY / GEMINI_API_KEYS，请在 .env.local 中配置。');
}

const TOKEN_RE = /\{([^{}|]+)\|([^{}|]+)\}/g;
const MODELS = process.env.GEMINI_GLOSSARY_MODEL
  ? [process.env.GEMINI_GLOSSARY_MODEL, 'gemini-4-argon']
  : ['gemini-4-hydrogen', 'gemini-4-argon'];
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
  for (const model of MODELS) {
    for (let attempt = 0; attempt < apiKeys.length * 2; attempt += 1) {
      const key = apiKeys[(keyOffset + attempt) % apiKeys.length];
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 16384,
                responseMimeType: 'application/json',
              },
            }),
            signal: AbortSignal.timeout(90_000),
          },
        );
        if (!res.ok) {
          lastErr = new Error(`${model} ${res.status}: ${(await res.text()).slice(0, 300)}`);
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
  }
  throw lastErr || new Error('Gemini API 请求失败');
}

const scenarios = JSON.parse(readFileSync(scenariosPath, 'utf8'));

// 支持 `--only=id1,id2` 局部重跑
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const onlySet = onlyArg ? new Set(onlyArg.slice(7).split(',').map((s) => s.trim()).filter(Boolean)) : null;

// 按场景组织上下文，并追踪去重后的所有唯一句（plain -> sentMeta）
const sentenceByPlain = new Map();
const sceneGroups = [];

for (const scene of scenarios) {
  const speakerMap = new Map(scene.speakers.map((s) => [s.id, s.label]));
  const contextLines = scene.lines.map((l) => ({
    speaker: speakerMap.get(l.speaker) || l.speaker,
    plain: parseSentence(l.ja).plain,
    zh: l.zh,
  }));
  const jlptCtx = scene.jlpt
    ? {
        level: scene.jlpt.level,
        type: scene.jlpt.type,
        questionPlain: parseSentence(scene.jlpt.question).plain,
        questionZh: scene.jlpt.questionZh,
        optionsPlain: scene.jlpt.options.map((o) => parseSentence(o).plain),
        explanation: scene.jlpt.explanation,
      }
    : undefined;

  const candidates = [
    ...scene.lines.map((l) => ({
      id: `${scene.id}/${l.id}`,
      speaker: speakerMap.get(l.speaker) || l.speaker,
      ja: l.ja,
      zh: l.zh,
    })),
    ...(scene.jlpt
      ? [
          {
            id: `${scene.id}/q`,
            speaker: '設問',
            ja: scene.jlpt.question,
            zh: scene.jlpt.questionZh,
          },
          ...scene.jlpt.options.map((opt, idx) => ({
            id: `${scene.id}/o${idx}`,
            speaker: `選択肢${idx + 1}`,
            ja: opt,
            zh: `JLPT ${scene.jlpt.level} 选项${idx + 1}（答案解析参考：${scene.jlpt.explanation.slice(0, 60)}）`,
          })),
        ]
      : []),
  ];

  const sceneTargets = [];
  for (const item of candidates) {
    const parsed = parseSentence(item.ja);
    const meta = {
      id: item.id,
      sceneId: scene.id,
      speaker: item.speaker,
      zh: item.zh,
      ...parsed,
    };
    if (!sentenceByPlain.has(parsed.plain)) {
      sentenceByPlain.set(parsed.plain, meta);
      if (!onlySet || onlySet.has(scene.id)) {
        sceneTargets.push(meta);
      }
    }
  }

  if (sceneTargets.length > 0) {
    sceneGroups.push({
      scene: {
        id: scene.id,
        kind: scene.kind || 'dialogue',
        title: parseSentence(scene.title).plain,
        titleZh: scene.titleZh,
        speakers: scene.speakers.map((s) => `${s.label}${s.self ? '（学习者视角）' : ''}`),
      },
      contextLines,
      jlpt: jlptCtx,
      targets: sceneTargets,
    });
  }
}

const allSentences = [...sentenceByPlain.values()];
const targetSentences = sceneGroups.flatMap((g) => g.targets);

function buildPrompt(group, targetsSubset) {
  const payload = {
    scenario: group.scene,
    fullDialogueOrPassage: group.contextLines,
    ...(group.jlpt ? { jlpt: group.jlpt } : {}),
    targets: targetsSubset.map((s, idx) => ({
      i: idx,
      id: s.id,
      speaker: s.speaker,
      plain: s.plain,
      ja: s.ja,
      zh: s.zh,
    })),
  };

  return `你是一位功底深厚的日语名师与词典编纂专家。下面给你一个**完整日语场景的对话/短文上下文、人物关系与中文对照**，请你为 \`targets\` 中的每一句话做**逐词切分与「结合上下文环境、一针见血」的释义标注**（必须覆盖全部实词、关键表达与每一个助词）。

完整场景与待标注句子 JSON：
${JSON.stringify(payload, null, 2)}

请返回一个 JSON 对象，键为每句的 "id"，值为按句子从左到右顺序排列的词元数组：
{
  "<id>": [
    { "s": "原句精确子串", "p": "词性", "z": "结合上下文一针见血的中文释义", "l": "原形(可选)", "lr": "原形读音(可选)" }
  ]
}

核心要求（极其重要）：
1. **释义 \`z\` 必须结合当前场景、说话人立场与 \`zh\` 译文，一针见血点出真实含义/语用分寸**，严禁只会粘贴空洞的词典模板！
   - ❌ 禁止敷衍空话：不要只写「没问题」「提示动作的直接对象」「表所属修饰（…的）」「表礼貌断定」「表原因、理由（因为…）」。
   - ✅ **实词 / 动词 / 表达 / 敬语（\`名/動/形/副/表現/敬語/接/感\`）**：用 1 句精炼直白的中文（通常 8–26 字；基础实体名词如 駅、傘 可 4–12 字），直接点破**它在这里到底是什么意思、带有什么言外之意/语气/场景文化或引申义**：
     - 点餐问「カウンター席でも大丈夫ですので」中的 \`大丈夫\` → \`此处表不挑座位「吧台也没关系、不用讲究」\`
     - 职场回绝同事帮忙时说的 \`大丈夫です\` → \`职场委婉拒绝「不用麻烦了、我自己来就行」\`
     - 居酒屋推荐菜「よく出ています」中的 \`出ています\` → \`餐饮惯用表达「热销、点单率高」（非字面出来）\`
     - 喫茶店散文「音がすっと遠ざかります」中的 \`すっと\` → \`拟态词，精准描摹关门瞬间喧闹利落退去之感\`
     - 「やさしく迎えてくれます」中的 \`くれます\` → \`授受补助动词：拟人化写出「被空间温柔接纳」的惬意\`
     - 「落ち着いていきます」中的 \`いきます\` → \`「～ていく」写出心境随时间渐入平静的过程\`
     - JLPT 听力选项与问句中的关键字 → 直接点明它在题干/语境下的关键含义。
   - ✅ **所有助词（p: "助"）必须标注且一针见血（中文 10–26 字）**：必须说明它**在这句话里连接了哪两个成分、表达了什么具体的逻辑或语气效果**：
     - 「週末の午後」中的 \`の\` → \`限定时间范围：「周末」的「午后」\`
     - 「傘をたたんで」中的 \`を\` → \`动作直接对象标记：把「雨伞」收起来\`
     - 「照明に包まれて」中的 \`に\` → \`被动句动作来源：被暖光「温柔包围」\`
     - 「カウンター席でも」中的 \`でも\` → \`让步举例：「哪怕是吧台」也完全可以\`
     - 「中へ進むと」中的 \`と\` → \`必然触发：一迈步进屋立刻迎来后文感官变化\`
     - 「大丈夫ですので」中的 \`ので\` → \`以温和客观语气交代前提，比「から」更显礼貌\`

2. **p（词性）只能选一个**：\`"名"\` / \`"動"\` / \`"形"\` / \`"副"\` / \`"助"\` / \`"接"\` / \`"感"\` / \`"表現"\` / \`"敬語"\`。
   - 格助词/提示助词/副助词/接续助词/终助词全部单独标 \`"助"\`：如 は、が、を、に、で、と、の、も、へ、や、か、よ、ね、から、まで、までに、ので、のに、けど、けれど、ほど、くらい、だけ、など、でも、って、つつ、より、しか、ながら、ずつ 等。
   - 复合助词如「には」「にも」「では」「とは」「への」「での」「との」「からの」「までの」尽量拆成两个单助词分别解释，除非是固定语法（如「までに」表截止期限、「ので」表客观因果、「のに」表出乎意料的转折）。
   - **禁止误切**：严禁把 です / でしょう / でした / できます 拆成助词「で」；严禁把 デプロイはいつ 拆为「はい」+「つ」；严禁把 いかがですか 拆为「はい」+「かが」；严禁把 しやすく / かもしれません 拆出「もし」。

3. **覆盖率与活用形**：
   - 覆盖全部汉字词、汉字+送假名动词/形容词（活用形务必填写辞书形 \`"l"\` 与平假名读音 \`"lr"\`，例如 \`"s":"届いて", "l":"届く", "lr":"とどく"\`）、片假名外来语、副词、接续词、感叹词、敬语表达。
   - 句末常见「です / ます / ました / ません / でした」可整体标为 \`"敬語"\`（说明此处说话人礼貌/敬意度）或省略，但**绝对不能拆出「で」**。
   - 标点符号（、。？！…「」・）不要提取。

4. **字形精确对齐**：每个 \`"s"\` 必须与 \`plain\` 中的连续字符完全一致（不得改动汉字、假名或全半角），且按从左到右顺序出现，不得把 \`{漢字|かん じ}\` 标签切半。`;
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

const BATCH_SIZE = 10;
const batches = [];
for (const group of sceneGroups) {
  for (let i = 0; i < group.targets.length; i += BATCH_SIZE) {
    batches.push({
      group,
      targets: group.targets.slice(i, i + BATCH_SIZE),
    });
  }
}

console.log(
  `正在为 ${sceneGroups.length} 个场景 / ${targetSentences.length} 个去重句子生成语境化切分与一针见血释义，共 ${batches.length} 批…`,
);

const alignedByPlain = new Map();

// 若使用了 `--only=...`，先从既有 glossary.json 继承其他场景结果
if (onlySet && existsSync(glossaryPath)) {
  const existing = JSON.parse(readFileSync(glossaryPath, 'utf8'));
  const existingSpans = existing?.spans ?? {};
  const existingEntries = existing?.entries ?? {};
  const targetPlains = new Set(targetSentences.map((s) => s.plain));
  for (const sent of allSentences) {
    if (targetPlains.has(sent.plain)) continue;
    const spList = existingSpans[sent.plain];
    if (!Array.isArray(spList) || spList.length === 0) continue;
    alignedByPlain.set(
      sent.plain,
      spList.map(([start, end, key]) => {
        const entry = existingEntries[key] ?? { p: '名', z: '' };
        return {
          start,
          end,
          s: sent.plain.slice(start, end),
          r: entry.r ?? sent.readingForRange(start, end),
          p: entry.p,
          z: entry.z,
          l: entry.l,
          lr: entry.lr,
        };
      }),
    );
  }
}

const groupBySceneId = new Map(sceneGroups.map((g) => [g.scene.id, g]));

async function processBatch(batch, idx) {
  const { group, targets } = batch;
  const result = await callGemini(buildPrompt(group, targets), idx);
  let okCount = 0;
  for (const sent of targets) {
    const rawTokens = result?.[sent.id];
    if (!Array.isArray(rawTokens)) continue;
    const aligned = alignSentenceTokens(sent, rawTokens);
    if (aligned.length > 0) {
      alignedByPlain.set(sent.plain, aligned);
      okCount += 1;
    }
  }
  console.log(`  [${group.scene.id}] 批次 ${idx + 1}/${batches.length} 完成（命中 ${okCount}/${targets.length} 句）`);
}

// 控制并发为 4，配合 3 个 key 稳定执行
for (let i = 0; i < batches.length; i += 4) {
  await Promise.all(batches.slice(i, i + 4).map((b, j) => processBatch(b, i + j)));
}

// 补漏：若有个别句子遗漏或缺少核心实词/汉字，带所属场景上下文单独重试一次
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
  console.log(`发现 ${retryList.length} 句存在遗漏词元，正在带上下文自动补标注…`);
  const byScene = new Map();
  for (const sent of retryList) {
    if (!byScene.has(sent.sceneId)) byScene.set(sent.sceneId, []);
    byScene.get(sent.sceneId).push(sent);
  }
  const retryBatches = [];
  for (const [sceneId, sents] of byScene) {
    const group = groupBySceneId.get(sceneId) ?? {
      scene: { id: sceneId, kind: 'dialogue', title: sceneId, titleZh: '', speakers: [] },
      contextLines: sents.map((s) => ({ speaker: s.speaker, plain: s.plain, zh: s.zh })),
      targets: sents,
    };
    for (let i = 0; i < sents.length; i += 6) {
      retryBatches.push({ group, targets: sents.slice(i, i + 6) });
    }
  }
  for (let i = 0; i < retryBatches.length; i += 4) {
    await Promise.all(retryBatches.slice(i, i + 4).map((b, j) => processBatch(b, i + j + 2)));
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
