import type { Line } from '../types';
import { audioSrc } from './audio';

export interface Cue {
  start: number;
  end: number;
}

export interface StitchedTrack {
  blobUrl: string;
  cues: Cue[];
}

function encodeMonoWav(samples: Int16Array, sampleRate: number): Blob {
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataSize, true);

  new Int16Array(buffer, 44).set(samples);
  return new Blob([buffer], { type: 'audio/wav' });
}

function mixToMonoInt16(audioBuffer: AudioBuffer, target: Int16Array, offset: number) {
  const { numberOfChannels, length } = audioBuffer;
  if (numberOfChannels === 1) {
    const ch = audioBuffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      target[offset + i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return;
  }

  const channels = Array.from({ length: numberOfChannels }, (_, c) => audioBuffer.getChannelData(c));
  for (let i = 0; i < length; i += 1) {
    let sum = 0;
    for (let c = 0; c < numberOfChannels; c += 1) {
      sum += channels[c][i];
    }
    const s = Math.max(-1, Math.min(1, sum / numberOfChannels));
    target[offset + i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
}

/**
 * 将一个场景的多句音频在内存中拼接成单条连续 WAV Blob，并记录每句的起止时间戳。
 * 单条长音频可避免安卓锁屏/后台切句时反复调用 audio.load() 导致中断。
 */
export async function buildStitchedTrack(
  sceneId: string,
  lines: Line[],
  gapMs: number,
  signal?: AbortSignal,
): Promise<StitchedTrack | null> {
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx || lines.length === 0) return null;

  const ctx = new AudioCtx();
  try {
    const arrayBuffers = await Promise.all(
      lines.map(async (line) => {
        const res = await fetch(audioSrc(sceneId, line.id), { signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.arrayBuffer();
      }),
    );

    if (signal?.aborted) return null;

    const decoded: AudioBuffer[] = [];
    for (const buf of arrayBuffers) {
      if (signal?.aborted) return null;
      decoded.push(await ctx.decodeAudioData(buf));
    }

    const sampleRate = decoded[0].sampleRate;
    const gapSamples = Math.round((sampleRate * gapMs) / 1000);
    const totalSamples = decoded.reduce((acc, b) => acc + b.length + gapSamples, 0);

    const pcm = new Int16Array(totalSamples);
    const cues: Cue[] = [];
    let offset = 0;

    for (const buf of decoded) {
      mixToMonoInt16(buf, pcm, offset);
      cues.push({
        start: offset / sampleRate,
        end: (offset + buf.length) / sampleRate,
      });
      offset += buf.length + gapSamples;
    }

    const blob = encodeMonoWav(pcm, sampleRate);
    return {
      blobUrl: URL.createObjectURL(blob),
      cues,
    };
  } catch {
    return null;
  } finally {
    ctx.close().catch(() => {});
  }
}

export function findCueIndex(cues: Cue[], currentTime: number): number {
  let matched = 0;
  for (let i = 0; i < cues.length; i += 1) {
    if (currentTime >= cues[i].start - 0.02) {
      matched = i;
    } else {
      break;
    }
  }
  return matched;
}
