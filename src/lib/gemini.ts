const KEY_STORAGE = 'scene-lab:gemini-key:v1';
const MODEL_STORAGE = 'scene-lab:gemini-model:v1';

export const GEMINI_MODELS = [
  { id: 'gemini-4-carbon', label: 'Gemini 4 Carbon（智力最强）' },
  { id: 'gemini-4-argon', label: 'Gemini 4 Argon（高阶推理）' },
  { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen（均衡快）' },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash（极速）' },
] as const;

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export function loadKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

export function saveKey(key: string): void {
  try {
    localStorage.setItem(KEY_STORAGE, key.trim());
  } catch {
    // 隐私模式禁用 localStorage 时静默失败。
  }
}

export function clearKey(): void {
  try {
    localStorage.removeItem(KEY_STORAGE);
  } catch {
    // 同上。
  }
}

export function loadModel(): string {
  try {
    const saved = localStorage.getItem(MODEL_STORAGE);
    if (saved && GEMINI_MODELS.some((item) => item.id === saved)) return saved;
  } catch {
    // 忽略。
  }
  return GEMINI_MODELS[0].id;
}

export function saveModel(model: string): void {
  try {
    localStorage.setItem(MODEL_STORAGE, model);
  } catch {
    // 忽略。
  }
}

export interface InteractionError extends Error {
  status?: number;
  detail?: string;
}

function errorMessage(status: number, detail: string): string {
  if (status === 400 && /API key not valid|API_KEY_INVALID/i.test(detail)) {
    return 'Key 无效，请在设置里重新填写 Gemini API key。';
  }
  if (status === 401 || status === 403) {
    return 'Key 没有权限或已失效，请检查后重填。';
  }
  if (status === 404) {
    return '之前的会话在服务端已失效，将开始新会话。';
  }
  if (status === 429) {
    return '额度用完了（429），换一个 key 或等额度恢复。';
  }
  if (/previous_interaction_id|interaction.*(not found|expired)/i.test(detail)) {
    return '之前的会话在服务端已失效，将开始新会话。';
  }
  return `请求失败（${status}），请稍后再试。`;
}

/** 服务端会话失效（过期/被删/ID 不对）时返回 true，调用方可以重开一个会话。 */
export function isStaleInteraction(error: unknown): boolean {
  const err = error as InteractionError | null;
  if (!err) return false;
  if (err.status === 404) return true;
  return /previous_interaction_id|interaction.*(not found|expired)|会话.*失效/i.test(
    `${err.message} ${err.detail ?? ''}`,
  );
}

const SYSTEM_INSTRUCTION = [
  '你是一位耐心的日语学习助手，正在配合用户的日语情景对话/短文练习工具解答问题。',
  '请使用简洁清晰的简体中文回答，必要时附上日语例句与假名读音。',
  '回答紧扣用户提供的场景与当前句：讲清含义、语法助词、语气礼貌度或更自然的说法，避免冗长套话。',
].join('\n');

export interface GeminiContent {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

/**
 * 标准 Gemini 流式对话接口（models/:streamGenerateContent?alt=sse）。
 * 相比实验性的 interactions 端点，无服务端会话过期/隐式状态错位问题，响应更稳定。
 */
export async function streamChat(options: {
  key: string;
  model: string;
  contents: GeminiContent[];
  signal?: AbortSignal;
  onDelta: (text: string) => void;
}): Promise<{ text: string }> {
  const { key, model, contents, signal, onDelta } = options;
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'x-goog-api-key': key,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents,
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 8192,
          thinkingConfig: { thinkingLevel: 'low' },
        },
      }),
      signal,
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const error: InteractionError = new Error(errorMessage(response.status, detail));
    error.status = response.status;
    error.detail = detail;
    throw error;
  }
  if (!response.body) throw new Error('浏览器不支持流式读取，请换一个浏览器。');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let finishReason = '';
  let blockReason = '';

  const handleEvent = (raw: string) => {
    for (const line of raw.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let chunk: {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string; thought?: boolean }> };
          finishReason?: string;
        }>;
        promptFeedback?: { blockReason?: string };
        error?: { message?: string; code?: number; status?: string };
      };
      try {
        chunk = JSON.parse(payload);
      } catch {
        continue;
      }
      if (chunk.error?.message) {
        const error: InteractionError = new Error(chunk.error.message);
        error.status = chunk.error.code;
        error.detail = chunk.error.status ?? '';
        throw error;
      }
      if (chunk.promptFeedback?.blockReason) {
        blockReason = chunk.promptFeedback.blockReason;
      }
      const candidate = chunk.candidates?.[0];
      if (candidate?.finishReason) {
        finishReason = candidate.finishReason;
      }
      const parts = candidate?.content?.parts;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          if (part.thought) continue;
          if (part.text) {
            text += part.text;
            onDelta(part.text);
          }
        }
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let index = buffer.indexOf('\n\n');
    while (index >= 0) {
      handleEvent(buffer.slice(0, index));
      buffer = buffer.slice(index + 2);
      index = buffer.indexOf('\n\n');
    }
  }
  if (buffer.trim()) handleEvent(buffer);

  if (!text) {
    if (blockReason) {
      throw new Error(`请求被安全策略拦截（${blockReason}），请换个问法再试。`);
    }
    if (finishReason && finishReason !== 'STOP') {
      throw new Error(`生成中断（${finishReason}），请再试一次。`);
    }
  }

  return { text };
}

