#!/usr/bin/env node
/**
 * 使用 Gemini Flash TTS 预生成每个场景每一句的 mp3，并维护 public/audio/manifest.json 哈希清单。
 *
 * 用法：
 *   npm run tts                               # 补齐缺失或台词/声线有变动的句子
 *   npm run tts:force                         # 全部重新生成（对话优先整场多角色合成，失败自动回退逐句）
 *   npm run tts:passages                      # 短文整篇重新生成并按停顿切段
 *   node scripts/generate-audio.mjs --only=konbini --force
 *   node scripts/generate-audio.mjs --line=konbini/l1 --force
 *   node scripts/generate-audio.mjs --per-line --force
 *
 * Key 只从本机环境读取（.env.local / .env / 环境变量），永远不会写进前端产物。
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const audioRoot = join(root, 'public', 'audio');
const manifestPath = join(audioRoot, 'manifest.json');

const force = process.argv.includes('--force');
const perLineMode = process.argv.includes('--per-line');
const ttsKanaMode = process.argv.includes('--tts-kana');
const passagesMode = process.argv.includes('--passages');

const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice('--only='.length) : null;
const lineArg = process.argv.find((a) => a.startsWith('--line='));
const onlyLine = lineArg ? lineArg.slice('--line='.length) : null;
if (onlyLine && !/^[^/]+\/[^/]+$/.test(onlyLine)) {
  throw new Error('--line 格式应为 场景ID/句子ID，例如 --line=konbini/l1');
}

const skipArg = process.argv.find((a) => a.startsWith('--skip-list='));
const skipList = skipArg
  ? new Set(readFileSync(join(root, skipArg.slice('--skip-list='.length)), 'utf8').split(/\s+/).filter(Boolean))
  : null;
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Math.max(1, Number(limitArg.slice('--limit='.length)) || 1) : null;
const delayArg = process.argv.find((a) => a.startsWith('--delay='));
const delay = delayArg ? Math.max(0, Number(delayArg.slice('--delay='.length)) || 0) : 0;
const concurrencyArg = process.argv.find((a) => a.startsWith('--concurrency='));
const concurrency = concurrencyArg
  ? Math.max(1, Math.min(4, Number(concurrencyArg.slice('--concurrency='.length)) || 1))
  : 2;

for (const file of ['.env.local', '.env']) {
  const envPath = join(root, file);
  if (existsSync(envPath)) {
    try {
      process.loadEnvFile(envPath);
    } catch {
      // 老版本 Node 或格式问题：忽略，继续用现有环境变量。
    }
  }
}

const geminiKeys = [...new Map(
  Object.entries(process.env)
    .filter(([name, value]) => /^GEMINI_API_KEY\d*$/.test(name) && value?.trim())
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([name, value]) => [value.trim(), name]),
).entries()].map(([key, name]) => ({ name, key, disabled: false, cooldownUntil: 0 }));

const MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-tts';
const ALLOWED_VOICES = new Set([
  'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir',
  'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe',
  'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina',
  'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
  'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird',
  'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat',
]);

// 数量词、日期、多音词及熟字训：直接展开为 {漢字|かんじ} 里的读音，避免 TTS 按常见音误读。
const FORCE_READING_SURFACES = new Set([
  '今日',
  '昨日',
  '明日',
  '今朝',
  '今夜',
  '今年',
  '去年',
  '来年',
  '一昨日',
  '明後日',
  '毎日',
  '毎週',
  '毎月',
  '毎年',
  '一日',
  '二日',
  '三日',
  '四日',
  '五日',
  '六日',
  '七日',
  '八日',
  '九日',
  '十日',
  '十一日',
  '十二日',
  '十三日',
  '十四日',
  '十五日',
  '十六日',
  '十七日',
  '十八日',
  '十九日',
  '二十日',
  '二十一日',
  '二十二日',
  '二十三日',
  '二十四日',
  '二十五日',
  '二十六日',
  '二十七日',
  '二十八日',
  '二十九日',
  '三十日',
  '三十一日',
  '一人',
  '二人',
  '三人',
  '四人',
  '二十歳',
  '日本',
  '私',
  '僕',
  '彼',
  '彼女',
  '大人',
  '人気',
  '上手',
  '下手',
  '田舎',
  '土産',
  '風邪',
  '時計',
  '部屋',
  '友達',
  '冗談',
  '真面目',
  '海老',
  '眼鏡',
  '角',
  '端',
  '頃',
  '方',
  '間',
  '中',
  '生ビール',
  '辛',
  '空',
  '開',
  '閉',
  '行',
  '行き',
  '行先',
  '通',
  '別',
  '重',
  '軽',
  '早',
  '速',
]);

// 首尾静音修剪 + 轻量门限抑制呼吸声 + 句尾自然余量 + -16 LUFS 响度统一
function buildFinalLineAf(padDur = 0.06) {
  return [
    'highpass=f=95',
    'agate=threshold=0.022:ratio=4:attack=10:release=80',
    'silenceremove=start_periods=1:start_duration=0.04:start_threshold=-50dB:detection=peak',
    'areverse',
    'silenceremove=start_periods=1:start_duration=0.04:start_threshold=-50dB:detection=peak',
    'areverse',
    'loudnorm=I=-16:TP=-1.5:LRA=11',
    `apad=pad_dur=${padDur}`,
  ].join(',');
}

const COUNTER_OR_POLYPHONIC_RE =
  /^([0-9０-９一二三四五六七八九十百千万何幾]+[ヶか]?[階本枚円時分秒日月年人歳才番回個羽匹頭足通冊杯名台軒件週間度着]+|[階本枚円時分秒日月年人歳番回個羽匹頭足通])$/;

function stripFurigana(text) {
  return text.replace(/\{([^{}|]+)\|([^{}|]+)\}/g, '$1').replace(/\s+/g, '');
}

/**
 * 保留 {漢字|かんじ} 的语境读音控制：
 * - --tts-kana 时全部展开为假名
 * - 默认情况下将易错多音词、日期与数量词展开为标注读音，其余保留自然汉字书写并去掉多余空格
 */
