#!/usr/bin/env node
/**
 * 内容自检：场景结构、声线配置、假名标注、句子数、音频完整性与文本哈希校验。
 * npm run build 前自动执行（prebuild）。
 */
import crypto from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const audioRoot = join(root, 'public', 'audio');
const manifestPath = join(audioRoot, 'manifest.json');
const scenarios = JSON.parse(readFileSync(join(root, 'src', 'data', 'scenarios.json'), 'utf8'));
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};

const VALID_CATEGORIES = new Set([
  'work',
  'shopping',
  'medical',
  'food',
  'transport',
  'home',
  'admin',
  'study',
  'social',
  'travel',
  'service',
  'opinion',
]);
const ALLOWED_VOICES = new Set([
  'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir',
  'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe',
  'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina',
  'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
  'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird',
  'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat',
]);

const errors = [];
const warnings = [];
const markupRe = /\{[^{}|]+\|[^{}|]+\}/g;
const kanjiRe = /[\u4e00-\u9fff々]/;

const stripFurigana = (text) => text.replace(/\{([^{}|]+)\|([^{}|]+)\}/g, '$1');

const lineAudioHash = (voice, ja) =>
  crypto.createHash('sha1').update(`${voice}|${ja}`).digest('hex').slice(0, 16);

const isValidMp3 = (filePath) => {
  if (!existsSync(filePath)) return false;
  const buf = readFileSync(filePath);
  if (buf.length < 1024) return false;
  const hasId3 = buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33;
  const hasSync = buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0;
  return hasId3 || hasSync;
};

const checkMarkup = (text, where) => {
  if (typeof text !== 'string' || !text.trim()) {
    errors.push(`${where}: 内容为空`);
    return;
  }
  if (/[{}|]/.test(text.replace(markupRe, ''))) {
    errors.push(`${where}: 假名标注 {漢字|かんじ} 格式不完整`);
  }
};

const checkLineKanji = (text, where) => {
  const rest = text.replace(markupRe, '');
  const missing = [...rest].filter((char) => kanjiRe.test(char));
  if (missing.length) {
    errors.push(`${where}: 汉字缺假名 → ${missing.join('')}`);
  }
};

let lineCount = 0;
let audioCount = 0;

if (!Array.isArray(scenarios)) {
  errors.push('scenarios.json 必须是数组');
}

const sceneIds = new Set();

