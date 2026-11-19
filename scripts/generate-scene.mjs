#!/usr/bin/env node
/**
 * 按 Gemini 官方推荐的「两步流水线」按主题自动生成场景：
 *   1. 用 gemini-4-hydrogen 根据主题生成符合语料规范的台本 JSON（含假名标注、中文翻译、角色与声线）
 *   2. 调用 generate-audio.mjs（gemini-3.8-flash-tts 整场多角色合成 + speech_metadata + 语义边界切分）
 *   3. 自动执行 npm run check && npm run corpus:check
 *
 * 用法：
 *   npm run scene:new -- "在药局凭处方领药并确认服用方法"
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scenariosPath = join(root, 'src', 'data', 'scenarios.json');

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

const topic = process.argv.slice(2).join(' ').trim();
if (!topic) {
  throw new Error('请提供场景主题，例如：npm run scene:new -- "在药局凭处方领药并确认服用方法"');
}

const scenarios = JSON.parse(readFileSync(scenariosPath, 'utf8'));
const existingIds = new Set(scenarios.map((s) => s.id));

const prompt = `你是一个日语生活场景对话语料设计师。请围绕主题「${topic}」生成一个自然、地道、贴近日本日常生活的双人对话场景 JSON。

必须严格遵守以下规范：
1. 返回纯 JSON 对象（不要 markdown 代码块），包含字段：
   - "id": 英文小写短横线 ID（如 "pharmacy-prescription-pickup"），不能与已有 ID 重复：${[...existingIds].join(', ')}
   - "title": 日语标题，所有汉字必须用 {漢字|かんじ} 标注读音（如 "{薬局|やっきょく}で{薬|くすり}を{受|う}け{取|と}る"）
   - "titleZh": 简洁中文标题
   - "category": 从以下选一个：work, shopping, medical, food, transport, home, admin, study, social, travel, service, opinion
   - "emoji": 1 个贴切 emoji
   - "accent": 明亮模式十六进制主题色（如 "#2b6cb0"）
   - "accentDark": 暗黑模式十六进制主题色（如 "#63b3ed"）
   - "kind": "dialogue"
   - "speakers": 恰好 2 个说话人，各自从 Gemini 官方 30 个预设音色中选 1 个（两人音色不能相同）：Zephyr, Puck, Charon, Kore, Fenrir, Leda, Orus, Aoede, Callirrhoe, Autonoe, Enceladus, Iapetus, Umbriel, Algieba, Despina, Erinome, Algenib, Rasalgethi, Laomedeia, Achernar, Alnilam, Schedar, Gacrux, Pulcherrima, Achird, Zubenelgenubi, Vindemiatrix, Sadachbia, Sadaltager, Sulafat
     - 一个是 "id": "you", "label": "わたし", "self": true, "voice": "...", "style": 简短英文演绎风格描述（贴合该角色与场景，不要包含具体人名）
     - 另一个是对方角色（如 "id": "pharmacist", "label": "药剂师"）, 不写 self, "voice": "...", "style": 简短英文演绎风格描述（贴合该角色与场景，不要包含具体人名）
   - "lines": 5–8 句（推荐 6 句，"id": "l1" 起递增），两人交替发言：
     - 每句 "ja" 为自然地道的日常日语口语；
     - 每一个汉字（包括常见汉字、々）用 {漢字|かんじ} 标注读音，纯假名不加花括号，日文正文不加分词空格；
     - 每句 "zh" 写自然流畅的中文翻译；
     - 每句可选 "style": 简短英文单句语气描述（随对话推进微调语气，如 "polite greeting"、"clear explanation"、"relieved and grateful"；不要包含具体人名）。`;

let generated = null;
let lastErr = null;
for (const key of apiKeys) {
  try {
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.4,
            responseMimeType: 'application/json',
          },
        }),
      },
    );
    if (!res.ok) {
      lastErr = new Error(`gemini-4-hydrogen ${res.status}: ${(await res.text()).slice(0, 300)}`);
      continue;
    }
    const payload = await res.json();
    const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) continue;
    generated = JSON.parse(text);
    break;
  } catch (err) {
    lastErr = err;
  }
}

if (!generated) {
  throw lastErr || new Error('场景台本生成失败');
}
if (existingIds.has(generated.id)) {
  generated.id = `${generated.id}-${Date.now().toString(36).slice(-4)}`;
}
if (Array.isArray(generated.lines)) {
  for (const line of generated.lines) {
    if (!line.ja && line.jp) {
      line.ja = line.jp;
      delete line.jp;
    }
  }
}

scenarios.push(generated);
writeFileSync(scenariosPath, `${JSON.stringify(scenarios, null, 2)}\n`, 'utf8');
console.log(`✓ 已生成台本：${generated.id}（${generated.titleZh}），共 ${generated.lines?.length ?? 0} 句`);

function runStep(cmd, args) {
  const res = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' });
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
}

runStep('node', ['scripts/generate-audio.mjs', `--only=${generated.id}`, '--force']);
runStep('npm', ['run', 'check']);
runStep('npm', ['run', 'corpus:check']);