function toTtsScript(text) {
  const converted = text.replace(/\{([^{}|]+)\|([^{}|]+)\}/g, (_match, surface, reading) => {
    if (ttsKanaMode) return reading;
    if (FORCE_READING_SURFACES.has(surface) || COUNTER_OR_POLYPHONIC_RE.test(surface)) {
      return reading;
    }
    return surface;
  });
  return converted.replace(/\s+/g, '');
}

function lineAudioHash(voice, ja) {
  return crypto.createHash('sha1').update(`${voice}|${ja}`).digest('hex').slice(0, 16);
}

function isValidMp3(filePath) {
  if (!existsSync(filePath)) return false;
  const buf = readFileSync(filePath);
  if (buf.length < 1024) return false;
  const hasId3 = buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33;
  const hasSync = buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0;
  return hasId3 || hasSync;
}

function voiceFor(scene, speaker) {
  if (!speaker) {
    throw new Error(`${scene.id}: 找不到说话人`);
  }
  if (!ALLOWED_VOICES.has(speaker.voice)) {
    throw new Error(`${scene.id}: speaker ${speaker.id} 缺少有效音色 voice（当前：${speaker.voice ?? '未设置'}）`);
  }
  return speaker.voice;
}

function styleFor(speaker, line) {
  if (line?.style) return line.style;
  if (speaker?.style) return speaker.style;
  return speaker?.self
    ? 'calm, steady, polite, natural everyday Japanese conversation'
    : 'friendly, clear, steady, natural everyday Japanese conversation';
}

async function loadManifest() {
  if (!existsSync(manifestPath)) return {};
  return JSON.parse(await readFile(manifestPath, 'utf8'));
}

