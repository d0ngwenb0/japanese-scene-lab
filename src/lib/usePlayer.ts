import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Line, LoopMode } from '../types';
import { audioSrc } from './audio';
import { buildStitchedTrack, findCueIndex, type StitchedTrack } from './stitchedAudio';

interface Options {
  sceneId: string;
  lines: Line[];
  loop: LoopMode;
  rate: number;
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
export function usePlayer({ sceneId, lines, loop, rate, autoPlay = false, onSceneEnd }: Options) {
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

  indexRef.current = index;
  playingRef.current = playing;
  loopRef.current = loop;
  rateRef.current = rate;
  onSceneEndRef.current = onSceneEnd;

  const syncLoopFlag = useCallback(() => {
    if (!audio) return;
    audio.loop = Boolean(stitchedRef.current) && loopRef.current === 'all' && !oneShot.current;
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

  const activateStitched = useCallback(
    (track: StitchedTrack, targetIndex: number, autoplay: boolean) => {
      pendingStitchedSwapRef.current = false;
      inGapRef.current = false;
      internalTransitionRef.current = autoplay;
      const cue = track.cues[Math.min(Math.max(targetIndex, 0), track.cues.length - 1)];
      setSceneDuration(track.cues[track.cues.length - 1]?.end ?? 0);
      setSceneTime(cue.start);
      pendingSeekRef.current = cue.start > 0 ? cue.start : null;
      audio.src = track.blobUrl;
      audio.loop = loopRef.current === 'all' && !oneShot.current;
      audio.playbackRate = rateRef.current;
      audio.load();
      if (autoplay) {
        setPlaying(true);
        safePlay();
      } else {
        setPlaying(false);
      }
    },
    [audio, safePlay],
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
        if (pendingStitchedSwapRef.current || audio.src !== track.blobUrl) {
          activateStitched(track, target, autoplay);
          return;
        }
        syncLoopFlag();
        audio.playbackRate = rateRef.current;
        audio.currentTime = track.cues[target].start;
        setSceneTime(track.cues[target].start);
        if (autoplay) {
          setPlaying(true);
          safePlay();
        } else {
          setPlaying(false);
        }
        return;
      }

      internalTransitionRef.current = autoplay;
      audio.loop = false;
      audio.src = audioSrc(sceneId, lines[target].id);
      audio.load();
      audio.playbackRate = rateRef.current;

      if (autoplay) {
        setPlaying(true);
        safePlay();
      } else {
        setPlaying(false);
      }
    },
    [activateStitched, audio, lines, safePlay, sceneId, syncLoopFlag],
  );

  // 后台将整场音频拼接为单条连续 Blob，实现安卓锁屏/后台零中断播放。
  useEffect(() => {
    const controller = new AbortController();
    let activeTrack: StitchedTrack | null = null;
    stitchedRef.current = null;
    pendingStitchedSwapRef.current = false;
    setSceneDuration(0);
    setSceneTime(0);

    buildStitchedTrack(sceneId, lines, INTER_LINE_GAP_MS, controller.signal).then((track) => {
      if (!track || controller.signal.aborted) {
        if (track) URL.revokeObjectURL(track.blobUrl);
        return;
      }
      activeTrack = track;
      stitchedRef.current = track;
      setSceneDuration(track.cues[track.cues.length - 1]?.end ?? 0);
      if (!playingRef.current) {
        activateStitched(track, indexRef.current, false);
      } else {
        pendingStitchedSwapRef.current = true;
      }
    });

    return () => {
      controller.abort();
      stitchedRef.current = null;
      pendingStitchedSwapRef.current = false;
      if (activeTrack) URL.revokeObjectURL(activeTrack.blobUrl);
    };
  }, [activateStitched, lines, sceneId]);

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
    syncLoopFlag();
  }, [loop, syncLoopFlag]);

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
      if (pendingSeekRef.current !== null) {
        a.currentTime = pendingSeekRef.current;
        pendingSeekRef.current = null;
      }
    };

    const onTime = () => {
      const track = stitchedRef.current;
      if (track && a.src === track.blobUrl) {
        const t = a.currentTime;
        if (oneShot.current) {
          const targetCue = track.cues[oneShotTargetRef.current];
          if (targetCue && t >= targetCue.end) {
            oneShot.current = false;
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

  const play = useCallback(() => {
    if (!audio) return;
    oneShot.current = false;
    syncLoopFlag();
    if (inGapRef.current) {
      inGapRef.current = false;
      advance();
      return;
    }
    setPlaying(true);
    safePlay();
  }, [advance, audio, safePlay, syncLoopFlag]);

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
    oneShot.current = false;
    syncLoopFlag();
    if (inGapRef.current) {
      inGapRef.current = false;
      advance();
      return;
    }
    setPlaying(true);
    safePlay();
  }, [advance, audio, safePlay, syncLoopFlag]);

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
    if (track && audio.src === track.blobUrl) {
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
        if (nextIdx < lines.length) activateStitched(stitchedRef.current, nextIdx, true);
        else if (loopRef.current === 'all') activateStitched(stitchedRef.current, 0, true);
        else if (loopRef.current === 'scenes') onSceneEndRef.current?.();
        else setPlaying(false);
        return;
      }
      advance();
      return;
    }

    if (oneShot.current) {
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
  }, [activateStitched, advance, audio, lines.length, safePlay]);

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
