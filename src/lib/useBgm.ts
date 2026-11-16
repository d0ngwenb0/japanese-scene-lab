import { useEffect, useRef } from 'react';

/**
 * 全站背景音乐：一首连续的轻快原声器乐长曲，无缝循环，切场景不重载。
 * 曲目由 Lyria 3 Pro 一次生成，见 docs/bgm.md。
 */
const DEFAULT_BGM_TRACK = 'light-breeze.mp3';

/** 背景音乐整体音量：压低到不抢人声，仅作轻柔氛围铺底。 */
const DEFAULT_BGM_VOLUME = 0.04;

/** 开启时的淡入时长，避免突然出声。 */
const FADE_IN_MS = 2000;

export function useBgm(enabled: boolean, trackFile?: string, targetVolume?: number) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const resolvedTrack = `${import.meta.env.BASE_URL}bgm/${trackFile || DEFAULT_BGM_TRACK}`;
  const resolvedVolume = targetVolume ?? DEFAULT_BGM_VOLUME;

  useEffect(() => {
    if (!enabled) {
      audioRef.current?.pause();
      audioRef.current = null;
      return;
    }

    const audio = new Audio();
    audio.loop = true;
    audio.preload = 'auto';
    audio.volume = 0;
    audio.src = resolvedTrack;
    audioRef.current = audio;

    let cancelled = false;
    let fadeTimer: number | null = null;

    // 用定时器而不是 requestAnimationFrame：后台标签页会节流 rAF，
    // 否则切走再回来音量可能一直停在 0。
    const fadeIn = () => {
      if (fadeTimer) window.clearInterval(fadeTimer);
      const begin = performance.now();
      fadeTimer = window.setInterval(() => {
        if (cancelled) {
          if (fadeTimer) window.clearInterval(fadeTimer);
          fadeTimer = null;
          return;
        }
        const t = Math.min((performance.now() - begin) / FADE_IN_MS, 1);
        audio.volume = resolvedVolume * t;
        if (t >= 1) {
          if (fadeTimer) window.clearInterval(fadeTimer);
          fadeTimer = null;
        }
      }, 50);
    };

    const startTrack = () => {
      if (cancelled || !audio.paused) return;
      audio
        .play()
        .then(() => {
          if (!cancelled) fadeIn();
        })
        .catch(() => {
          // 被浏览器自动播放策略拦截：等用户下一次交互再补播。
        });
    };

    startTrack();
    window.addEventListener('pointerdown', startTrack, { passive: true });
    window.addEventListener('keydown', startTrack);

    return () => {
      cancelled = true;
      if (fadeTimer) window.clearInterval(fadeTimer);
      window.removeEventListener('pointerdown', startTrack);
      window.removeEventListener('keydown', startTrack);
      audio.pause();
      if (audioRef.current === audio) audioRef.current = null;
    };
  }, [enabled, resolvedTrack, resolvedVolume]);
}
