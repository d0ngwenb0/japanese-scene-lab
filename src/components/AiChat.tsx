import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { Line, Scenario } from '../types';
import {
  AUTO_MODEL_ID,
  GEMINI_MODELS,
  clearKey,
  deleteInteraction,
  fetchAvailableModels,
  loadCachedModels,
  loadKey,
  loadModel,
  pickAutoCandidates,
  saveKey,
  saveModel,
  streamChatWithFallback,
  transcribeMixedAudio,
  type ChatMessage,
  type GeminiContent,
  type ModelOption,
} from '../lib/gemini';
import { copyText, stripFurigana } from '../lib/copy';
import { Furigana } from '../lib/furigana';
import { CloseIcon, CopyIcon, KeyIcon, MicIcon, PlayIcon, SendIcon, StopIcon, TrashIcon } from './Icons';
import { renderMarkdown } from '../lib/markdown';

const CHAT_PREFIX = 'scene-lab:ai-chat:v2:';
const LEGACY_PREFIX = 'scene-lab:ai-chat:v1:';
const MAX_MESSAGES = 40;

interface StoredChat {
  messages: ChatMessage[];
  interactionId?: string;
  lineId?: string;
  sceneHash?: string;
  keyHash?: string;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function sceneSignature(scenario: Scenario): string {
  return hashString(
    [
      scenario.id,
      scenario.title,
      scenario.speakers.map((item) => `${item.id}:${item.label}`).join(','),
      scenario.lines.map((item) => `${item.id}|${item.speaker}|${stripFurigana(item.ja)}`).join('\n'),
    ].join('#'),
  );
}

const isMessage = (item: unknown): item is ChatMessage => {
  const value = item as ChatMessage | null;
  return Boolean(
    value &&
      (value.role === 'user' || value.role === 'assistant') &&
      typeof value.text === 'string',
  );
};

function loadChat(sceneId: string): StoredChat {
  try {
    const raw = localStorage.getItem(CHAT_PREFIX + sceneId);
    if (raw) {
      const data = JSON.parse(raw) as StoredChat;
      if (data && Array.isArray(data.messages)) {
        return {
          messages: data.messages.filter(isMessage).slice(-MAX_MESSAGES),
          interactionId: typeof data.interactionId === 'string' ? data.interactionId : undefined,
          lineId: typeof data.lineId === 'string' ? data.lineId : undefined,
          sceneHash: typeof data.sceneHash === 'string' ? data.sceneHash : undefined,
          keyHash: typeof data.keyHash === 'string' ? data.keyHash : undefined,
        };
      }
    }
    const legacy = localStorage.getItem(LEGACY_PREFIX + sceneId);
    if (legacy) {
      const data = JSON.parse(legacy);
      if (Array.isArray(data)) return { messages: data.filter(isMessage).slice(-MAX_MESSAGES) };
    }
  } catch {
    // 解析失败就当没有记录。
  }
  return { messages: [] };
}

function saveChat(sceneId: string, data: StoredChat): void {
  try {
    const keep = data.messages
      .filter((message) => message.role === 'user' || message.text.trim())
      .slice(-MAX_MESSAGES);
    if (!keep.length && !data.interactionId) {
      localStorage.removeItem(CHAT_PREFIX + sceneId);
      localStorage.removeItem(LEGACY_PREFIX + sceneId);
      return;
    }
    localStorage.setItem(
      CHAT_PREFIX + sceneId,
      JSON.stringify({ ...data, messages: keep }),
    );
  } catch {
    // 隐私模式写入失败时忽略。
  }
}

const speakerLabel = (scenario: Scenario, line: Line) =>
  scenario.speakers.find((item) => item.id === line.speaker)?.label ?? line.speaker;

function sceneContext(scenario: Scenario, lineId?: string): string {
  const lines = scenario.lines
    .map((item, index) => `${index + 1}. ${speakerLabel(scenario, item)}：${stripFurigana(item.ja)}`)
    .join('\n');
  const index = scenario.lines.findIndex((item) => item.id === lineId);
  const current =
    index >= 0
      ? `${index + 1}. ${speakerLabel(scenario, scenario.lines[index])}：${stripFurigana(scenario.lines[index].ja)}`
      : '';
  return [
    `【场景】${stripFurigana(scenario.title)}（${scenario.kind === 'passage' ? '短文' : scenario.kind === 'jlpt' ? 'JLPT听力' : '对话'}）`,
    `【人物】${scenario.speakers.map((item) => item.label).join('、')}`,
    '【台词】',
    lines,
    '',
    `【当前句】${current}`,
  ].join('\n');
}

function lineContext(scenario: Scenario, lineId?: string): string {
  const index = scenario.lines.findIndex((item) => item.id === lineId);
  if (index < 0) return '';
  const item = scenario.lines[index];
  return `【当前句】${index + 1}. ${speakerLabel(scenario, item)}：${stripFurigana(item.ja)}`;
}

function buildContents(
  scenario: Scenario,
  lineId: string,
  lastLineId: string | undefined,
  history: ChatMessage[],
  currentQuestion: string,
): GeminiContent[] {
  const contents: GeminiContent[] = [];
  // 仅保留已完成问答的成对历史，保证 role 严格交替且不夹带失败轮次的未回答提问。
  for (let i = 0; i < history.length; i += 1) {
    const msg = history[i];
    if (msg.role === 'user') {
      const next = history[i + 1];
      if (next && next.role === 'assistant' && next.text.trim()) {
        const userText =
          contents.length === 0 ? `${sceneContext(scenario, lineId)}\n\n${msg.text}` : msg.text;
        contents.push({ role: 'user', parts: [{ text: userText }] });
        contents.push({ role: 'model', parts: [{ text: next.text }] });
        i += 1;
      }
    }
  }
  const currentText =
    contents.length === 0
      ? `${sceneContext(scenario, lineId)}\n\n${currentQuestion}`
      : lastLineId !== lineId
        ? `${lineContext(scenario, lineId)}\n\n${currentQuestion}`
        : currentQuestion;
  contents.push({ role: 'user', parts: [{ text: currentText }] });
  return contents;
}

interface Props {
  scenario: Scenario;
  line: Line;
  open: boolean;
  onClose: () => void;
  pausedByAi?: boolean;
  onSessionStart?: () => void;
  onSessionEnd?: () => void;
  pendingAsk?: { id: number; text: string } | null;
  onConsumePendingAsk?: () => void;
}

export function AiChat({
  scenario,
  line,
  open,
  onClose,
  pausedByAi = false,
  onSessionStart,
  onSessionEnd,
  pendingAsk,
  onConsumePendingAsk,
}: Props) {
  const initial = useRef<StoredChat | null>(null);
  if (!initial.current) initial.current = loadChat(scenario.id);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [key, setKey] = useState(() => loadKey());
  const [model, setModel] = useState(() => loadModel());
  const [availableModels, setAvailableModels] = useState<ModelOption[]>(
    () => loadCachedModels(loadKey()).models,
  );
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>(initial.current.messages);
  const [interactionId, setInteractionId] = useState<string | undefined>(
    initial.current.interactionId,
  );
  const [lastLineId, setLastLineId] = useState<string | undefined>(initial.current.lineId);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [thinkingStatus, setThinkingStatus] = useState('');
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState('');
  const [copiedIndex, setCopiedIndex] = useState(-1);
  const keyInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const transcribeAbortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const confirmDialogRef = useRef<HTMLDialogElement>(null);
  const pointerInsideAiRef = useRef(false);
  const wasOpenRef = useRef(open);
  const confirmTitleId = useId();
  const confirmDescId = useId();
  const stickRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const copiedTimer = useRef<number | null>(null);
  const pendingRef = useRef('');
  const shownRef = useRef('');
  const endedRef = useRef(true);
  const tickerRef = useRef<number | null>(null);
  const loadedSceneRef = useRef(scenario.id);
  const skipSaveRef = useRef(false);
  const messagesRef = useRef(messages);
  const saveTimerRef = useRef<number | null>(null);
  const interactionRef = useRef(interactionId);
  const lastConsumedAskIdRef = useRef(0);
  const lastLineRef = useRef(lastLineId);
  const sceneHashRef = useRef(initial.current.sceneHash);
  const keyHashRef = useRef(initial.current.keyHash);
  const wavStopRef = useRef<((discard?: boolean) => void) | null>(null);

  const stopTicker = () => {
    if (tickerRef.current !== null) {
      window.clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
  };

  const releaseMicrophone = useCallback(() => {
    if (wavStopRef.current) {
      try {
        wavStopRef.current(true);
      } catch {
        // 忽略。
      }
      wavStopRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // 忽略。
      }
    }
    mediaRecorderRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    setRecording(false);
  }, []);

  useEffect(() => {
    if (!open) {
      releaseMicrophone();
      transcribeAbortRef.current?.abort();
    }
  }, [open, releaseMicrophone]);

  useEffect(() => {
    return () => {
      releaseMicrophone();
      transcribeAbortRef.current?.abort();
    };
  }, [releaseMicrophone]);

  const blobToBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(new Error('读取录音数据失败。'));
      reader.readAsDataURL(blob);
    });

  const isSilentBlob = async (blob: Blob): Promise<boolean> => {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return false;
    const ctx = new AudioCtx();
    try {
      const arr = await blob.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arr);
      const ch = decoded.getChannelData(0);
      let peak = 0;
      let sumSq = 0;
      for (let i = 0; i < ch.length; i += 1) {
        const v = Math.abs(ch[i]);
        if (v > peak) peak = v;
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / Math.max(ch.length, 1));
      return peak < 0.012 && rms < 0.0025;
    } catch {
      return false;
    } finally {
      ctx.close().catch(() => {});
    }
  };

  const encodeWav = (chunks: Float32Array[], sampleRate: number): Blob => {
    const length = chunks.reduce((sum, item) => sum + item.length, 0);
    const buffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(buffer);
    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i += 1) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, length * 2, true);

    let offset = 44;
    for (const chunk of chunks) {
      for (let i = 0; i < chunk.length; i += 1) {
        const clamped = Math.max(-1, Math.min(1, chunk[i]));
        view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
        offset += 2;
      }
    }
    return new Blob([buffer], { type: 'audio/wav' });
  };

  const handleRecordedBlob = async (blob: Blob, mimeType: string) => {
    if (blob.size < 400) return;
    if (await isSilentBlob(blob)) return;

    setTranscribing(true);
    const controller = new AbortController();
    transcribeAbortRef.current = controller;
    try {
      const base64 = await blobToBase64(blob);
      const transcript = await transcribeMixedAudio({
        key,
        model: 'gemini-3.8-flash',
        mimeType: mimeType.split(';')[0],
        base64,
        lineHint: stripFurigana(line.ja),
        signal: controller.signal,
      });
      if (transcript) {
        setDraft((prev) => (prev.trim() ? `${prev.trimEnd()} ${transcript}` : transcript));
        window.requestAnimationFrame(() => textareaRef.current?.focus());
      }
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') {
        setError(err instanceof Error ? err.message : '语音识别失败，请稍后再试。');
      }
    } finally {
      if (transcribeAbortRef.current === controller) transcribeAbortRef.current = null;
      setTranscribing(false);
    }
  };

  const startWavFallbackRecording = (stream: MediaStream, prewarmedCtx?: AudioContext | null) => {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx && !prewarmedCtx) {
      throw new Error('当前浏览器不支持音频录制。');
    }

    const ctx = prewarmedCtx ?? new AudioCtx!();
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    const silentGain = ctx.createGain();
    silentGain.gain.value = 0;

    const pcmChunks: Float32Array[] = [];
    let stopped = false;

    processor.onaudioprocess = (event) => {
      if (stopped) return;
      const input = event.inputBuffer.getChannelData(0);
      pcmChunks.push(new Float32Array(input));
    };

    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(ctx.destination);
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    wavStopRef.current = (discard = false) => {
      if (stopped) return;
      stopped = true;
      wavStopRef.current = null;

      try {
        processor.disconnect();
        source.disconnect();
        silentGain.disconnect();
      } catch {
        // 忽略。
      }
      ctx.close().catch(() => {});
      stream.getTracks().forEach((track) => track.stop());
      if (mediaStreamRef.current === stream) mediaStreamRef.current = null;
      setRecording(false);

      if (discard || pcmChunks.length === 0) return;
      const wavBlob = encodeWav(pcmChunks, ctx.sampleRate || 44100);
      void handleRecordedBlob(wavBlob, 'audio/wav');
    };

    setRecording(true);
  };

  const toggleVoiceInput = async () => {
    if (transcribing || busy) return;

    if (recording) {
      if (wavStopRef.current) {
        wavStopRef.current(false);
        return;
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      setRecording(false);
      return;
    }

    if (!key) {
      setSettingsOpen(true);
      setError('先填写 Gemini API key 才能使用中日语混合语音输入。');
      return;
    }

    if (!window.isSecureContext) {
      setError('语音输入需要 HTTPS 安全连接，请使用 HTTPS 地址访问。');
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('当前浏览器不支持录音输入，请改用 Safari / Chrome 最新版。');
      return;
    }

    setError('');
    // 在用户手势同步阶段先解锁 AudioContext，避免 iPadOS WebKit 在 await getUserMedia 后丢失手势权限
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    let prewarmedCtx: AudioContext | null = null;
    if (AudioCtx) {
      try {
        prewarmedCtx = new AudioCtx();
        if (prewarmedCtx.state === 'suspended') {
          prewarmedCtx.resume().catch(() => {});
        }
      } catch {
        prewarmedCtx = null;
      }
    }

    let stage = 'getUserMedia';
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (firstErr) {
        if ((firstErr as { name?: string })?.name === 'InvalidStateError') {
          await new Promise((r) => window.setTimeout(r, 120));
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } else {
          throw firstErr;
        }
      }
      mediaStreamRef.current = stream;

      if (typeof MediaRecorder !== 'undefined') {
        const mimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
        const chosenMime =
          typeof MediaRecorder.isTypeSupported === 'function'
            ? (mimeTypes.find((type) => MediaRecorder.isTypeSupported(type)) ?? '')
            : '';

        try {
          let recorder: MediaRecorder;
          try {
            recorder = chosenMime ? new MediaRecorder(stream, { mimeType: chosenMime }) : new MediaRecorder(stream);
          } catch {
            recorder = new MediaRecorder(stream);
          }
          audioChunksRef.current = [];
          mediaRecorderRef.current = recorder;

          recorder.ondataavailable = (event) => {
            if (event.data.size > 0) audioChunksRef.current.push(event.data);
          };

          recorder.onstop = async () => {
            stream.getTracks().forEach((track) => track.stop());
            if (mediaStreamRef.current === stream) mediaStreamRef.current = null;
            if (mediaRecorderRef.current === recorder) mediaRecorderRef.current = null;
            setRecording(false);

            const chunks = audioChunksRef.current;
            audioChunksRef.current = [];
            if (chunks.length === 0) return;

            const mimeType = recorder.mimeType || chosenMime || 'audio/webm';
            const blob = new Blob(chunks, { type: mimeType });
            await handleRecordedBlob(blob, mimeType);
          };

          recorder.start();
          prewarmedCtx?.close().catch(() => {});
          setRecording(true);
          return;
        } catch {
          // iPadOS Chrome 等 WebKit 环境可能对 MediaRecorder.start() 抛出 InvalidStateError，自动回退到 Web Audio WAV 录音。
          mediaRecorderRef.current = null;
        }
      }

      stage = 'wavFallback';
      startWavFallbackRecording(stream, prewarmedCtx);
    } catch (err) {
      prewarmedCtx?.close().catch(() => {});
      releaseMicrophone();
      const name = (err as { name?: string })?.name ?? '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setError('麦克风权限被拒绝，请在浏览器及系统「设置 → Chrome → 麦克风」中允许访问。');
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setError('未检测到可用麦克风设备，请检查设备音频输入后重试。');
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        setError('麦克风正被占用或音频会话冲突，请关闭其他占用麦克风的应用后重试。');
      } else if (name === 'SecurityError') {
        setError('当前页面非安全上下文（HTTPS），无法调用麦克风。');
      } else if (name === 'InvalidStateError') {
        setError(
          `麦克风状态异常（InvalidStateError · ${stage}）。iPad Chrome 内核在切后台或全屏后偶发音频会话卡死，可关闭重开标签页或改用 Safari。`,
        );
      } else {
        setError(`无法打开麦克风${name ? `（${name}）` : ''}，请检查设备与系统「设置 → Chrome → 麦克风」权限后重试。`);
      }
    }
  };

  const flushPendingText = () => {
    const pending = pendingRef.current;
    if (!pending) return false;
    pendingRef.current = '';
    shownRef.current += pending;
    const copy = messagesRef.current.slice();
    if (copy.length && copy[copy.length - 1].role === 'assistant') {
      copy[copy.length - 1] = { role: 'assistant', text: shownRef.current };
      messagesRef.current = copy;
      return true;
    }
    return false;
  };

  // 服务端有时会把整段文本一次送达；用打字机效果逐字吐出，保持流式观感。
  const startTicker = () => {
    if (tickerRef.current !== null) return;
    tickerRef.current = window.setInterval(() => {
      const pending = pendingRef.current;
      if (!pending) {
        if (endedRef.current) {
          stopTicker();
          setBusy(false);
        }
        return;
      }
      const take =
        pending.length > 700 ? 16 : pending.length > 320 ? 10 : pending.length > 120 ? 6 : 3;
      const chunk = pending.slice(0, take);
      pendingRef.current = pending.slice(take);
      shownRef.current += chunk;
      setMessages((prev) => {
        const copy = prev.slice();
        if (!copy.length) return prev;
        copy[copy.length - 1] = { role: 'assistant', text: shownRef.current };
        return copy;
      });
    }, 24);
  };

  useEffect(() => {
    const prevSceneId = loadedSceneRef.current;
    if (prevSceneId && prevSceneId !== scenario.id) {
      flushPendingText();
      saveChat(prevSceneId, {
        messages: messagesRef.current,
        interactionId: interactionRef.current,
        lineId: lastLineRef.current,
        sceneHash: sceneHashRef.current,
        keyHash: keyHashRef.current,
      });
    }
    abortRef.current?.abort();
    abortRef.current = null;
    stopTicker();
    pendingRef.current = '';
    shownRef.current = '';
    loadedSceneRef.current = scenario.id;
    skipSaveRef.current = true;
    const loaded = loadChat(scenario.id);
    const sceneHash = sceneSignature(scenario);
    const keyHash = hashString(key);
    const stale = Boolean(
      loaded.interactionId &&
        ((loaded.sceneHash && loaded.sceneHash !== sceneHash) ||
          (loaded.keyHash && loaded.keyHash !== keyHash)),
    );
    stickRef.current = true;
    setMessages(loaded.messages);
    setInteractionId(stale ? undefined : loaded.interactionId);
    setLastLineId(loaded.lineId);
    messagesRef.current = loaded.messages;
    interactionRef.current = stale ? undefined : loaded.interactionId;
    lastLineRef.current = loaded.lineId;
    sceneHashRef.current = sceneHash;
    keyHashRef.current = keyHash;
    setError('');
    setDraft('');
    setBusy(false);
    setThinking(false);
    setThinkingStatus('');
  }, [scenario.id]);

  useEffect(() => {
    if (skipSaveRef.current) {
      skipSaveRef.current = false;
      return;
    }
    if (loadedSceneRef.current !== scenario.id) return;
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveChat(scenario.id, {
        messages: messagesRef.current,
        interactionId: interactionRef.current,
        lineId: lastLineRef.current,
        sceneHash: sceneHashRef.current,
        keyHash: keyHashRef.current,
      });
      saveTimerRef.current = null;
    }, 400);
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [messages, interactionId, lastLineId, scenario.id]);

  messagesRef.current = messages;
  interactionRef.current = interactionId;
  lastLineRef.current = lastLineId;

  useEffect(() => {
    const flush = () => {
      flushPendingText();
      saveChat(scenario.id, {
        messages: messagesRef.current,
        interactionId: interactionRef.current,
        lineId: lastLineRef.current,
        sceneHash: sceneHashRef.current,
        keyHash: keyHashRef.current,
      });
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [scenario.id]);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      stickRef.current = true;
      onSessionStart?.();
    } else if (!open && wasOpenRef.current) {
      onSessionEnd?.();
    }
    wasOpenRef.current = open;
  }, [open, onSessionStart, onSessionEnd]);

  useEffect(() => {
    if (!open) return;
    if (key) textareaRef.current?.focus();
    else keyInputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (confirmDialogRef.current?.open) return;
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, key, onClose]);

  useEffect(() => {
    const dialog = confirmDialogRef.current;
    if (!dialog || 'closedBy' in HTMLDialogElement.prototype) return;
    const outside = (event: PointerEvent) => {
      const rect = dialog.getBoundingClientRect();
      return (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      );
    };
    let pressedOutside = false;
    const onDown = (event: PointerEvent) => {
      pressedOutside = outside(event);
    };
    const onUp = (event: PointerEvent) => {
      if (pressedOutside && outside(event)) dialog.close();
    };
    dialog.addEventListener('pointerdown', onDown);
    dialog.addEventListener('pointerup', onUp);
    return () => {
      dialog.removeEventListener('pointerdown', onDown);
      dialog.removeEventListener('pointerup', onUp);
    };
  }, []);

  useEffect(() => {
    if (!open || !key || settingsOpen) return;
    const log = logRef.current;
    if (!log || !stickRef.current) return;
    log.scrollTop = log.scrollHeight;
    const raf = window.requestAnimationFrame(() => {
      if (stickRef.current) log.scrollTop = log.scrollHeight;
    });
    return () => window.cancelAnimationFrame(raf);
  }, [messages, thinking, error, open, key, settingsOpen]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
      if (tickerRef.current !== null) window.clearInterval(tickerRef.current);
    },
    [],
  );

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 116)}px`;
  }, [draft]);

  const send = useCallback(
    async (question?: string) => {
      const text = (question ?? draft).trim();
      if (!text || !key || busy) return;
      const contents = buildContents(scenario, line.id, lastLineRef.current, messages, text);
      sceneHashRef.current = sceneSignature(scenario);
      keyHashRef.current = hashString(key);

      setMessages((prev) => [
        ...prev,
        { role: 'user', text },
        { role: 'assistant', text: '' },
      ]);
      setDraft('');
      setError('');
      setBusy(true);
      setThinking(true);
      setThinkingStatus('');
      pendingRef.current = '';
      shownRef.current = '';
      endedRef.current = false;
      lastLineRef.current = line.id;
      setLastLineId(line.id);
      const controller = new AbortController();
      abortRef.current = controller;
      let received = false;

      const labelFor = (modelId: string) =>
        availableModels.find((item) => item.id === modelId)?.label ??
        GEMINI_MODELS.find((item) => item.id === modelId)?.label ??
        modelId;

      try {
        const candidates =
          model === AUTO_MODEL_ID ? pickAutoCandidates(availableModels) : [model];
        const result = await streamChatWithFallback({
          key,
          candidates,
          contents,
          signal: controller.signal,
          onAttempt: ({ model: attemptModel, fallbackReason }) => {
            const name = labelFor(attemptModel);
            if (fallbackReason === 'timeout') {
              setThinkingStatus(`响应较慢，已切换至 ${name}…`);
            } else if (fallbackReason === 'error') {
              setThinkingStatus(`当前模型暂不可用，已切换至 ${name}…`);
            } else {
              setThinkingStatus(`正在由 ${name} 解析…`);
            }
          },
          onDelta: (delta) => {
            if (!received) {
              received = true;
              setThinking(false);
              setThinkingStatus('');
            }
            pendingRef.current += delta;
            startTicker();
          },
        });
        endedRef.current = true;
        if (!received && !result.text) {
          stopTicker();
          setMessages((prev) => prev.slice(0, -1));
          setError('模型没有返回内容，请换个问法或稍后再试。');
          setBusy(false);
          setThinking(false);
          setThinkingStatus('');
          return;
        }
        if (!pendingRef.current) {
          stopTicker();
          setBusy(false);
        }
      } catch (err) {
        endedRef.current = true;
        if (controller.signal.aborted) {
          pendingRef.current = '';
          stopTicker();
          setBusy(false);
          setThinking(false);
          setThinkingStatus('');
          if (!shownRef.current) {
            setMessages((prev) => prev.slice(0, -1));
          }
          return;
        }
        setError(err instanceof Error ? err.message : '请求失败，请稍后再试。');
        pendingRef.current = '';
        stopTicker();
        if (!shownRef.current) {
          setMessages((prev) => prev.slice(0, -1));
        }
        setBusy(false);
        setThinking(false);
        setThinkingStatus('');
      } finally {
        abortRef.current = null;
      }
    },
    [availableModels, draft, key, line.id, messages, model, busy, scenario],
  );

  useEffect(() => {
    if (!open || !pendingAsk || pendingAsk.id === lastConsumedAskIdRef.current) return;
    lastConsumedAskIdRef.current = pendingAsk.id;
    onConsumePendingAsk?.();
    if (key && !busy) {
      void send(pendingAsk.text);
    } else {
      setDraft(pendingAsk.text);
      if (!key) setSettingsOpen(true);
    }
  }, [open, pendingAsk, key, busy, send, onConsumePendingAsk]);

  useEffect(() => {
    if (!key) {
      setAvailableModels(GEMINI_MODELS);
      return;
    }
    const cached = loadCachedModels(key);
    setAvailableModels(cached.models);
    if (!open || cached.fresh) return;
    const controller = new AbortController();
    fetchAvailableModels(key, { signal: controller.signal })
      .then((list) => {
        if (!controller.signal.aborted && list.length) {
          setAvailableModels(list);
        }
      })
      .catch(() => {
        // 静默回退到缓存或默认列表。
      });
    return () => controller.abort();
  }, [key, open]);

  const refreshModels = useCallback(async () => {
    const activeKey = keyDraft.trim() || key;
    if (!activeKey || refreshingModels) return;
    setRefreshingModels(true);
    try {
      const list = await fetchAvailableModels(activeKey, { force: true });
      if (list.length) setAvailableModels(list);
    } catch {
      // 忽略网络错误，保留当前列表。
    } finally {
      setRefreshingModels(false);
    }
  }, [key, keyDraft, refreshingModels]);

  const stop = () => {
    abortRef.current?.abort();
    if (flushPendingText()) {
      setMessages(messagesRef.current);
    }
    endedRef.current = true;
    stopTicker();
    setBusy(false);
    setThinking(false);
    setThinkingStatus('');
  };

  const submitKey = (event: FormEvent) => {
    event.preventDefault();
    const next = keyDraft.trim();
    if (!next) return;
    saveKey(next);
    setKey(next);
    setKeyDraft('');
    setSettingsOpen(false);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const clear = () => {
    clearKey();
    setKey('');
    setMessages([]);
    setInteractionId(undefined);
    interactionRef.current = undefined;
    setError('');
    setSettingsOpen(false);
  };

  const clearChat = () => {
    abortRef.current?.abort();
    void deleteInteraction(interactionRef.current ?? '', key);
    pendingRef.current = '';
    endedRef.current = true;
    stopTicker();
    setMessages([]);
    setInteractionId(undefined);
    setLastLineId(undefined);
    interactionRef.current = undefined;
    lastLineRef.current = undefined;
    saveChat(scenario.id, { messages: [] });
    setError('');
    setBusy(false);
    setThinking(false);
    setThinkingStatus('');
  };

  const copyAnswer = async (text: string, index: number) => {
    const ok = await copyText(text);
    if (!ok) return;
    setCopiedIndex(index);
    if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopiedIndex(-1), 1500);
  };

  const autoPrimaryId = pickAutoCandidates(availableModels)[0] ?? GEMINI_MODELS[0].id;
  const autoPrimaryLabel =
    availableModels.find((item) => item.id === autoPrimaryId)?.label ??
    GEMINI_MODELS.find((item) => item.id === autoPrimaryId)?.label ??
    autoPrimaryId;

  return (
    <>
      {open ? <div className="ai-backdrop" onClick={onClose} aria-hidden="true" /> : null}

      <aside
        className={open ? 'ai-pane is-open' : 'ai-pane'}
        aria-label="问 AI"
        tabIndex={-1}
        onPointerDownCapture={() => {
          pointerInsideAiRef.current = true;
          window.setTimeout(() => {
            pointerInsideAiRef.current = false;
          }, 0);
        }}
        onFocusCapture={() => {
          onSessionStart?.();
        }}
        onBlurCapture={(event) => {
          if (pointerInsideAiRef.current) return;
          if (confirmDialogRef.current?.open) return;
          if (busy) return;
          const next = event.relatedTarget as Node | null;
          if (next && event.currentTarget.contains(next)) return;
          onSessionEnd?.();
        }}
      >
        <header className="ai-pane-head">
          <strong className="ai-pane-title">问 AI</strong>
          <div className="ai-pane-actions">
            <button
              type="button"
              className="ai-icon-btn"
              onClick={() => setSettingsOpen((value) => !value)}
              aria-label="API Key 设置"
              title="API Key 设置"
            >
              <KeyIcon width={14} height={14} />
            </button>
            {messages.length > 0 ? (
              <button
                type="button"
                className="ai-icon-btn"
                onClick={() => confirmDialogRef.current?.showModal()}
                aria-label="清空当前场景的对话"
                title="清空对话"
              >
                <TrashIcon width={14} height={14} />
              </button>
            ) : null}
            <button type="button" className="ai-close icon-btn" onClick={onClose} aria-label="关闭问 AI">
              <CloseIcon width={15} height={15} />
            </button>
          </div>
        </header>

        <div className="ai-line" lang="ja">
          <span className="ai-line-speaker">{speakerLabel(scenario, line)}</span>
          <p>
            <Furigana text={line.ja} />
          </p>
        </div>

        {settingsOpen || !key ? (
          <form className="ai-settings" onSubmit={submitKey}>
            <div className="ai-field-head">
              <label htmlFor="ai-key">Gemini API Key</label>
              <a
                className="ai-key-link"
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
              >
                获取 Key ↗
              </a>
            </div>
            <div className="ai-key-row">
              <input
                ref={keyInputRef}
                id="ai-key"
                type={showKey ? 'text' : 'password'}
                value={keyDraft}
                onChange={(event) => setKeyDraft(event.target.value)}
                placeholder={key ? '输入新 Key 以替换' : '粘贴 Gemini API Key'}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="ai-key-toggle"
                onClick={() => setShowKey((value) => !value)}
              >
                {showKey ? '隐藏' : '显示'}
              </button>
            </div>

            <div className="ai-model-label-row">
              <label htmlFor="ai-model">模型</label>
              {key || keyDraft.trim() ? (
                <button
                  type="button"
                  className="ai-key-toggle"
                  onClick={refreshModels}
                  disabled={refreshingModels}
                >
                  {refreshingModels ? '刷新中…' : '刷新列表'}
                </button>
              ) : null}
            </div>
            <select
              id="ai-model"
              value={model}
              onChange={(event) => {
                setModel(event.target.value);
                saveModel(event.target.value);
              }}
            >
              <option value={AUTO_MODEL_ID}>
                ✨ 自动优先（首选：{autoPrimaryLabel}）
              </option>
              {availableModels.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
              {model !== AUTO_MODEL_ID && !availableModels.some((item) => item.id === model) ? (
                <option value={model}>{model}</option>
              ) : null}
            </select>
            <div className="ai-settings-actions">
              <button type="submit" className="ai-primary" disabled={!keyDraft.trim()}>
                保存
              </button>
              {key ? (
                <button type="button" className="ai-ghost" onClick={() => setSettingsOpen(false)}>
                  取消
                </button>
              ) : null}
              {key ? (
                <button type="button" className="ai-ghost ai-danger" onClick={clear}>
                  清除
                </button>
              ) : null}
            </div>
          </form>
        ) : (
          <>
            <div
              ref={logRef}
              className="ai-log"
              onScroll={() => {
                const el = logRef.current;
                if (!el) return;
                stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
              }}
            >
              {messages.map((message, index) => {
                if (message.role === 'user') {
                  return (
                    <div key={`u-${index}`} className="ai-msg is-user">
                      <p>{message.text}</p>
                    </div>
                  );
                }
                const isLast = index === messages.length - 1;
                const isLive = busy && isLast;
                if (!message.text && isLive) return null;
                return (
                  <div key={`a-${index}`} className={isLive ? 'ai-msg is-live' : 'ai-msg'}>
                    {renderMarkdown(message.text)}
                    {!isLive ? (
                      <button
                        type="button"
                        className="ai-copy"
                        onClick={() => void copyAnswer(message.text, index)}
                      >
                        <CopyIcon width={12} height={12} />
                        {copiedIndex === index ? '已复制' : '复制'}
                      </button>
                    ) : null}
                  </div>
                );
              })}

              {thinking ? (
                <div className="ai-thinking" role="status" aria-live="polite">
                  <span className="ai-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  {thinkingStatus || '正在解析…'}
                </div>
              ) : null}

              {error ? (
                <p className="ai-error" role="alert">
                  {error}
                </p>
              ) : null}
            </div>

            <div className="ai-composer">
              {pausedByAi ? (
                <div className="ai-resume-row">
                  <button
                    type="button"
                    className="ai-resume-btn"
                    onClick={() => {
                      onSessionEnd?.();
                      onClose();
                    }}
                    title="收起问 AI 并继续播放"
                  >
                    <PlayIcon width={10} height={10} />
                    继续播放
                  </button>
                </div>
              ) : null}
              <form
                className={transcribing ? 'ai-form is-transcribing' : 'ai-form'}
                onSubmit={(event) => {
                  event.preventDefault();
                  void send();
                }}
              >
                <textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                      event.preventDefault();
                      void send();
                    }
                  }}
                  rows={1}
                  placeholder={
                    recording
                      ? '正在聆听（支持中日混说）… 再次点击结束'
                      : transcribing
                        ? '正在识别中日语语音…'
                        : '针对当前句或本场景提问…'
                  }
                  aria-label="输入问题"
                />
                <button
                  type="button"
                  className={
                    recording
                      ? 'ai-mic is-recording'
                      : transcribing
                        ? 'ai-mic is-transcribing'
                        : 'ai-mic'
                  }
                  onClick={() => void toggleVoiceInput()}
                  disabled={transcribing || busy}
                  aria-label={recording ? '结束录音并识别' : transcribing ? '正在识别语音' : '中日语语音输入'}
                  title={recording ? '点击结束录音' : transcribing ? '识别中…' : '语音输入（支持中日混说）'}
                >
                  <MicIcon width={15} height={15} />
                </button>
                {busy ? (
                  <button
                    type="button"
                    className="ai-send is-stop"
                    onClick={stop}
                    aria-label="停止生成"
                    title="停止"
                  >
                    <StopIcon width={14} height={14} />
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="ai-send"
                    disabled={!draft.trim()}
                    aria-label="发送"
                    title="发送"
                  >
                    <SendIcon width={15} height={15} />
                  </button>
                )}
              </form>
            </div>
          </>
        )}

      </aside>

      <dialog
        ref={confirmDialogRef}
        className="ai-confirm-dialog"
        aria-labelledby={confirmTitleId}
        aria-describedby={confirmDescId}
        {...({ closedby: 'any' } as Record<string, string>)}
        onClose={() => {
          const dialog = confirmDialogRef.current;
          if (!dialog) return;
          if (dialog.returnValue === 'confirm') {
            clearChat();
          }
          dialog.returnValue = '';
        }}
      >
        <h2 id={confirmTitleId} className="ai-confirm-title">
          清空当前场景的 AI 对话？
        </h2>
        <p id={confirmDescId} className="ai-confirm-desc">
          将删除本场景下的全部提问与回答记录，操作后无法恢复。
        </p>
        <form method="dialog" className="ai-confirm-actions">
          <button type="submit" value="cancel" className="ai-ghost" autoFocus>
            取消
          </button>
          <button type="submit" value="confirm" className="ai-confirm-danger">
            清空
          </button>
        </form>
      </dialog>
    </>
  );
}
