import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SceneLesson } from '../types';
import { lessonAudioSrc } from './lessons';
import { buildStitchedTrackFromUrls, findCueIndex, type StitchedTrack } from './stitchedAudio';

export type LessonLoopMode = 'off' | 'section' | 'all';

interface Options {
  lesson: SceneLesson | null;
  rate: number;
  volume?: number;
  active: boolean;
  onPlayStart?: () => void;
}

const INTER_SECTION_GAP_MS = 450;

export function useLessonPlayer({ lesson, rate, volume = 1, active, onPlayStart }: Options) {
  const audio = useMemo(() => (typeof Audio !== 'undefined' ? new Audio() : null), []);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState<LessonLoopMode>('off');
  const [sectionProgress, setSectionProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [missing, setMissing] = useState(false);
  const [activatedSceneId, setActivatedSceneId] = useState<string | null>(null);

  const sectionIndexRef = useRef(sectionIndex);
  const playingRef = useRef(playing);
  const loopRef = useRef(loop);
  const rateRef = useRef(rate);
  const lessonRef = useRef(lesson);
  const onPlayStartRef = useRef(onPlayStart);

  const stitchedRef = useRef<StitchedTrack | null>(null);
  const pendingSwapRef = useRef(false);
  const pendingSeekRef = useRef<number | null>(null);
  const internalTransitionRef = useRef(false);
  const sourceModeRef = useRef<
    { kind: 'fallback' } | { kind: 'stitched' } | { kind: 'single'; index: number }
  >({ kind: 'fallback' });

  sectionIndexRef.current = sectionIndex;
  playingRef.current = playing;
  loopRef.current = loop;
  rateRef.current = rate;
  lessonRef.current = lesson;
  onPlayStartRef.current = onPlayStart;

  useEffect(() => {
    if (active && lesson && activatedSceneId !== lesson.sceneId) {
      setActivatedSceneId(lesson.sceneId);
    }
  }, [active, activatedSceneId, lesson]);

  useEffect(() => {
    setSectionIndex(0);
    setPlaying(false);
    setSectionProgress(0);
    setCurrentTime(0);
    setDuration(0);
    setMissing(false);
    pendingSwapRef.current = false;
    pendingSeekRef.current = null;
    sourceModeRef.current = { kind: 'fallback' };
    if (audio) {
      internalTransitionRef.current = true;
      audio.pause();
      audio.removeAttribute('src');
      internalTransitionRef.current = false;
    }
  }, [audio, lesson?.sceneId]);

  useEffect(() => {
    if (!active && playingRef.current) {
      setPlaying(false);
    }
  }, [active]);

  const syncLoopFlag = useCallback(() => {
    if (!audio) return;
    const mode = sourceModeRef.current;
    if (mode.kind === 'single') {
      audio.loop = true;
    } else if (mode.kind === 'stitched') {
      audio.loop = Boolean(stitchedRef.current) && loopRef.current === 'all';
    } else {
      audio.loop = false;
    }
  }, [audio]);

  const safePlay = useCallback(() => {
    if (!audio) return;
    onPlayStartRef.current?.();
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
      if (!audio) return;
      pendingSwapRef.current = false;
      sourceModeRef.current = { kind: 'stitched' };
      const clampedIndex = Math.min(Math.max(targetIndex, 0), track.cues.length - 1);
      const cue = track.cues[clampedIndex];
      const total = track.cues[track.cues.length - 1]?.end ?? 0;
      const segDur = Math.max(cue.end - cue.start, 0.01);
      const safeOffset = Math.min(Math.max(offsetSec, 0), segDur);
      const seekTime = cue.start + safeOffset;

      setDuration(total);
      setCurrentTime(Math.min(seekTime, total));
      setSectionProgress(safeOffset / segDur);
      audio.loop = loopRef.current === 'all';
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

  const loadSingleSection = useCallback(
    (track: StitchedTrack, targetIndex: number, offsetSec: number, autoplay: boolean) => {
      if (!audio) return;
      pendingSwapRef.current = false;
      const clampedIndex = Math.min(Math.max(targetIndex, 0), track.cues.length - 1);
      const cue = track.cues[clampedIndex];
      const total = track.cues[track.cues.length - 1]?.end ?? 0;
      const segDur = Math.max(cue.end - cue.start, 0.01);
      const safeOffset = Math.min(Math.max(offsetSec, 0), segDur);
      const url = track.getLineBlobUrl(clampedIndex, true);

      sourceModeRef.current = { kind: 'single', index: clampedIndex };
      setDuration(total);
      setCurrentTime(Math.min(cue.start + safeOffset, total));
      setSectionProgress(safeOffset / segDur);
      audio.loop = true;
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

  const getCurrentSectionOffset = useCallback(
    (track: StitchedTrack, targetIndex: number): number => {
      if (!audio || audio.ended) return 0;
      const cue = track.cues[targetIndex];
      if (!cue) return 0;
      const segDur = Math.max(cue.end - cue.start, 0.01);
      const mode = sourceModeRef.current;
      let offset = 0;
      if (mode.kind === 'single' && mode.index === targetIndex) {
        offset = audio.currentTime;
      } else if (mode.kind === 'stitched' && audio.src === track.blobUrl) {
        offset = audio.currentTime - cue.start;
      }
      if (!Number.isFinite(offset) || offset <= 0 || offset >= segDur - 0.05) {
        return 0;
      }
      return offset;
    },
    [audio],
  );

  const jumpSection = useCallback(
    (i: number, autoplay: boolean) => {
      const currentLesson = lessonRef.current;
      if (!currentLesson || currentLesson.sections.length === 0) return;
      const target = Math.min(Math.max(i, 0), currentLesson.sections.length - 1);
      setMissing(false);
      setSectionProgress(0);
      setSectionIndex(target);

      if (!audio) {
        internalTransitionRef.current = false;
        setPlaying(false);
        return;
      }

      const track = stitchedRef.current;
      if (track) {
        if (loopRef.current === 'section') {
          loadSingleSection(track, target, 0, autoplay);
        } else {
          loadStitchedAt(track, target, 0, autoplay);
        }
        return;
      }

      sourceModeRef.current = { kind: 'fallback' };
      internalTransitionRef.current = true;
      audio.loop = false;
      audio.src = lessonAudioSrc(currentLesson.sceneId, currentLesson.sections[target].id);
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
    [audio, loadSingleSection, loadStitchedAt, safePlay],
  );

  useEffect(() => {
    if (!lesson || activatedSceneId !== lesson.sceneId || lesson.sections.length === 0) return;

    const controller = new AbortController();
    let activeTrack: StitchedTrack | null = null;
    stitchedRef.current = null;
    pendingSwapRef.current = false;
    pendingSeekRef.current = null;
    sourceModeRef.current = { kind: 'fallback' };

    const urls = lesson.sections.map((section) => lessonAudioSrc(lesson.sceneId, section.id));
    buildStitchedTrackFromUrls(urls, INTER_SECTION_GAP_MS, controller.signal).then((track) => {
      if (!track || controller.signal.aborted) {
        if (track) track.dispose();
        return;
      }
      activeTrack = track;
      stitchedRef.current = track;
      setDuration(track.cues[track.cues.length - 1]?.end ?? 0);
      if (!playingRef.current) {
        if (loopRef.current === 'section') {
          loadSingleSection(track, sectionIndexRef.current, 0, false);
        } else {
          loadStitchedAt(track, sectionIndexRef.current, 0, false);
        }
      } else {
        pendingSwapRef.current = true;
      }
    });

    return () => {
      controller.abort();
      stitchedRef.current = null;
      pendingSwapRef.current = false;
      pendingSeekRef.current = null;
      sourceModeRef.current = { kind: 'fallback' };
      if (activeTrack) activeTrack.dispose();
    };
  }, [activatedSceneId, lesson, loadSingleSection, loadStitchedAt]);

  useEffect(() => {
    if (!playing && audio) {
      internalTransitionRef.current = true;
      audio.pause();
      internalTransitionRef.current = false;
    }
  }, [audio, playing]);

  useEffect(() => {
    if (!audio) return;
    audio.playbackRate = rate;
  }, [audio, rate]);

  useEffect(() => {
    if (!audio) return;
    const clamped = Math.min(1, Math.max(0, volume));
    audio.muted = clamped === 0;
    audio.volume = clamped;
  }, [audio, volume]);

  useEffect(() => {
    const track = stitchedRef.current;
    if (!track || !audio) {
      syncLoopFlag();
      return;
    }
    const mode = sourceModeRef.current;
    if (loop === 'section') {
      if (!(mode.kind === 'single' && mode.index === sectionIndexRef.current && !pendingSwapRef.current)) {
        const offset = getCurrentSectionOffset(track, sectionIndexRef.current);
        loadSingleSection(track, sectionIndexRef.current, offset, playingRef.current);
        return;
      }
    } else if (mode.kind === 'single') {
      const offset = getCurrentSectionOffset(track, sectionIndexRef.current);
      loadStitchedAt(track, sectionIndexRef.current, offset, playingRef.current);
      return;
    }
    syncLoopFlag();
  }, [audio, getCurrentSectionOffset, loadSingleSection, loadStitchedAt, loop, syncLoopFlag]);

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
        setSectionProgress(clamped / dur);
        const total = track.cues[track.cues.length - 1]?.end ?? 0;
        if (total > 0) setDuration(total);
        setCurrentTime(Math.min(cue.start + clamped, total || cue.start + clamped));
        return;
      }

      if (track && mode.kind === 'stitched' && a.src === track.blobUrl) {
        if (a.seeking || pendingSeekRef.current !== null) return;
        const t = a.currentTime;
        const cueIdx = findCueIndex(track.cues, t);
        if (cueIdx !== sectionIndexRef.current) {
          setSectionIndex(cueIdx);
        }
        const cue = track.cues[cueIdx];
        const dur = Math.max(cue.end - cue.start, 0.01);
        setSectionProgress(Math.min(Math.max((t - cue.start) / dur, 0), 1));
        const total = track.cues[track.cues.length - 1]?.end ?? 0;
        if (total > 0) setDuration(total);
        setCurrentTime(Math.min(Math.max(t, 0), total || t));
        return;
      }

      setSectionProgress(a.duration > 0 ? Math.min(a.currentTime / a.duration, 1) : 0);
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
      setMissing(true);
      setPlaying(false);
    };

    const onEnded = () => {
      if (!playingRef.current) return;
      const currentLesson = lessonRef.current;
      if (!currentLesson) return;

      const track = stitchedRef.current;
      const mode = sourceModeRef.current;
      if (track && mode.kind === 'single') {
        if (loopRef.current === 'section') {
          a.currentTime = 0;
          safePlay();
          return;
        }
        setPlaying(false);
        setSectionProgress(0);
        return;
      }

      if (track && mode.kind === 'stitched' && a.src === track.blobUrl) {
        if (loopRef.current === 'all') {
          a.currentTime = 0;
          safePlay();
          return;
        }
        setPlaying(false);
        setSectionProgress(0);
        return;
      }

      if (pendingSwapRef.current && track) {
        const nextIdx = sectionIndexRef.current + 1;
        if (loopRef.current === 'section') {
          loadSingleSection(track, sectionIndexRef.current, 0, true);
        } else if (nextIdx < currentLesson.sections.length) {
          setSectionIndex(nextIdx);
          loadStitchedAt(track, nextIdx, 0, true);
        } else if (loopRef.current === 'all') {
          setSectionIndex(0);
          loadStitchedAt(track, 0, 0, true);
        } else {
          setPlaying(false);
        }
        return;
      }

      if (loopRef.current === 'section') {
        a.currentTime = 0;
        safePlay();
        return;
      }

      const nextIdx = sectionIndexRef.current + 1;
      if (nextIdx < currentLesson.sections.length) {
        jumpSection(nextIdx, true);
      } else if (loopRef.current === 'all') {
        jumpSection(0, true);
      } else {
        setPlaying(false);
      }
    };

    a.addEventListener('loadedmetadata', onLoadedMetadata);
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('playing', onPlaying);
    a.addEventListener('pause', onPause);
    a.addEventListener('error', onError);
    a.addEventListener('ended', onEnded);
    return () => {
      a.removeEventListener('loadedmetadata', onLoadedMetadata);
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('playing', onPlaying);
      a.removeEventListener('pause', onPause);
      a.removeEventListener('error', onError);
      a.removeEventListener('ended', onEnded);
    };
  }, [audio, jumpSection, loadSingleSection, loadStitchedAt, safePlay]);

  const play = useCallback(() => {
    if (!audio || !lessonRef.current) return;
    const track = stitchedRef.current;
    if (track) {
      const targetIndex = sectionIndexRef.current;
      const mode = sourceModeRef.current;
      if (loopRef.current === 'section') {
        const url = track.getLineBlobUrl(targetIndex, true);
        if (mode.kind === 'single' && mode.index === targetIndex && !pendingSwapRef.current && audio.src === url) {
          syncLoopFlag();
          setPlaying(true);
          safePlay();
          return;
        }
        loadSingleSection(track, targetIndex, getCurrentSectionOffset(track, targetIndex), true);
        return;
      }
      if (mode.kind === 'stitched' && !pendingSwapRef.current && audio.src === track.blobUrl) {
        syncLoopFlag();
        setPlaying(true);
        safePlay();
        return;
      }
      loadStitchedAt(track, targetIndex, getCurrentSectionOffset(track, targetIndex), true);
      return;
    }

    if (!audio.getAttribute('src')) {
      jumpSection(sectionIndexRef.current, true);
      return;
    }
    syncLoopFlag();
    setPlaying(true);
    safePlay();
  }, [audio, getCurrentSectionOffset, jumpSection, loadSingleSection, loadStitchedAt, safePlay, syncLoopFlag]);

  const pause = useCallback(() => {
    if (!playingRef.current) return false;
    setPlaying(false);
    return true;
  }, []);

  const resume = useCallback(() => {
    if (!audio || playingRef.current) return;
    play();
  }, [audio, play]);

  const toggle = useCallback(() => {
    if (playingRef.current) setPlaying(false);
    else play();
  }, [play]);

  const selectSection = useCallback(
    (i: number) => {
      jumpSection(i, true);
    },
    [jumpSection],
  );

  const prev = useCallback(() => {
    const count = lessonRef.current?.sections.length ?? 0;
    if (!count) return;
    jumpSection((sectionIndexRef.current - 1 + count) % count, true);
  }, [jumpSection]);

  const next = useCallback(() => {
    const count = lessonRef.current?.sections.length ?? 0;
    if (!count) return;
    jumpSection((sectionIndexRef.current + 1) % count, true);
  }, [jumpSection]);

  const replay = useCallback(() => {
    jumpSection(sectionIndexRef.current, true);
  }, [jumpSection]);

  const seek = useCallback(
    (seconds: number) => {
      const track = stitchedRef.current;
      if (!track || !audio) return;
      const total = track.cues[track.cues.length - 1]?.end ?? 0;
      const clamped = Math.min(Math.max(seconds, 0), total);
      const cueIdx = findCueIndex(track.cues, clamped);
      const cue = track.cues[cueIdx];
      const offset = Math.max(0, clamped - cue.start);
      setSectionIndex(cueIdx);
      if (loopRef.current === 'section') {
        loadSingleSection(track, cueIdx, offset, playingRef.current);
      } else {
        loadStitchedAt(track, cueIdx, offset, playingRef.current);
      }
    },
    [audio, loadSingleSection, loadStitchedAt],
  );

  return {
    sectionIndex,
    playing,
    loop,
    setLoop,
    sectionProgress,
    currentTime,
    duration,
    missing,
    play,
    pause,
    resume,
    toggle,
    selectSection,
    prev,
    next,
    replay,
    seek,
  };
}
