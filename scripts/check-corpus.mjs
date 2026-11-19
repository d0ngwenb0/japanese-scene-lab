#!/usr/bin/env node
/**
 * 语料巡检的机械检查（对应 docs/corpus-review.md 第 5 节第 1 步）。
 *
 * 只做能可靠自动判定的部分：
 *   E4 中文译文里出现未加引号的假名
 *   E5 数量词/日期读音命中已知错误白名单
 *   E6 日文正文含多余分词空格
 *   E7 场景句数或短文段数超出规定范围（对话 5–8 句；短文 5–6 段；JLPT 4–12 句）
 *   W1 跨场景实质重复台词（≥12 字，需人工判定为 B 类）
 *   W2 中文相同但日文不同的台词（疑似复制）
 *   W3 句末缺标点或单句逗号过多（影响 TTS 韵律）
 *
 * 错误（E）返回 1；警告（W）只提示，不阻塞。
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scenarios = JSON.parse(readFileSync(join(root, 'src/data/scenarios.json'), 'utf8'));

const strip = (text) => text.replace(/\{([^{}|]+)\|([^{}|]+)\}/g, '$1');
const toKana = (text) => text.replace(/\{([^{}|]+)\|([^{}|]+)\}/g, '$2');
const squash = (text) => strip(text).replace(/\s/g, '');
const kana = /[\u3040-\u30ff]/;
// 中文里允许用「」『』引用日语词
const removeQuotedJa = (text) => text.replace(/「[^」]*」/g, '').replace(/『[^』]*』/g, '');

if (process.argv.includes('--kana')) {
  for (const scene of scenarios) {
    console.log(`\n=== ${scene.id} ===`);
    console.log(`T: ${strip(scene.title)}\n   ${toKana(scene.title)}`);
    for (const line of scene.lines) {
      console.log(`${line.id}: ${strip(line.ja)}\n    ${toKana(line.ja)}`);
    }
    if (scene.jlpt) {
      console.log(`Q: ${strip(scene.jlpt.question)}\n   ${toKana(scene.jlpt.question)}`);
      scene.jlpt.options.forEach((o, i) => console.log(`O${i}: ${strip(o)} -> ${toKana(o)}`));
    }
  }
  process.exit(0);
}

const errors = [];
const warnings = [];

// E5：已知必须读成某音的写法
const READING_RULES = {
  一階: 'いっかい',
  二階: 'にかい',
  三階: 'さんがい',
  六階: 'ろっかい',
  四時: 'よじ',
  七時: 'しちじ',
  九時: 'くじ',
  二十歳: 'はたち',
  一人: 'ひとり',
  二人: 'ふたり',
  二日: 'ふつか',
  三日: 'みっか',
  四日: 'よっか',
  五日: 'いつか',
  六日: 'むいか',
  七日: 'なのか',
  八日: 'ようか',
  九日: 'ここのか',
  十日: 'とおか',
  十四日: 'じゅうよっか',
  二十日: 'はつか',
  二十四日: 'にじゅうよっか',
  三百: 'さんびゃく',
  六百: 'ろっぴゃく',
  八百: 'はっぴゃく',
  三千: 'さんぜん',
  八千: 'はっせん',
  土産: 'みやげ',
  風邪: 'かぜ',
};

// E5b：带送假名的常见易错读音（检查 {漢字|かんじ} + 紧随的送假名）
const OKURIGANA_RULES = [
  { surface: '膨', next: /^ら/, expected: 'ふく' },
  { surface: '少', next: /^な/, expected: 'すく' },
  { surface: '少', next: /^し/, expected: 'すこ' },
  { surface: '行', next: /^っ/, expected: 'い' },
  { surface: '入', next: /^っ/, expected: 'はい' },
  { surface: '入', next: /^れ/, expected: 'い' },
  { surface: '開', next: /^け/, expected: 'あ' },
  { surface: '閉', next: /^め/, expected: 'し' },
  { surface: '出', next: /^[すしせ]/, expected: 'だ' },
  { surface: '出', next: /^[てたる]/, expected: 'で' },
];

// E4 / E5 / E6 / E7 + W3
for (const scene of scenarios) {
  const isPassage = scene.kind === 'passage';
  const isJlpt = scene.kind === 'jlpt';
  if (isPassage && (scene.lines.length < 5 || scene.lines.length > 6)) {
    errors.push(`E7 ${scene.id}: 短文段数应为 5–6 段（当前 ${scene.lines.length} 段）`);
  } else if (isJlpt && (scene.lines.length < 4 || scene.lines.length > 12)) {
    errors.push(`E7 ${scene.id}: JLPT 听力句数应为 4–12 句（当前 ${scene.lines.length} 句）`);
  } else if (!isPassage && !isJlpt && (scene.lines.length < 5 || scene.lines.length > 8)) {
    errors.push(`E7 ${scene.id}: 对话句数应为 5–8 句（当前 ${scene.lines.length} 句）`);
  }
  for (const line of scene.lines) {
    const plain = strip(line.ja).trim();
    if (kana.test(removeQuotedJa(line.zh))) {
      errors.push(`E4 ${scene.id}/${line.id}: 中文里有未加「」的假名 → ${line.zh}`);
    }
    if (/\s/.test(strip(line.ja))) {
      errors.push(`E6 ${scene.id}/${line.id}: 日文正文含多余空格 → ${strip(line.ja)}`);
    }
    if (!/[。？！…]$/.test(plain)) {
      warnings.push(`W3 ${scene.id}/${line.id}: 句末缺少标点（。/？/！/…），可能影响 TTS 语调收束`);
    }
    if ((plain.match(/、/g) || []).length >= 4) {
      warnings.push(`W3 ${scene.id}/${line.id}: 单句逗号过多（≥4 处），可能导致 TTS 停顿破碎`);
    }
  }
  const texts = [
    { where: `${scene.id}/title`, ja: scene.title },
    ...scene.lines.map((line) => ({ where: `${scene.id}/${line.id}`, ja: line.ja })),
    ...(scene.jlpt
      ? [
          { where: `${scene.id}/jlpt.question`, ja: scene.jlpt.question },
          ...scene.jlpt.options.map((opt, idx) => ({ where: `${scene.id}/jlpt.options[${idx}]`, ja: opt })),
        ]
      : []),
  ];
  for (const { where, ja } of texts) {
    for (const match of ja.matchAll(/\{([^{}|]+)\|([^{}|]+)\}([ぁ-んー]*)/g)) {
      const [, surface, reading, following] = match;
      const expected = READING_RULES[surface];
      if (expected && reading !== expected) {
        errors.push(`E5 ${where}: ${surface} 应读 ${expected}，实际标注 ${reading}`);
      }
      for (const rule of OKURIGANA_RULES) {
        if (surface === rule.surface && rule.next.test(following) && reading !== rule.expected) {
          errors.push(`E5 ${where}: ${surface}${following.slice(0, 2)} 应读 ${rule.expected}，实际标注 ${reading}`);
        }
      }
    }
  }
}

// 会话套话：不算「承载具体信息」，跨场景重复允许（见 docs/corpus-review.md 第 4 节）
const STOCK = [
  'ありがとうございます', 'ありがとうございました', 'わかりました', 'お願いします',
  '助かりました', 'すみません', 'はい', 'いいえ', 'そうですか', 'なるほど',
  '気をつけます', 'では', 'じゃあ', 'どうぞ', 'かしこまりました',
];
const substantive = (text) => {
  let rest = squash(text);
  for (const token of STOCK) rest = rest.split(token).join('');
  return rest.replace(/[、。！？…\s]/g, '').length;
};

// W1
const lineIndex = new Map();
for (const scene of scenarios) {
  for (const line of scene.lines) {
    const key = squash(line.ja);
    if (substantive(line.ja) < 8) continue;
    if (lineIndex.has(key)) {
      warnings.push(`W1 实质重复台词：${lineIndex.get(key)} = ${scene.id}/${line.id}「${strip(line.ja)}」`);
    } else {
      lineIndex.set(key, `${scene.id}/${line.id}`);
    }
  }
}

// W2
const zhIndex = new Map();
for (const scene of scenarios) {
  for (const line of scene.lines) {
    const key = line.zh.trim();
    if (key.length < 6) continue;
    if (zhIndex.has(key) && zhIndex.get(key).ja !== line.ja) {
      warnings.push(`W2 中文相同、日文不同：${zhIndex.get(key).where} = ${scene.id}/${line.id}「${key}」`);
    } else {
      zhIndex.set(key, { where: `${scene.id}/${line.id}`, ja: line.ja });
    }
  }
}

for (const warning of warnings) console.warn(`⚠ ${warning}`);
for (const error of errors) console.error(`✗ ${error}`);
console.log(
  `语料巡检：${errors.length} 个错误，${warnings.length} 个警告（${scenarios.length} 个场景）`,
);
if (errors.length) process.exitCode = 1;
