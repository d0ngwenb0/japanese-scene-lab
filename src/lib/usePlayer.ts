import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Line, LoopMode } from '../types';
import { audioSrc } from './audio';
import { buildStitchedTrack, findCueIndex, type StitchedTrack } from './stitchedAudio';

interface Options {
  sceneId: string;
  lines: Line[];
  loop: LoopMode;
  rate: number;
  volume?: number;
  autoPlay?: boolean;
  onSceneEnd?: () => void;
}

const INTER_LINE_GAP_MS = 260;

/**
 * 生成一段指定时长的静音 PCM WAV data URL。
 * 作为单条拼接音频未就绪或降级时的句间保活停顿。
 */
function createSilentWavDataUrl(durationMs: number): string {
  const sampleRate = 8000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const numSamples = Math.round((sampleRate * durationMs) / 1000);
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) {
      bytes[offset + i] = text.charCodeAt(i);
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
  view.setUint16(32, numChannels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataSize, true);

  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}

const SILENCE_GAP_URL = createSilentWavDataUrl(INTER_LINE_GAP_MS);

const sharedAudio = typeof Audio !== 'undefined' ? new Audio() : null;
const sharedPreloadAudio =
  typeof Audio !== 'undefined'
    ? (() => {
        const a = new Audio();
        a.preload = 'auto';
        return a;
      })()
    : null;

/**
 * 单条 <audio> 的播放状态机：
 * - 优先在内存中将整场音频拼接为单条连续 WAV Blob，锁屏/后台零切源、零 load()
 * - 跨场景切换复用同一个已解锁的 <audio> 实例，保证随机切场自动续播不被浏览器拦截
 * - 拼接未完成或环境不支持时无缝降级为逐句播放
 */
