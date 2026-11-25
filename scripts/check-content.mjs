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
  crypto.createHash('sha1').update(`${voice}|${stripFurigana(ja)}`).digest('hex').slice(0, 16);

const lessonAudioHash = (voice, style, script) =>
  crypto.createHash('sha1').update(`${voice}|${style}|${script}`).digest('hex').slice(0, 16);

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
  for (const match of text.matchAll(/\{([^{}|]+)\|([^{}|]+)\}/g)) {
    const base = match[1];
    const reading = match[2].trim();
    if (/[ぁ-んァ-ンヵ]/.test(base)) {
      errors.push(`${where}: 假名/送假名不应包含在注音花括号内 → ${match[0]}`);
    }
    const parts = reading.split(/[\s・]+/).filter(Boolean);
    if (parts.length > 1 && parts.length !== [...base].length) {
      errors.push(
        `${where}: 逐字注音段数（${parts.length}）与字数（${[...base].length}）不一致 → ${match[0]}`,
      );
    }
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

  if (scene.kind && !['dialogue', 'passage', 'jlpt'].includes(scene.kind)) {
    errors.push(`${where}: kind 必须是 dialogue、passage 或 jlpt`);
  }
  const isPassage = scene.kind === 'passage';
  const isJlpt = scene.kind === 'jlpt';
  const narratorOnly = scene.speakers.length === 1 && scene.speakers[0].id === 'narrator';
  if (narratorOnly && !isPassage && !isJlpt) {
    errors.push(`${where}: 单朗读者场景必须标记 kind: "passage"`);
  }
  if (isPassage && !narratorOnly) {
    errors.push(`${where}: 短文场景必须只有一个 narrator 说话人`);
  }

  if (isPassage) {
    if (scene.lines.length < 5 || scene.lines.length > 6) {
      errors.push(`${where}: 短文场景段数必须为 5–6 段（当前 ${scene.lines.length} 段）`);
    }
  } else if (isJlpt) {
    if (scene.lines.length < 4 || scene.lines.length > 12) {
      errors.push(`${where}: JLPT 听力句数必须为 4–12 句（当前 ${scene.lines.length} 句）`);
    }
    if (!scene.jlpt || !Array.isArray(scene.jlpt.options) || scene.jlpt.options.length < 3) {
      errors.push(`${where}: JLPT 听力必须提供 jlpt 题目与选项`);
    }
  } else {
    if (scene.lines.length < 5 || scene.lines.length > 8) {
      errors.push(`${where}: 对话场景句数必须为 5–8 句（当前 ${scene.lines.length} 句）`);
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

const glossaryPath = join(root, 'src', 'data', 'glossary.json');
if (!existsSync(glossaryPath)) {
  errors.push('缺少词汇释义表 src/data/glossary.json');
} else {
  const glossary = JSON.parse(readFileSync(glossaryPath, 'utf8'));
  const gEntries = glossary?.entries && typeof glossary.entries === 'object' ? glossary.entries : null;
  const gSpans = glossary?.spans && typeof glossary.spans === 'object' ? glossary.spans : null;
  if (!gEntries || !gSpans) {
    errors.push('glossary.json 必须包含 entries 和 spans 对象');
  } else {
    const gKeys = Object.keys(gEntries);
    if (gKeys.length < 500) {
      errors.push(`glossary.json 词条数量过少（${gKeys.length}）`);
    }
    let particleCount = 0;
    for (const gKey of gKeys) {
      const entry = gEntries[gKey];
      if (!entry || typeof entry.p !== 'string' || !entry.p.trim() || typeof entry.z !== 'string' || !entry.z.trim()) {
        errors.push(`glossary.json 词条格式不完整：${gKey}`);
      } else if (entry.p === '助') {
        particleCount += 1;
      }
    }
    if (particleCount === 0) {
      errors.push('glossary.json 缺少助词（p === "助"）词条');
    }
    for (const scene of Array.isArray(scenarios) ? scenarios : []) {
      const texts = [
        ...scene.lines.map((l) => ({ where: `${scene.id}.${l.id}`, ja: l.ja })),
        ...(scene.jlpt
          ? [
              { where: `${scene.id}.jlpt.question`, ja: scene.jlpt.question },
              ...scene.jlpt.options.map((opt, idx) => ({ where: `${scene.id}.jlpt.options[${idx}]`, ja: opt })),
            ]
          : []),
      ];
      for (const { where, ja } of texts) {
        const plain = stripFurigana(ja);
        const spanList = gSpans[plain];
        if (!Array.isArray(spanList) || spanList.length === 0) {
          errors.push(`glossary.json 缺少句子切分：${where}`);
          continue;
        }
        for (const [start, end, key] of spanList) {
          if (typeof start !== 'number' || typeof end !== 'number' || start < 0 || end <= start || end > plain.length) {
            errors.push(`glossary.json 词元索引越界：${where} [${start}, ${end}]`);
          }
          if (!Object.hasOwn(gEntries, key)) {
            errors.push(`glossary.json 词元键不存在：${where} -> ${key}`);
          }
        }
      }
    }
  }
}

for (const warning of warnings) console.warn(`⚠ ${warning}`);

// 检查老师精讲文件（src/data/lessons/*.json）与音频（public/audio-lessons/）
const lessonsDir = join(root, 'src', 'data', 'lessons');
const lessonAudioRoot = join(root, 'public', 'audio-lessons');
const lessonManifestPath = join(lessonAudioRoot, 'manifest.json');
const lessonManifest = existsSync(lessonManifestPath)
  ? JSON.parse(readFileSync(lessonManifestPath, 'utf8'))
  : {};
const VALID_LESSON_KINDS = new Set(['intro', 'walkthrough', 'culture', 'strategy', 'summary']);
let lessonCount = 0;
let lessonSectionCount = 0;
let lessonAudioCount = 0;

if (existsSync(lessonsDir)) {
  const lessonFiles = readdirSync(lessonsDir).filter((f) => f.endsWith('.json')).sort();
  const lessonBySceneId = new Map();
  for (const file of lessonFiles) {
    lessonCount += 1;
    const lessonWhere = `精讲 ${file}`;
    const lesson = JSON.parse(readFileSync(join(lessonsDir, file), 'utf8'));
    const expectedSceneId = file.replace(/\.json$/, '');
    if (lesson.sceneId !== expectedSceneId) {
      errors.push(`${lessonWhere}: sceneId (${lesson.sceneId}) 必须与文件名 ${expectedSceneId} 一致`);
    }
    const targetScene = scenarios.find((s) => s.id === lesson.sceneId);
    if (!targetScene) {
      errors.push(`${lessonWhere}: 找不到对应场景 ${lesson.sceneId}`);
    }
    lessonBySceneId.set(lesson.sceneId, lesson);
    if (!lesson.title?.trim()) errors.push(`${lessonWhere}: 缺少 title`);
    if (!lesson.subtitle?.trim()) errors.push(`${lessonWhere}: 缺少 subtitle`);
    if (!ALLOWED_VOICES.has(lesson.voice)) {
      errors.push(`${lessonWhere}: voice 无效（${lesson.voice ?? '未设置'}）`);
    }
    if (!lesson.style?.trim()) errors.push(`${lessonWhere}: 缺少 style`);
    if (!Array.isArray(lesson.sections) || lesson.sections.length === 0) {
      errors.push(`${lessonWhere}: 缺少 sections`);
      continue;
    }

    const secIds = new Set();
    const validLineIds = new Set((targetScene?.lines ?? []).map((l) => l.id));
    for (const sec of lesson.sections) {
      lessonSectionCount += 1;
      const secWhere = `${lessonWhere}.${sec.id ?? '(缺 id)'}`;
      if (!sec.id) errors.push(`${secWhere}: 缺少 id`);
      else if (secIds.has(sec.id)) errors.push(`${secWhere}: section id 重复`);
      else secIds.add(sec.id);

      if (!VALID_LESSON_KINDS.has(sec.kind)) {
        errors.push(`${secWhere}: kind 无效（${sec.kind}）`);
      }
      if (!sec.title?.trim()) errors.push(`${secWhere}: 缺少 title`);
      if (!sec.script?.trim()) errors.push(`${secWhere}: 缺少 script`);
      else if (/[{}|]/.test(sec.script)) {
        errors.push(`${secWhere}.script: 语音脚本不应包含 {漢字|かんじ} 标注括号`);
      }

      if (sec.lineIds !== undefined) {
        if (!Array.isArray(sec.lineIds)) {
          errors.push(`${secWhere}: lineIds 必须是数组`);
        } else {
          for (const lid of sec.lineIds) {
            if (!validLineIds.has(lid)) {
              errors.push(`${secWhere}: lineIds 引用了不存在的句子 ${lid}`);
            }
          }
        }
      }

      if (!Array.isArray(sec.paragraphs) || sec.paragraphs.length === 0) {
        errors.push(`${secWhere}: 缺少 paragraphs`);
      } else {
        sec.paragraphs.forEach((p, pIdx) => {
          checkMarkup(p, `${secWhere}.paragraphs[${pIdx}]`);
        });
      }

      if (sec.highlights !== undefined) {
        if (!Array.isArray(sec.highlights)) {
          errors.push(`${secWhere}: highlights 必须是数组`);
        } else {
          sec.highlights.forEach((h, hIdx) => {
            checkMarkup(h?.ja, `${secWhere}.highlights[${hIdx}].ja`);
            if (!h?.note?.trim()) {
              errors.push(`${secWhere}.highlights[${hIdx}]: 缺少 note`);
            }
          });
        }
      }

      const audioPath = join(lessonAudioRoot, lesson.sceneId, `${sec.id}.mp3`);
      if (!existsSync(audioPath)) {
        errors.push(`${secWhere}: 缺少讲解音频 public/audio-lessons/${lesson.sceneId}/${sec.id}.mp3`);
      } else if (!isValidMp3(audioPath)) {
        errors.push(`${secWhere}: 讲解音频损坏或过小 public/audio-lessons/${lesson.sceneId}/${sec.id}.mp3`);
      } else {
        lessonAudioCount += 1;
        const expectedHash = lessonAudioHash(lesson.voice ?? '', lesson.style ?? '', sec.script ?? '');
        if (lessonManifest[`${lesson.sceneId}/${sec.id}`] !== expectedHash) {
          errors.push(`${secWhere}: 讲解音频与脚本或声线哈希不一致，请运行 npm run lesson:tts 更新`);
        }
      }
    }
  }

  if (existsSync(lessonAudioRoot)) {
    for (const sceneDir of readdirSync(lessonAudioRoot, { withFileTypes: true })) {
      if (!sceneDir.isDirectory()) continue;
      const lesson = lessonBySceneId.get(sceneDir.name);
      for (const file of readdirSync(join(lessonAudioRoot, sceneDir.name))) {
        const secId = file.replace(/\.mp3$/, '');
        if (!lesson?.sections?.some((sec) => sec.id === secId)) {
          console.warn(`⚠ 未引用的讲解音频：audio-lessons/${sceneDir.name}/${file}`);
        }
      }
    }
  }
}

if (errors.length) {
  console.error(`\n内容检查失败（${errors.length} 项）：`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const lessonSummary = lessonCount
  ? ` / ${lessonCount} 份精讲（${lessonSectionCount} 节 / ${lessonAudioCount} 段讲解音频）`
  : '';
console.log(
  `内容检查通过：${scenarios.length} 个场景 / ${lineCount} 句 / ${audioCount} 段音频${lessonSummary}`,
);
