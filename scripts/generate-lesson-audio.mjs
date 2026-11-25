#!/usr/bin/env node
/**
 * 使用 Gemini Flash TTS 预生成老师精讲音频（public/audio-lessons/<场景>/<章节>.mp3），
 * 并维护 public/audio-lessons/manifest.json 哈希清单。
 *
 * 用法：
 *   npm run lesson:tts
 *   node scripts/generate-lesson-audio.mjs --only=izakaya-ordering-allergy
 *   node scripts/generate-lesson-audio.mjs --section=izakaya-ordering-allergy/s1 --force
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lessonsDir = join(root, 'src', 'data', 'lessons');
const audioRoot = join(root, 'public', 'audio-lessons');
const manifestPath = join(audioRoot, 'manifest.json');

const force = process.argv.includes('--force');
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice('--only='.length) : null;
const sectionArg = process.argv.find((a) => a.startsWith('--section='));
const onlySection = sectionArg ? sectionArg.slice('--section='.length) : null;
if (onlySection && !/^[^/]+\/[^/]+$/.test(onlySection)) {
  throw new Error('--section 格式应为 场景ID/章节ID，例如 --section=izakaya-ordering-allergy/s1');
}

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
      // 忽略老版本 Node 或格式问题
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

function lessonAudioHash(voice, style, script) {
  return crypto.createHash('sha1').update(`${voice}|${style}|${script}`).digest('hex').slice(0, 16);
}

function isValidMp3(filePath) {
  if (!existsSync(filePath)) return false;
  const buf = readFileSync(filePath);
  if (buf.length < 1024) return false;
  const hasId3 = buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33;
  const hasSync = buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0;
  return hasId3 || hasSync;
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

function buildLessonAf() {
  return [
    'highpass=f=85',
    'silenceremove=start_periods=1:start_duration=0.06:start_threshold=-58dB:detection=peak',
    'loudnorm=I=-16:TP=-1.5:LRA=11',
    'apad=pad_dur=0.22',
  ].join(',');
}

async function encodeMasteredMp3({ inputPath, inputBuffer, outFile }) {
  const args = ['-y', '-loglevel', 'error'];
  if (inputPath) {
    args.push('-i', inputPath);
  } else {
    args.push('-f', 'wav', '-i', 'pipe:0');
  }
  args.push(
    '-af', buildLessonAf(),
    '-ac', '1',
    '-ar', '24000',
    '-codec:a', 'libmp3lame',
    '-q:a', '5',
    outFile,
  );
  await run('ffmpeg', args, inputBuffer);
}

async function synthGeminiRequest(script, style, voice, outFile, keyState) {
  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: script, speech_metadata: { style } }],
      },
    ],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
      },
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
      signal: AbortSignal.timeout(90000),
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
      await encodeMasteredMp3({ inputPath: raw, outFile });
    } finally {
      await unlink(raw).catch(() => {});
    }
    return;
  }

  const rate = Number(/rate=(\d+)/.exec(mime)?.[1] ?? 24000);
  const wav = pcmToWav(pcm, rate);
  await encodeMasteredMp3({ inputBuffer: wav, outFile });
}

let keyCursor = 0;

async function synthWithKeys(script, style, voice, outFile) {
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
      await synthGeminiRequest(script, style, voice, outFile, keyState);
      return;
    } catch (error) {
      lastError = error;
      const message = String(error?.message ?? '');
      if (/per.day|per_day|daily/i.test(message)) {
        keyState.disabled = true;
        continue;
      }
      if (/429|rate|quota|overload|500|502|503|504|timeout|timed out|abort|fetch failed/i.test(message) || error?.name === 'TimeoutError') {
        keyState.cooldownUntil = Date.now() + 2500;
        continue;
      }
      throw error;
    }
  }
  throw lastError ?? new Error('所有 Gemini key 都不可用');
}

async function loadLessons() {
  if (!existsSync(lessonsDir)) return [];
  const files = (await readdir(lessonsDir)).filter((name) => name.endsWith('.json')).sort();
  const list = [];
  for (const file of files) {
    const data = JSON.parse(await readFile(join(lessonsDir, file), 'utf8'));
    list.push(data);
  }
  return list;
}

async function loadManifest() {
  if (!existsSync(manifestPath)) return {};
  return JSON.parse(await readFile(manifestPath, 'utf8'));
}

async function saveManifest(manifest, lessons) {
  const validKeys = new Set();
  for (const lesson of lessons) {
    for (const sec of lesson.sections ?? []) {
      validKeys.add(`${lesson.sceneId}/${sec.id}`);
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

async function main() {
  const lessons = await loadLessons();
  const manifest = await loadManifest();

  const reuseValid = process.argv.includes('--reuse-valid');
  const jobs = [];
  for (const lesson of lessons) {
    if (only && lesson.sceneId !== only) continue;
    const dir = join(audioRoot, lesson.sceneId);
    for (const sec of lesson.sections ?? []) {
      const key = `${lesson.sceneId}/${sec.id}`;
      if (onlySection && key !== onlySection) continue;
      const hash = lessonAudioHash(lesson.voice, lesson.style, sec.script);
      const outFile = join(dir, `${sec.id}.mp3`);
      if (!force && isValidMp3(outFile) && (reuseValid || manifest[key] === hash)) {
        if (reuseValid) manifest[key] = hash;
        continue;
      }
      jobs.push({
        key,
        sceneId: lesson.sceneId,
        sectionId: sec.id,
        voice: lesson.voice,
        style: lesson.style,
        script: sec.script,
        hash,
        dir,
        outFile,
      });
    }
  }

  if (!jobs.length) {
    await saveManifest(manifest, lessons);
    console.log('所有老师精讲音频与哈希均已是最新，跳过。');
    return;
  }

  if (!geminiKeys.length) {
    throw new Error('缺少 GEMINI_API_KEY。请在 .env.local 中配置后再生成音频。');
  }
  if (!(await hasCommand('ffmpeg'))) {
    throw new Error('需要本机安装 ffmpeg 才能转码 mp3。');
  }

  console.log(`Lesson TTS: Gemini (${MODEL}) · ${geminiKeys.length} 个 key · 待生成 ${jobs.length} 节`);
  let done = 0;
  const failures = [];
  const queue = [...jobs];

  async function worker() {
    while (queue.length) {
      const job = queue.shift();
      if (!job) return;
      await mkdir(job.dir, { recursive: true });
      try {
        await synthWithKeys(job.script, job.style, job.voice, job.outFile);
        if (!isValidMp3(job.outFile)) {
          throw new Error('生成的 MP3 文件无效或过小');
        }
        manifest[job.key] = job.hash;
        done += 1;
        await saveManifest(manifest, lessons);
        process.stdout.write(`\r  ${done}/${jobs.length}  ${job.key}      `);
      } catch (error) {
        failures.push({ ...job, error });
      }
      if (delay) await new Promise((resolvePromise) => setTimeout(resolvePromise, delay));
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  process.stdout.write('\n');
  await saveManifest(manifest, lessons);

  if (failures.length) {
    console.error(`\n有 ${failures.length} 节失败：`);
    for (const f of failures) {
      console.error(`- ${f.key}: ${f.error.message}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`老师精讲音频生成完成：${done}/${jobs.length}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