export function usePlayer({ sceneId, lines, loop, rate, volume = 1, autoPlay = false, onSceneEnd }: Options) {
  const audio = useMemo(() => sharedAudio ?? new Audio(), []);
  const preloadAudio = useMemo(() => {
    if (sharedPreloadAudio) return sharedPreloadAudio;
    const a = new Audio();
    a.preload = 'auto';
    return a;
  }, []);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(autoPlay);
  const [lineProgress, setLineProgress] = useState(0);
  const [sceneTime, setSceneTime] = useState(0);
  const [sceneDuration, setSceneDuration] = useState(0);
  const [missing, setMissing] = useState(false);

  const indexRef = useRef(index);
  const playingRef = useRef(playing);
  const loopRef = useRef(loop);
  const rateRef = useRef(rate);
  const onSceneEndRef = useRef(onSceneEnd);
  const oneShot = useRef(false);
  const oneShotTargetRef = useRef(0);
  const inGapRef = useRef(false);
  const internalTransitionRef = useRef(false);
  const stitchedRef = useRef<StitchedTrack | null>(null);
  const pendingStitchedSwapRef = useRef(false);
  const pendingSeekRef = useRef<number | null>(null);
  const sourceModeRef = useRef<
    { kind: 'fallback' } | { kind: 'stitched' } | { kind: 'single'; index: number; loopGap: boolean }
  >({ kind: 'fallback' });

  indexRef.current = index;
  playingRef.current = playing;
  loopRef.current = loop;
  rateRef.current = rate;
  onSceneEndRef.current = onSceneEnd;

  const syncLoopFlag = useCallback(() => {
    if (!audio) return;
    const mode = sourceModeRef.current;
    if (mode.kind === 'single') {
      audio.loop = mode.loopGap && !oneShot.current;
    } else if (mode.kind === 'stitched') {
      audio.loop = Boolean(stitchedRef.current) && loopRef.current === 'all' && !oneShot.current;
    } else {
      audio.loop = false;
    }
  }, [audio]);

  const safePlay = useCallback(() => {
    if (!audio) return;
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) {
      try {
        nav.audioSession.type = 'playback';
      } catch {
        // 忽略不支持写入 audioSession 的环境。
      }
    }
    const result = audio.play();
    if (result) {
      result.catch((error: DOMException) => {
        if (error?.name !== 'AbortError') {
          internalTransitionRef.current = false;
          setPlaying(false);
        }
      });
    }
  }, [audio]);

  const loadStitchedAt = useCallback(
    (track: StitchedTrack, targetIndex: number, offsetSec: number, autoplay: boolean) => {
      pendingStitchedSwapRef.current = false;
      inGapRef.current = false;
      sourceModeRef.current = { kind: 'stitched' };
      const clampedIndex = Math.min(Math.max(targetIndex, 0), track.cues.length - 1);
      const cue = track.cues[clampedIndex];
      const total = track.cues[track.cues.length - 1]?.end ?? 0;
      const lineDur = Math.max(cue.end - cue.start, 0.01);
      const safeOffset = Math.min(Math.max(offsetSec, 0), lineDur);
      const seekTime = cue.start + safeOffset;

      setSceneDuration(total);
      setSceneTime(Math.min(seekTime, total));
      audio.loop = loopRef.current === 'all' && !oneShot.current;
      audio.playbackRate = rateRef.current;

      if (audio.src !== track.blobUrl) {
        internalTransitionRef.current = true;
        pendingSeekRef.current = seekTime > 0 ? seekTime : null;
        audio.src = track.blobUrl;
        audio.load();
      } else if (audio.readyState < 1) {
        pendingSeekRef.current = seekTime > 0 ? seekTime : null;
      } else {
        pendingSeekRef.current = null;
        audio.currentTime = seekTime;
      }

      if (autoplay) {
        internalTransitionRef.current = true;
        setPlaying(true);
        safePlay();
      } else {
        internalTransitionRef.current = false;
        setPlaying(false);
      }
    },
    [audio, safePlay],
  );

  const loadSingleLine = useCallback(
    (track: StitchedTrack, targetIndex: number, loopGap: boolean, offsetSec: number, autoplay: boolean) => {
      pendingStitchedSwapRef.current = false;
      inGapRef.current = false;
      const clampedIndex = Math.min(Math.max(targetIndex, 0), track.cues.length - 1);
      const cue = track.cues[clampedIndex];
      const total = track.cues[track.cues.length - 1]?.end ?? 0;
      const lineDur = Math.max(cue.end - cue.start, 0.01);
      const safeOffset = Math.min(Math.max(offsetSec, 0), lineDur);
      const url = track.getLineBlobUrl(clampedIndex, loopGap);

      sourceModeRef.current = { kind: 'single', index: clampedIndex, loopGap };
      setSceneDuration(total);
      setSceneTime(Math.min(cue.start + safeOffset, total));
      audio.loop = loopGap;
      audio.playbackRate = rateRef.current;

      if (audio.src !== url) {
        internalTransitionRef.current = true;
        pendingSeekRef.current = safeOffset > 0 ? safeOffset : null;
        audio.src = url;
        audio.load();
      } else if (audio.readyState < 1) {
        pendingSeekRef.current = safeOffset > 0 ? safeOffset : null;
      } else {
        pendingSeekRef.current = null;
        audio.currentTime = safeOffset;
      }

      if (autoplay) {
        internalTransitionRef.current = true;
        setPlaying(true);
        safePlay();
      } else {
        internalTransitionRef.current = false;
        setPlaying(false);
      }
    },
    [audio, safePlay],
  );

  const getCurrentLineOffset = useCallback(
    (track: StitchedTrack, targetIndex: number): number => {
      const cue = track.cues[targetIndex];
      if (!cue || audio.ended) return 0;
      const lineDur = Math.max(cue.end - cue.start, 0.01);
      const mode = sourceModeRef.current;
      let offset = 0;
      if (mode.kind === 'single' && mode.index === targetIndex) {
        offset = audio.currentTime;
      } else if (mode.kind === 'stitched' && audio.src === track.blobUrl) {
        offset = audio.currentTime - cue.start;
      }
      if (!Number.isFinite(offset) || offset <= 0 || offset >= lineDur - 0.05) {
        return 0;
      }
      return offset;
    },
    [audio],
  );

  /** 载入第 i 句；同一句会从头重放。 */
  const jump = useCallback(
    (i: number, autoplay: boolean) => {
      inGapRef.current = false;
      const target = Math.min(Math.max(i, 0), lines.length - 1);
      setLineProgress(0);
      setMissing(false);
      setIndex(target);

      if (!audio) {
        internalTransitionRef.current = false;
        setPlaying(false);
        return;
      }

      const track = stitchedRef.current;
      if (track) {
        if (oneShot.current) {
          loadSingleLine(track, target, false, 0, autoplay);
        } else if (loopRef.current === 'line') {
          loadSingleLine(track, target, true, 0, autoplay);
        } else {
          loadStitchedAt(track, target, 0, autoplay);
        }
        return;
      }

      sourceModeRef.current = { kind: 'fallback' };
      internalTransitionRef.current = true;
      audio.loop = false;
      audio.src = audioSrc(sceneId, lines[target].id);
      audio.load();
      audio.playbackRate = rateRef.current;

      if (autoplay) {
        setPlaying(true);
        safePlay();
      } else {
        internalTransitionRef.current = false;
        setPlaying(false);
      }
    },
    [audio, lines, loadSingleLine, loadStitchedAt, safePlay, sceneId],
  );

  // 后台将整场音频拼接为单条连续 Blob，实现安卓锁屏/后台零中断播放。
  useEffect(() => {
    const controller = new AbortController();
    let activeTrack: StitchedTrack | null = null;
    stitchedRef.current = null;
    pendingStitchedSwapRef.current = false;
    pendingSeekRef.current = null;
    sourceModeRef.current = { kind: 'fallback' };
    setSceneDuration(0);
    setSceneTime(0);

    buildStitchedTrack(sceneId, lines, INTER_LINE_GAP_MS, controller.signal).then((track) => {
      if (!track || controller.signal.aborted) {
        if (track) track.dispose();
        return;
      }
      activeTrack = track;
      stitchedRef.current = track;
      setSceneDuration(track.cues[track.cues.length - 1]?.end ?? 0);
      if (!playingRef.current) {
        if (oneShot.current) {
          loadSingleLine(track, indexRef.current, false, 0, false);
        } else if (loopRef.current === 'line') {
          loadSingleLine(track, indexRef.current, true, 0, false);
        } else {
          loadStitchedAt(track, indexRef.current, 0, false);
        }
      } else {
        pendingStitchedSwapRef.current = true;
      }
    });

    return () => {
      controller.abort();
      stitchedRef.current = null;
      pendingStitchedSwapRef.current = false;
      pendingSeekRef.current = null;
      sourceModeRef.current = { kind: 'fallback' };
      if (activeTrack) activeTrack.dispose();
    };
  }, [lines, loadSingleLine, loadStitchedAt, sceneId]);

  // 首次进入只载入，不自动播放；若由「所有场景随机循环」切入，则自动续播。
  useEffect(() => {
    if (audio) jump(0, autoPlay);
    else setIndex(0);
    return () => {
      inGapRef.current = false;
      internalTransitionRef.current = true;
      audio?.pause();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio]);

  useEffect(() => {
    if (!playing) {
      internalTransitionRef.current = true;
      audio?.pause();
      internalTransitionRef.current = false;
    }
  }, [playing, audio]);

  useEffect(() => {
    if (loop === 'line' && playingRef.current) {
      oneShot.current = false;
    }
    const track = stitchedRef.current;
    if (!track || !audio) {
      syncLoopFlag();
      return;
    }
    const mode = sourceModeRef.current;
    if (loop === 'line') {
      if (!(mode.kind === 'single' && mode.index === indexRef.current && mode.loopGap && !pendingStitchedSwapRef.current)) {
        const offset = getCurrentLineOffset(track, indexRef.current);
        loadSingleLine(track, indexRef.current, true, offset, playingRef.current);
        return;
      }
    } else if (mode.kind === 'single' && !oneShot.current) {
      const offset = getCurrentLineOffset(track, indexRef.current);
      loadStitchedAt(track, indexRef.current, offset, playingRef.current);
      return;
    }
    syncLoopFlag();
  }, [audio, getCurrentLineOffset, loadSingleLine, loadStitchedAt, loop, syncLoopFlag]);

  useEffect(() => {
    if (stitchedRef.current) {
      preloadAudio.removeAttribute('src');
      return;
    }
    const nextLine = lines[index + 1];
    if (!nextLine) {
      preloadAudio.removeAttribute('src');
      return;
    }
    preloadAudio.src = audioSrc(sceneId, nextLine.id);
    preloadAudio.load();
  }, [preloadAudio, sceneId, lines, index]);

  useEffect(() => {
    return () => {
      preloadAudio.removeAttribute('src');
    };
  }, [preloadAudio]);

  useEffect(() => {
    if (audio && !inGapRef.current) audio.playbackRate = rate;
  }, [rate, audio]);

  useEffect(() => {
    if (!audio) return;
    const clamped = Math.min(1, Math.max(0, volume));
    audio.muted = clamped === 0;
    audio.volume = clamped;
  }, [volume, audio]);

  const advance = useCallback(() => {
    const i = indexRef.current;
    const last = lines.length - 1;
    if (i < last) jump(i + 1, true);
    else if (loopRef.current === 'all') jump(0, true);
    else if (loopRef.current === 'scenes') onSceneEndRef.current?.();
    else setPlaying(false);
  }, [jump, lines.length]);

  useEffect(() => {
    const a = audio;
    if (!a) return;

    const onLoadedMetadata = () => {
      a.playbackRate = rateRef.current;
      if (pendingSeekRef.current !== null) {
        a.currentTime = pendingSeekRef.current;
        pendingSeekRef.current = null;
      }
    };

    const onTime = () => {
      const track = stitchedRef.current;
      const mode = sourceModeRef.current;
      if (track && mode.kind === 'single') {
        if (a.seeking || pendingSeekRef.current !== null) return;
        const cue = track.cues[mode.index];
        if (!cue) return;
        const dur = Math.max(cue.end - cue.start, 0.01);
        const clamped = Math.min(Math.max(a.currentTime, 0), dur);
        setLineProgress(clamped / dur);
        const total = track.cues[track.cues.length - 1]?.end ?? 0;
        if (total > 0) setSceneDuration(total);
        setSceneTime(Math.min(cue.start + clamped, total || cue.start + clamped));
        return;
      }

      if (track && mode.kind === 'stitched' && a.src === track.blobUrl) {
        if (a.seeking || pendingSeekRef.current !== null) return;
        const t = a.currentTime;
        if (oneShot.current) {
          const targetCue = track.cues[oneShotTargetRef.current];
          if (targetCue && t >= targetCue.end) {
            oneShot.current = false;
            internalTransitionRef.current = true;
            a.pause();
            internalTransitionRef.current = false;
            setPlaying(false);
            setLineProgress(0);
            a.currentTime = targetCue.start;
            return;
          }
        } else if (loopRef.current === 'line') {
          const curCue = track.cues[indexRef.current];
          if (curCue && t >= curCue.end) {
            a.currentTime = curCue.start;
            setLineProgress(0);
            return;
          }
        }

        const cueIdx = findCueIndex(track.cues, t);
        if (cueIdx !== indexRef.current) {
          setIndex(cueIdx);
        }
        const cue = track.cues[cueIdx];
        const dur = Math.max(cue.end - cue.start, 0.01);
        setLineProgress(Math.min(Math.max((t - cue.start) / dur, 0), 1));
        const total = track.cues[track.cues.length - 1]?.end ?? 0;
        if (total > 0) setSceneDuration(total);
        setSceneTime(Math.min(Math.max(t, 0), total || t));
        return;
      }

      if (inGapRef.current) return;
      setLineProgress(a.duration > 0 ? Math.min(a.currentTime / a.duration, 1) : 0);
    };

    const onPlaying = () => {
      internalTransitionRef.current = false;
      a.playbackRate = rateRef.current;
    };

    const onPause = () => {
      if (!internalTransitionRef.current && !a.ended && playingRef.current) {
        setPlaying(false);
      }
    };

    const onError = () => {
      internalTransitionRef.current = false;
      if (inGapRef.current) {
        inGapRef.current = false;
        advance();
        return;
      }
      setMissing(true);
      setPlaying(false);
    };

    a.addEventListener('loadedmetadata', onLoadedMetadata);
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('playing', onPlaying);
    a.addEventListener('pause', onPause);
    a.addEventListener('error', onError);
    return () => {
      a.removeEventListener('loadedmetadata', onLoadedMetadata);
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('playing', onPlaying);
      a.removeEventListener('pause', onPause);
      a.removeEventListener('error', onError);
    };
  }, [audio, advance]);

  const startContinuousOrLoopLine = useCallback(() => {
    if (!audio) return;
    oneShot.current = false;
    const track = stitchedRef.current;
    if (track) {
      const targetIndex = indexRef.current;
      const mode = sourceModeRef.current;
      if (loopRef.current === 'line') {
        const loopUrl = track.getLineBlobUrl(targetIndex, true);
        if (mode.kind === 'single' && mode.index === targetIndex && mode.loopGap && !pendingStitchedSwapRef.current && audio.src === loopUrl) {
          syncLoopFlag();
          setPlaying(true);
          safePlay();
          return;
        }
        loadSingleLine(track, targetIndex, true, getCurrentLineOffset(track, targetIndex), true);
        return;
      }
      if (mode.kind === 'stitched' && !pendingStitchedSwapRef.current && audio.src === track.blobUrl) {
        syncLoopFlag();
        setPlaying(true);
        safePlay();
        return;
      }
      loadStitchedAt(track, targetIndex, getCurrentLineOffset(track, targetIndex), true);
      return;
    }

    syncLoopFlag();
    if (inGapRef.current) {
      inGapRef.current = false;
      advance();
      return;
    }
    setPlaying(true);
    safePlay();
  }, [advance, audio, getCurrentLineOffset, loadSingleLine, loadStitchedAt, safePlay, syncLoopFlag]);

  const play = useCallback(() => {
    startContinuousOrLoopLine();
  }, [startContinuousOrLoopLine]);

  const toggle = useCallback(() => {
    if (playingRef.current) setPlaying(false);
    else play();
  }, [play]);

  const pause = useCallback(() => {
    if (!playingRef.current) return false;
    setPlaying(false);
    return true;
  }, []);

  const resume = useCallback(() => {
    if (!audio || playingRef.current) return;
    startContinuousOrLoopLine();
  }, [audio, startContinuousOrLoopLine]);

  const select = useCallback(
    (i: number) => {
      oneShot.current = true;
      oneShotTargetRef.current = i;
      jump(i, true);
    },
    [jump],
  );

  const next = useCallback(() => {
    oneShot.current = false;
    jump((indexRef.current + 1) % lines.length, true);
  }, [jump, lines.length]);

  const prev = useCallback(() => {
    oneShot.current = false;
    jump((indexRef.current - 1 + lines.length) % lines.length, true);
  }, [jump, lines.length]);

  const replay = useCallback(() => {
    oneShot.current = loopRef.current === 'off';
    oneShotTargetRef.current = indexRef.current;
    jump(indexRef.current, true);
  }, [jump]);

  const handleEnded = useCallback(() => {
    if (!playingRef.current) return;

    const track = stitchedRef.current;
    const mode = sourceModeRef.current;
    if (track && mode.kind === 'single') {
      if (oneShot.current) {
        oneShot.current = false;
        setPlaying(false);
        setLineProgress(0);
        audio.currentTime = 0;
        setSceneTime(track.cues[mode.index]?.start ?? 0);
        return;
      }
      if (loopRef.current === 'line') {
        audio.currentTime = 0;
        safePlay();
        return;
      }
      setPlaying(false);
      setLineProgress(0);
      return;
    }

    if (track && mode.kind === 'stitched' && audio.src === track.blobUrl) {
      if (oneShot.current) {
        oneShot.current = false;
        setPlaying(false);
        return;
      }
      if (loopRef.current === 'line') {
        audio.currentTime = track.cues[indexRef.current].start;
        safePlay();
        return;
      }
      if (loopRef.current === 'all') {
        audio.currentTime = 0;
        safePlay();
        return;
      }
      if (loopRef.current === 'scenes') {
        onSceneEndRef.current?.();
        return;
      }
      setPlaying(false);
      setLineProgress(0);
      return;
    }

    if (inGapRef.current) {
      inGapRef.current = false;
      if (pendingStitchedSwapRef.current && stitchedRef.current) {
        const nextIdx = indexRef.current + 1;
        if (loopRef.current === 'line') {
          const targetIdx = Math.min(nextIdx, lines.length - 1);
          setIndex(targetIdx);
          loadSingleLine(stitchedRef.current, targetIdx, true, 0, true);
        } else if (nextIdx < lines.length) {
          setIndex(nextIdx);
          loadStitchedAt(stitchedRef.current, nextIdx, 0, true);
        } else if (loopRef.current === 'all') {
          setIndex(0);
          loadStitchedAt(stitchedRef.current, 0, 0, true);
        } else if (loopRef.current === 'scenes') {
          onSceneEndRef.current?.();
        } else {
          setPlaying(false);
        }
        return;
      }
      advance();
      return;
    }

    if (oneShot.current) {
      oneShot.current = false;
      setPlaying(false);
      return;
    }
    if (loopRef.current === 'line') {
      if (audio) {
        audio.currentTime = 0;
        safePlay();
      }
      return;
    }
    const i = indexRef.current;
    const last = lines.length - 1;
    if (i >= last) {
      if (loopRef.current === 'scenes') {
        onSceneEndRef.current?.();
        return;
      }
      if (loopRef.current !== 'all') {
        setPlaying(false);
        return;
      }
    }
    if (!audio) return;
    inGapRef.current = true;
    internalTransitionRef.current = true;
    audio.src = SILENCE_GAP_URL;
    audio.playbackRate = 1;
    audio.load();
    safePlay();
  }, [advance, audio, lines.length, loadSingleLine, loadStitchedAt, safePlay]);

  useEffect(() => {
    const a = audio;
    if (!a) return;
    a.addEventListener('ended', handleEnded);
    return () => a.removeEventListener('ended', handleEnded);
  }, [audio, handleEnded]);

  return {
    index,
    playing,
    lineProgress,
    sceneTime,
    sceneDuration,
    missing,
    toggle,
    pause,
    resume,
    select,
    next,
    prev,
    replay,
  };
}