for (const scene of Array.isArray(scenarios) ? scenarios : []) {
  const where = `场景 ${scene.id ?? '(缺 id)'}`;
  if (scene.id) {
    if (sceneIds.has(scene.id)) errors.push(`${where}: 场景 id 重复`);
    sceneIds.add(scene.id);
  }
  for (const key of ['id', 'title', 'titleZh', 'category', 'emoji', 'accent', 'accentDark']) {
    if (!scene[key]) errors.push(`${where}: 缺少 ${key}`);
  }
  if (scene.category && !VALID_CATEGORIES.has(scene.category)) {
    errors.push(`${where}: category 无效（${scene.category}）`);
  }
  if (!Array.isArray(scene.speakers) || scene.speakers.length === 0) {
    errors.push(`${where}: 缺少 speakers`);
    continue;
  }
  if (!Array.isArray(scene.lines) || scene.lines.length === 0) {
    errors.push(`${where}: 缺少 lines`);
    continue;
  }
  checkMarkup(scene.title, `${where}.title`);
  checkLineKanji(scene.title, `${where}.title`);

  if (scene.kind && !['dialogue', 'passage'].includes(scene.kind)) {
    errors.push(`${where}: kind 必须是 dialogue 或 passage`);
  }
  const isPassage = scene.kind === 'passage';
  const narratorOnly = scene.speakers.length === 1 && scene.speakers[0].id === 'narrator';
  if (narratorOnly && !isPassage) {
    errors.push(`${where}: 单朗读者场景必须标记 kind: "passage"`);
  }
  if (isPassage && !narratorOnly) {
    errors.push(`${where}: 短文场景必须只有一个 narrator 说话人`);
  }

  if (isPassage) {
    if (scene.lines.length < 5 || scene.lines.length > 6) {
      errors.push(`${where}: 短文场景段数必须为 5–6 段（当前 ${scene.lines.length} 段）`);
    }
  } else {
    if (scene.lines.length < 5 || scene.lines.length > 6) {
      errors.push(`${where}: 对话场景句数必须为 5–6 句（当前 ${scene.lines.length} 句）`);
    }
    const selfSpeakers = scene.speakers.filter((s) => s.self);
    if (selfSpeakers.length !== 1) {
      errors.push(`${where}: 对话场景必须且只能有一个 self: true 说话人`);
    }
  }

  const speakerMap = new Map();
  for (const speaker of scene.speakers) {
    if (!speaker.id || !speaker.label) errors.push(`${where}: speaker 缺 id/label`);
    if (speakerMap.has(speaker.id)) errors.push(`${where}: speaker 重复 ${speaker.id}`);
    speakerMap.set(speaker.id, speaker);
    if (!ALLOWED_VOICES.has(speaker.voice)) {
      errors.push(
        `${where}: speaker ${speaker.id} 缺少有效音色 voice（可选：${[...ALLOWED_VOICES].join(', ')}）`,
      );
    }
  }
  if (scene.speakers.length === 2 && scene.speakers[0].voice === scene.speakers[1].voice) {
    errors.push(`${where}: 两个说话人不能使用相同音色 (${scene.speakers[0].voice})`);
  }

  const lineIds = new Set();
  for (const line of scene.lines) {
    lineCount += 1;
    const lineWhere = `${where}.${line.id ?? '(缺 id)'}`;
    if (!line.id) errors.push(`${lineWhere}: 缺少 id`);
    if (lineIds.has(line.id)) errors.push(`${lineWhere}: 句子 id 重复`);
    lineIds.add(line.id);
    const speaker = speakerMap.get(line.speaker);
    if (!speaker) errors.push(`${lineWhere}: speaker 不存在`);
    checkMarkup(line.ja, `${lineWhere}.ja`);
    checkLineKanji(line.ja ?? '', `${lineWhere}.ja`);
    if (typeof line.ja === 'string' && /\s/.test(stripFurigana(line.ja))) {
      errors.push(`${lineWhere}.ja: 日文正文不应包含人为分词空格`);
    }
    if (!line.zh) errors.push(`${lineWhere}: 缺少中文`);

    const audio = join(audioRoot, scene.id, `${line.id}.mp3`);
    if (!existsSync(audio)) {
      errors.push(`${lineWhere}: 缺少音频 public/audio/${scene.id}/${line.id}.mp3`);
    } else if (!isValidMp3(audio)) {
      errors.push(`${lineWhere}: 音频文件损坏或过小 public/audio/${scene.id}/${line.id}.mp3`);
    } else {
      audioCount += 1;
      const voice = speaker?.voice ?? '';
      const expectedHash = lineAudioHash(voice, line.ja ?? '');
      if (manifest[`${scene.id}/${line.id}`] !== expectedHash) {
        errors.push(`${lineWhere}: 音频与当前台词或声线哈希不一致，请运行 npm run tts 更新`);
      }
    }
  }
}

// 检查多余音频，避免场景删改后留下孤儿文件
if (existsSync(audioRoot)) {
  for (const sceneDir of readdirSync(audioRoot, { withFileTypes: true })) {
    if (!sceneDir.isDirectory()) continue;
    const scene = scenarios.find((item) => item.id === sceneDir.name);
    for (const file of readdirSync(join(audioRoot, sceneDir.name))) {
      const lineId = file.replace(/\.mp3$/, '');
      if (!scene?.lines?.some((line) => line.id === lineId)) {
        warnings.push(`未引用的音频：audio/${sceneDir.name}/${file}`);
      }
    }
  }
}

for (const key of Object.keys(manifest)) {
  const [sId, lId] = key.split('/');
  const scene = scenarios.find((item) => item.id === sId);
  if (!scene?.lines?.some((line) => line.id === lId)) {
    warnings.push(`manifest.json 存在未引用条目：${key}`);
  }
}

for (const warning of warnings) console.warn(`⚠ ${warning}`);
if (errors.length) {
  console.error(`\n内容检查失败（${errors.length} 项）：`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `内容检查通过：${scenarios.length} 个场景 / ${lineCount} 句 / ${audioCount} 段音频`,
);