async function saveManifest(manifest, scenarios) {
  const validKeys = new Set();
  for (const scene of scenarios) {
    for (const line of scene.lines) {
      validKeys.add(`${scene.id}/${line.id}`);
    }
  }
  const sorted = {};
  for (const key of Object.keys(manifest).sort()) {
    if (validKeys.has(key) && manifest[key]) {
      sorted[key] = manifest[key];
    }
  }
  if (Object.keys(sorted).length === 0) {
    if (existsSync(manifestPath)) await unlink(manifestPath).catch(() => {});
    return;
  }
  await mkdir(audioRoot, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
}

function run(cmd, args, input) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolvePromise(stdout);
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-400)}`));
    });
    if (input) child.stdin.end(input);
  });
}

function runCapture(cmd, args, input) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => resolvePromise({ code, stdout, stderr }));
    if (input) child.stdin.end(input);
  });
}

async function hasCommand(cmd) {
  try {
    await run('which', [cmd]);
    return true;
  } catch {
    return false;
  }
}

function pcmToWav(pcm, sampleRate) {
  const channels = 1;
  const bits = 16;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE((sampleRate * channels * bits) / 8, 28);
  header.writeUInt16LE((channels * bits) / 8, 32);
  header.writeUInt16LE(bits, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function encodeMasteredMp3({ inputPath, inputBuffer, start, length, outFile, padDur = 0.06 }) {
  const args = ['-y', '-loglevel', 'error'];
  if (inputPath) {
    if (typeof start === 'number' && typeof length === 'number') {
      args.push('-ss', start.toFixed(3), '-t', length.toFixed(3));
    }
    args.push('-i', inputPath);
  } else {
    args.push('-f', 'wav', '-i', 'pipe:0');
  }
  args.push(
    '-af', buildFinalLineAf(padDur),
    '-ac', '1',
    '-ar', '24000',
    '-codec:a', 'libmp3lame',
    '-q:a', '5',
    outFile,
  );
  await run('ffmpeg', args, inputBuffer);
}

async function synthGeminiRequest(input, speechConfig, outFile, keyState, { rawWav = false } = {}) {
  const parts = Array.isArray(input) ? input : [{ text: input }];
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig,
    },
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': keyState.key,
      },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Gemini TTS ${response.status}: ${detail}`);
  }

  const payload = await response.json();
  const part = payload?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) throw new Error('Gemini TTS 返回里没有音频数据');

  const mime = part.inlineData.mimeType || 'audio/L16;rate=24000';
  const pcm = Buffer.from(part.inlineData.data, 'base64');
  if (!/L16|pcm/i.test(mime)) {
    const raw = join(audioRoot, `.__tmp-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
    await writeFile(raw, pcm);
    try {
      if (rawWav) {
        await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-ac', '1', '-ar', '24000', '-f', 'wav', outFile]);
      } else {
        await encodeMasteredMp3({ inputPath: raw, outFile });
      }
    } finally {
      await unlink(raw).catch(() => {});
    }
    return;
  }

  const rate = Number(/rate=(\d+)/.exec(mime)?.[1] ?? 24000);
  const wav = pcmToWav(pcm, rate);
  if (rawWav) {
    await writeFile(outFile, wav);
    return;
  }
  await encodeMasteredMp3({ inputBuffer: wav, outFile });
}

let keyCursor = 0;

async function synthGeminiWithKeys(text, speechConfig, outFile, options = {}) {
  if (!geminiKeys.length) {
    throw new Error('缺少 GEMINI_API_KEY。请在 .env.local 中配置后重试。');
  }
  let lastError;
  for (let attempt = 0; attempt < geminiKeys.length * 2; attempt += 1) {
    const now = Date.now();
    const available = geminiKeys.filter((k) => !k.disabled && k.cooldownUntil <= now);
    if (!available.length) {
      const wait = Math.max(1000, Math.min(...geminiKeys.map((k) => k.cooldownUntil - now).filter((n) => n > 0)));
      await new Promise((resolvePromise) => setTimeout(resolvePromise, Number.isFinite(wait) ? wait : 1500));
      continue;
    }
    const keyState = available[keyCursor % available.length];
    keyCursor += 1;
    try {
      await synthGeminiRequest(text, speechConfig, outFile, keyState, options);
      return;
    } catch (error) {
      lastError = error;
      const message = String(error?.message ?? '');
      if (/per.day|per_day|daily/i.test(message)) {
        keyState.disabled = true;
        continue;
      }
      if (/429|rate|quota|overload|500|502|503|504/i.test(message)) {
        keyState.cooldownUntil = Date.now() + 2500;
        continue;
      }
      throw error;
    }
  }
  throw lastError ?? new Error('所有 Gemini key 都不可用');
}

function singleVoiceConfig(voiceName) {
  return { voiceConfig: { prebuiltVoiceConfig: { voiceName } } };
}

function multiVoiceConfig(speakerConfigs) {
  return {
    multiSpeakerVoiceConfig: {
      speakerVoiceConfigs: speakerConfigs.map(({ tag, voice }) => ({
        speaker: tag,
        voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
      })),
    },
  };
}

function parseSilences(stderr, duration) {
  const starts = [...stderr.matchAll(/silence_start:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...stderr.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  const result = [];
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i];
    const end = ends[i] ?? duration;
    const dur = end - start;
    if (dur >= 0.18 && start > 0.35 && end < duration - 0.35) {
      result.push({ start, end, dur, mid: (start + end) / 2 });
    }
  }
  return result;
}

function pickBoundaries(silences, duration, lineTexts) {
  const count = lineTexts.length;
  const m = count - 1;
  if (m < 1 || silences.length < m) return null;
  const lengths = lineTexts.map((text) => stripFurigana(text).length);
  const totalChars = lengths.reduce((sum, n) => sum + n, 0);
  if (!totalChars) return null;

  const expectedList = [];
  let cumulative = 0;
  for (let k = 0; k < m; k += 1) {
    cumulative += lengths[k];
    expectedList.push(duration * (cumulative / totalChars));
  }

  // DP 选择 m 个单调递增的静音切分点：优先选跨轮次的 <long pause> 长静音，同时兼顾字数占比位置
  const n = silences.length;
  const dp = Array.from({ length: m }, () => Array(n).fill(Infinity));
  const parent = Array.from({ length: m }, () => Array(n).fill(-1));

  const score = (silence, expected) => {
    const dist = Math.abs(silence.mid - expected) / duration;
    if (dist > 0.25) return Infinity;
    return dist - 1.5 * Math.min(silence.dur, 2.0);
  };

  for (let j = 0; j < n; j += 1) {
    if (silences[j].mid <= 0.45 || silences[j].mid >= duration - 0.45) continue;
    dp[0][j] = score(silences[j], expectedList[0]);
  }

  for (let k = 1; k < m; k += 1) {
    for (let j = k; j < n; j += 1) {
      const sCost = score(silences[j], expectedList[k]);
      if (!Number.isFinite(sCost)) continue;
      for (let prev = k - 1; prev < j; prev += 1) {
        if (!Number.isFinite(dp[k - 1][prev])) continue;
        if (silences[j].mid - silences[prev].mid < 0.45) continue;
        const total = dp[k - 1][prev] + sCost;
        if (total < dp[k][j]) {
          dp[k][j] = total;
          parent[k][j] = prev;
        }
      }
    }
  }

  let bestLast = -1;
  let bestTotal = Infinity;
  for (let j = m - 1; j < n; j += 1) {
    if (dp[m - 1][j] < bestTotal) {
      bestTotal = dp[m - 1][j];
      bestLast = j;
    }
  }
  if (bestLast < 0 || !Number.isFinite(bestTotal)) return null;

  const boundaries = Array(m);
  let cur = bestLast;
  for (let k = m - 1; k >= 0; k -= 1) {
    boundaries[k] = silences[cur].mid;
    cur = parent[k][cur];
  }
  return boundaries;
}

const SILENCE_CANDIDATES = [
  'silencedetect=noise=-36dB:d=0.18',
  'silencedetect=noise=-32dB:d=0.16',
  'silencedetect=noise=-40dB:d=0.22',
];

async function detectBoundariesWithGemini(fullFile, scene, duration) {
  if (!geminiKeys.length) return null;
  const wavBase64 = (await readFile(fullFile)).toString('base64');
  const linesDesc = scene.lines
    .map((line, i) => `${i + 1}. [${line.speaker}] ${stripFurigana(line.ja)}`)
    .join('\n');
  const prompt = [
    `Listen carefully to this ${duration.toFixed(2)}s Japanese dialogue audio containing ${scene.lines.length} lines:`,
    linesDesc,
    '',
    `Return ONLY a JSON object {"boundaries": [t1, t2, ...]} with exactly ${scene.lines.length - 1} timestamps in seconds (numbers, e.g. 4.85).`,
    `Each timestamp t_i must be the exact moment AFTER line i finishes and BEFORE line i+1 starts (even if the gap between speakers is very short).`,
    `Do NOT cut inside a line (e.g. do not include the start of line i+1 like "おはようございます" or "そうなんですね" or "いいですね" inside line i).`,
  ].join('\n');

  for (const keyState of geminiKeys) {
    if (keyState.disabled) continue;
    try {
      const response = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': keyState.key,
          },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  { inlineData: { mimeType: 'audio/wav', data: wavBase64 } },
                  { text: prompt },
                ],
              },
            ],
            generationConfig: {
              temperature: 0,
              responseMimeType: 'application/json',
            },
          }),
        },
      );
      if (!response.ok) continue;
      const payload = await response.json();
      const rawText = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) continue;
      const parsed = JSON.parse(rawText);
      const boundaries = parsed?.boundaries;
      if (!Array.isArray(boundaries) || boundaries.length !== scene.lines.length - 1) continue;
      const nums = boundaries.map(Number);
      const valid = nums.every(
        (t, idx) =>
          Number.isFinite(t) &&
          t > 0.35 &&
          t < duration - 0.35 &&
          (idx === 0 || t - nums[idx - 1] >= 0.35),
      );
      if (valid) return nums;
    } catch {
      // try next key
    }
  }
  return null;
}

async function splitAudioByLines(fullFile, scene, workDir, duration) {
  let boundaries = null;
  let bestSilenceCount = 0;

  const allSilences = [];
  for (const filter of SILENCE_CANDIDATES) {
    const result = await runCapture('ffmpeg', [
      '-hide_banner',
      '-i', fullFile,
      '-af', filter,
      '-f', 'null',
      '-',
    ]);
    const silences = parseSilences(result.stderr, duration);
    if (silences.length > bestSilenceCount) bestSilenceCount = silences.length;
    allSilences.push(silences);
  }

  const aiBoundaries = await detectBoundariesWithGemini(fullFile, scene, duration);
  if (aiBoundaries) {
    const baseSilences = allSilences[1]?.length ? allSilences[1] : allSilences[0] ?? [];
    boundaries = aiBoundaries.map((t, idx) => {
      const prev = idx > 0 ? aiBoundaries[idx - 1] : 0;
      const next = idx < aiBoundaries.length - 1 ? aiBoundaries[idx + 1] : duration;
      let bestMid = t;
      let bestDist = 0.08;
      for (const s of baseSilences) {
        if (s.dur < 0.22 || s.mid <= prev + 0.35 || s.mid >= next - 0.35) continue;
        const d = Math.abs(s.mid - t);
        if (d < bestDist) {
          bestDist = d;
          bestMid = s.mid;
        }
      }
      return bestMid;
    });
  }

  if (!boundaries) {
    for (const silences of allSilences) {
      const found = pickBoundaries(silences, duration, scene.lines.map((line) => line.ja));
      if (found) {
        boundaries = found;
        bestSilenceCount = silences.length;
        break;
      }
    }
  }

  if (!boundaries) {
    return {
      ok: false,
      silences: bestSilenceCount,
      reason: `停顿切分不足（${bestSilenceCount} 处）`,
    };
  }

  const points = [0, ...boundaries, duration];
  const tempFiles = [];
  let committed = false;
  try {
    for (let i = 0; i < scene.lines.length; i += 1) {
      const start = points[i];
      const length = points[i + 1] - start;
      if (length < 0.35) {
        return {
          ok: false,
          silences: bestSilenceCount,
          reason: `第 ${i + 1} 句原始片段过短 (${length.toFixed(2)}s)`,
        };
      }
      const temp = join(workDir, `.${scene.lines[i].id}.new.mp3`);
      tempFiles.push(temp);
      const padDur = scene.kind === 'passage' ? (i < scene.lines.length - 1 ? 0.55 : 0.15) : 0.06;
      await encodeMasteredMp3({ inputPath: fullFile, start, length, outFile: temp, padDur });
      if (!isValidMp3(temp)) {
        return {
          ok: false,
          silences: bestSilenceCount,
          reason: `第 ${i + 1} 句编码无效`,
        };
      }
      const segDuration = await probeDuration(temp);
      const charLen = stripFurigana(scene.lines[i].ja).length;
      const minDur = Math.max(0.35, charLen * 0.05);
      const maxDur = Math.max(2.8, charLen * 0.45 + 1.5);
      if (segDuration < minDur || segDuration > maxDur) {
        return {
          ok: false,
          silences: bestSilenceCount,
          reason: `第 ${i + 1} 句时长异常 (${segDuration.toFixed(2)}s / ${charLen}字)`,
        };
      }
    }
    for (let i = 0; i < scene.lines.length; i += 1) {
      await rename(tempFiles[i], join(workDir, `${scene.lines[i].id}.mp3`));
    }
    committed = true;
    return { ok: true, silences: bestSilenceCount };
  } finally {
    if (!committed) {
      for (const file of tempFiles) await unlink(file).catch(() => {});
    }
  }
}

async function probeDuration(file) {
  const probe = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file,
  ]);
  const duration = Number(probe.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`无法读取音频时长：${file}`);
  }
  return duration;
}

function isLineFresh(scene, line, manifest) {
  const speaker = scene.speakers.find((s) => s.id === line.speaker);
  const voice = voiceFor(scene, speaker);
  const outFile = join(audioRoot, scene.id, `${line.id}.mp3`);
  const key = `${scene.id}/${line.id}`;
  return isValidMp3(outFile) && manifest[key] === lineAudioHash(voice, line.ja);
}

function recordSceneHashes(scene, manifest) {
  for (const line of scene.lines) {
    const speaker = scene.speakers.find((s) => s.id === line.speaker);
    const voice = voiceFor(scene, speaker);
    manifest[`${scene.id}/${line.id}`] = lineAudioHash(voice, line.ja);
  }
}

async function generatePassages(scenarios, manifest) {
  const targets = scenarios.filter((scene) => scene.kind === 'passage' && (!only || scene.id === only));
  if (!targets.length) {
    console.log('没有匹配的短文场景。');
    return;
  }
  const pending = targets.filter(
    (scene) => force || !scene.lines.every((line) => isLineFresh(scene, line, manifest)),
  );
  if (!pending.length) {
    console.log('短文音频与哈希均已是最新，跳过。需要重生成请加 --force。');
    return;
  }
  if (!geminiKeys.length) {
    throw new Error('缺少 GEMINI_API_KEY。请在 .env.local 中配置后再生成音频。');
  }

  let done = 0;
  for (const scene of pending) {
    const dir = join(audioRoot, scene.id);
    await mkdir(dir, { recursive: true });
    const speaker = scene.speakers[0];
    const voice = voiceFor(scene, speaker);
    const fullText = scene.lines.map((line) => toTtsScript(line.ja)).join('\n\n');
    const parts = [{ text: fullText, speech_metadata: { style: styleFor(speaker, null) } }];
    const fullFile = join(dir, '.__full.wav');
    console.log(`生成短文 ${scene.id}（${scene.lines.length} 段，一次请求）…`);
    let split;
    try {
      await synthGeminiWithKeys(parts, singleVoiceConfig(voice), fullFile, { rawWav: true });
      const duration = await probeDuration(fullFile);
      split = await splitAudioByLines(fullFile, scene, dir, duration);
    } finally {
      await unlink(fullFile).catch(() => {});
    }
    if (!split.ok) {
      throw new Error(`${scene.id}: ${split.reason ?? `没找到足够的段间停顿（检测到 ${split.silences} 个）`}`);
    }
    recordSceneHashes(scene, manifest);
    await saveManifest(manifest, scenarios);
    done += 1;
    console.log(`  ✓ ${scene.id} 已切成 ${scene.lines.length} 段`);
    if (delay) await new Promise((resolvePromise) => setTimeout(resolvePromise, delay));
  }
  console.log(`短文整篇生成完成：${done}/${pending.length}`);
}

async function tryWholeDialogueScene(scene, manifest, scenarios) {
  if (scene.speakers.length !== 2) return false;
  const dir = join(audioRoot, scene.id);
  await mkdir(dir, { recursive: true });

  const speakerTags = new Map();
  const speakerConfigs = scene.speakers.map((speaker, idx) => {
    const tag = `Speaker${idx + 1}`;
    speakerTags.set(speaker.id, tag);
    return { tag, voice: voiceFor(scene, speaker) };
  });

  const parts = scene.lines.map((line, idx) => {
    const speaker = scene.speakers.find((s) => s.id === line.speaker);
    const script = toTtsScript(line.ja);
    return {
      text: idx < scene.lines.length - 1 ? `${script} <short pause>` : script,
      speech_metadata: {
        speaker: speakerTags.get(line.speaker),
        style: styleFor(speaker, line),
      },
    };
  });

  const fullFile = join(dir, '.__dialogue.wav');
  try {
    console.log(`整场合成对话 ${scene.id}（${scene.lines.length} 句，多角色一次请求）…`);
    await synthGeminiWithKeys(parts, multiVoiceConfig(speakerConfigs), fullFile, { rawWav: true });
    const duration = await probeDuration(fullFile);
    const split = await splitAudioByLines(fullFile, scene, dir, duration);
    if (!split.ok) {
      console.warn(`  ⚠ ${scene.id}: ${split.reason ?? `停顿切分不足（${split.silences} 处）`}，回退逐句合成`);
      return false;
    }
    recordSceneHashes(scene, manifest);
    await saveManifest(manifest, scenarios);
    console.log(`  ✓ ${scene.id} 整场多角色合成并切分完成`);
    return true;
  } catch (error) {
    console.warn(`  ⚠ ${scene.id}: 整场多角色合成失败（${error.message}），回退逐句合成`);
    return false;
  } finally {
    await unlink(fullFile).catch(() => {});
  }
}

async function generateLineJobs(jobs, manifest, scenarios) {
  if (!jobs.length) return;
  let done = 0;
  const failures = [];
  const queue = [...jobs];

  async function worker() {
    while (queue.length) {
      const job = queue.shift();
      if (!job) return;
      await mkdir(job.dir, { recursive: true });
      try {
        await synthGeminiWithKeys(
          [{ text: job.text, speech_metadata: { style: job.style } }],
          singleVoiceConfig(job.voice),
          job.outFile,
        );
        manifest[`${job.scene}/${job.line}`] = job.hash;
        done += 1;
        process.stdout.write(`\r  ${done}/${jobs.length}  ${job.scene}/${job.line}      `);
      } catch (error) {
        failures.push({ ...job, error });
      }
      if (delay) await new Promise((resolvePromise) => setTimeout(resolvePromise, delay));
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  process.stdout.write('\n');
  await saveManifest(manifest, scenarios);

  if (failures.length) {
    console.error(`\n有 ${failures.length} 句失败：`);
    for (const failure of failures) {
      console.error(`- ${failure.scene}/${failure.line}: ${failure.error.message}`);
    }
    process.exitCode = 1;
  } else {
    console.log('逐句音频生成完成。');
  }
}

async function main() {
  const scenarios = JSON.parse(await readFile(join(root, 'src', 'data', 'scenarios.json'), 'utf8'));
  const manifest = await loadManifest();

  if (passagesMode) {
    if (!(await hasCommand('ffmpeg')) || !(await hasCommand('ffprobe'))) {
      throw new Error('短文整篇切分需要本机安装 ffmpeg 和 ffprobe。');
    }
    console.log(`TTS: Gemini (${MODEL}) · ${geminiKeys.length} 个 key · 短文整篇模式`);
    await generatePassages(scenarios, manifest);
    await saveManifest(manifest, scenarios);
    return;
  }

  const dialogueTargets = scenarios.filter(
    (scene) => (perLineMode && only ? scene.id === only : scene.kind !== 'passage' && (!only || scene.id === only)),
  );

  // 决定哪些对话场景可以走整场多角色合成，哪些走逐句补齐/回退
  const fallbackScenes = [];
  const wholeScenes = [];

  for (const scene of dialogueTargets) {
    const staleLines = scene.lines.filter((line) => {
      if (onlyLine && onlyLine !== `${scene.id}/${line.id}`) return false;
      if (skipList?.has(`${scene.id}/${line.id}`)) return false;
      return force || !isLineFresh(scene, line, manifest);
    });
    if (!staleLines.length) continue;

    const canWholeScene =
      !perLineMode &&
      !onlyLine &&
      !skipList &&
      !limit &&
      scene.speakers.length === 2;

    if (canWholeScene) {
      wholeScenes.push(scene);
    } else {
      fallbackScenes.push({ scene, lines: staleLines });
    }
  }

  if (!wholeScenes.length && !fallbackScenes.length) {
    await saveManifest(manifest, scenarios);
    console.log('所有音频与哈希均已是最新，跳过。需要重生成请加 --force。');
    return;
  }

  if (!geminiKeys.length) {
    throw new Error('缺少 GEMINI_API_KEY。请在 .env.local 中配置后再生成音频。');
  }
  if (!(await hasCommand('ffmpeg')) || !(await hasCommand('ffprobe'))) {
    throw new Error('Gemini TTS 需要本机安装 ffmpeg 和 ffprobe 才能转码与切分 mp3。');
  }
  console.log(`TTS: Gemini (${MODEL}) · ${geminiKeys.length} 个 key`);

  for (const scene of wholeScenes) {
    const ok = await tryWholeDialogueScene(scene, manifest, scenarios);
    if (!ok) {
      fallbackScenes.push({ scene, lines: scene.lines });
    } else if (delay) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, delay));
    }
  }

  const jobs = [];
  for (const { scene, lines } of fallbackScenes) {
    const dir = join(audioRoot, scene.id);
    for (const line of lines) {
      const speaker = scene.speakers.find((s) => s.id === line.speaker);
      const voice = voiceFor(scene, speaker);
      jobs.push({
        scene: scene.id,
        line: line.id,
        text: toTtsScript(line.ja),
        voice,
        style: styleFor(speaker, line),
        hash: lineAudioHash(voice, line.ja),
        dir,
        outFile: join(dir, `${line.id}.mp3`),
      });
    }
  }

  if (limit && jobs.length > limit) jobs.splice(limit);
  if (jobs.length) {
    console.log(`待逐句生成 ${jobs.length} 句…` + (limit ? `（本次上限 ${limit} 句）` : ''));
    await generateLineJobs(jobs, manifest, scenarios);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