/**
 * Interactions API 流式请求。
 * 有 previousInteractionId 时由服务端带上历史，不需要再发一遍。
 */
export async function streamInteraction(options: {
  key: string;
  model: string;
  input: string;
  previousInteractionId?: string;
  signal?: AbortSignal;
  onDelta: (text: string) => void;
  onId: (id: string) => void;
}): Promise<{ id: string; text: string }> {
  const { key, model, input, previousInteractionId, signal, onDelta, onId } = options;
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      model,
      input,
      stream: true,
      ...(previousInteractionId
        ? { previous_interaction_id: previousInteractionId }
        : { system_instruction: SYSTEM_INSTRUCTION }),
      generation_config: {
        temperature: 0.4,
        max_output_tokens: 8192,
        thinking_level: 'low',
      },
    }),
    signal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const error: InteractionError = new Error(errorMessage(response.status, detail));
    error.status = response.status;
    error.detail = detail;
    throw error;
  }
  if (!response.body) throw new Error('浏览器不支持流式读取，请换一个浏览器。');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let id = '';

  const handleEvent = (raw: string) => {
    for (const line of raw.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let event: {
        event_type?: string;
        interaction?: {
          id?: string;
          status?: string;
          outputs?: Array<{ type?: string; text?: string }>;
        };
        delta?: { type?: string; text?: string };
        error?: { message?: string; code?: string };
      };
      try {
        event = JSON.parse(payload);
      } catch {
        continue;
      }
      if (event.event_type === 'interaction.created' || event.event_type === 'interaction.completed') {
        if (event.interaction?.id) {
          id = event.interaction.id;
          onId(id);
        }
        if (event.event_type === 'interaction.completed' && !text && Array.isArray(event.interaction?.outputs)) {
          const fallbackText = event.interaction.outputs
            .filter((item) => item.type === 'text' && item.text)
            .map((item) => item.text ?? '')
            .join('');
          if (fallbackText) {
            text = fallbackText;
            onDelta(fallbackText);
          }
        }
      } else if (event.event_type === 'step.delta') {
        if (event.delta?.type === 'text' && event.delta.text) {
          text += event.delta.text;
          onDelta(event.delta.text);
        }
      } else if (event.event_type === 'error') {
        const error: InteractionError = new Error(
          event.error?.message ?? '生成失败，请稍后再试。',
        );
        error.detail = event.error?.code ?? '';
        throw error;
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let index = buffer.indexOf('\n\n');
    while (index >= 0) {
      handleEvent(buffer.slice(0, index));
      buffer = buffer.slice(index + 2);
      index = buffer.indexOf('\n\n');
    }
  }
  if (buffer.trim()) handleEvent(buffer);
  return { id, text };
}

/** 删除服务端保存的会话（清空对话时调用，失败可忽略）。 */
export async function deleteInteraction(id: string, key: string): Promise<void> {
  if (!id || !key) return;
  await fetch(`https://generativelanguage.googleapis.com/v1beta/interactions/${id}`, {
    method: 'DELETE',
    headers: { 'x-goog-api-key': key },
  }).catch(() => undefined);
}

/**
 * 使用 Gemini 多模态音频能力转写中日语混合语音。
 * 相比浏览器单语种 Web Speech API，可准确识别同一句话里的中文与日语词汇混说。
 */
export async function transcribeMixedAudio(options: {
  key: string;
  model?: string;
  mimeType: string;
  base64: string;
  lineHint?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const { key, model = 'gemini-3.8-flash', mimeType, base64, lineHint, signal } = options;
  const prompt = [
    '请准确转写这段语音内容。',
    '说话者正在学习日语，可能会中日语混说（例如中文句子中夹杂日语单词、助词、语法或整句日语）。',
    '要求：',
    '1. 保留原本的中日文混排，中文使用简体中文，日语使用准确的假名或日文汉字；只输出转写后的纯文本，不要加引号、前缀或解释。',
    '2. 如果音频中没有清晰的人声说话（例如只是静音、环境噪音或微弱杂音），请严格输出空文本（什么都不要输出），绝对不要猜测，也绝对不要输出参考语境里的句子。',
    lineHint ? `参考词汇语境（仅用于修正同音词，切勿直接复述）：${lineHint}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType, data: base64 } },
              { text: prompt },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 512,
        },
      }),
      signal,
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const error: InteractionError = new Error(errorMessage(response.status, detail));
    error.status = response.status;
    error.detail = detail;
    throw error;
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text =
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('')
      .trim() ?? '';
  if (!text || /^(?:无|静音|空白|none|silence|\(?silence\)?|\[?silence\]?|（静音）|（无语音）|（无内容）)$/i.test(text)) {
    return '';
  }
  return text;
}
