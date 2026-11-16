import { useCallback, useEffect, useRef, useState } from 'react';
import type { Line, LoopMode } from '../types';
import { Furigana } from '../lib/furigana';
import {
  CloseIcon,
  LoopAllIcon,
  LoopOneIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  ReplayIcon,
  ShuffleIcon,
} from './Icons';
import { SceneTimePill } from './SceneTimePill';

const CHROME_IDLE_MS = 3800;
let focusChromeShownOnce = false;

export function resetFocusChrome() {
  focusChromeShownOnce = false;
}

interface Props {
  title: string;
  lines: Line[];
  index: number;
  playing: boolean;
  loop: LoopMode;
  rate: number;
  speeds: number[];
  isPassage: boolean;
  sceneTime: number;
  sceneDuration: number;
  onSelect: (i: number) => void;
  onToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
  onReplay: () => void;
  onToggleLoop: (mode: Exclude<LoopMode, 'off'>) => void;
  onRateChange: (rate: number) => void;
  onClose: () => void;
}

export function FocusLyricsOverlay({
  title,
  lines,
  index,
  playing,
  loop,
  rate,
  speeds,
  isPassage,
  sceneTime,
  sceneDuration,
  onSelect,
  onToggle,
  onPrev,
  onNext,
  onReplay,
  onToggleLoop,
  onRateChange,
  onClose,
}: Props) {
  const lineRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(false);
  const hideTimerRef = useRef<number | null>(null);
  const hoveringChromeRef = useRef(false);
  const [chromeVisible, setChromeVisible] = useState(() => {
    if (!focusChromeShownOnce) {
      focusChromeShownOnce = true;
      return true;
    }
    return false;
  });

  const handleClose = useCallback(() => {
    focusChromeShownOnce = false;
    onClose();
  }, [onClose]);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(
    (delay = CHROME_IDLE_MS) => {
      clearHideTimer();
      if (hoveringChromeRef.current) return;
      hideTimerRef.current = window.setTimeout(() => {
        setChromeVisible(false);
        hideTimerRef.current = null;
      }, delay);
    },
    [clearHideTimer],
  );

  const revealChrome = useCallback(
    (delay = CHROME_IDLE_MS) => {
      setChromeVisible(true);
      scheduleHide(delay);
    },
    [scheduleHide],
  );

  useEffect(() => {
    if (chromeVisible) {
      scheduleHide(CHROME_IDLE_MS);
    }
    return clearHideTimer;
  }, [chromeVisible, clearHideTimer, scheduleHide]);

  useEffect(() => {
    const el = lineRefs.current[index];
    const stage = stageRef.current;
    if (!el || !stage) return;
    const stageRect = stage.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const top = elRect.top - stageRect.top + stage.scrollTop - stage.clientHeight / 2 + elRect.height / 2;
    stage.scrollTo({
      top: Math.max(0, top),
      behavior: mountedRef.current ? 'smooth' : 'auto',
    });
    mountedRef.current = true;
  }, [index]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        handleClose();
        return;
      }
      revealChrome();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [handleClose, revealChrome]);

  const handleChromeEnter = () => {
    hoveringChromeRef.current = true;
    clearHideTimer();
    setChromeVisible(true);
  };

  const handleChromeLeave = () => {
    hoveringChromeRef.current = false;
    scheduleHide(CHROME_IDLE_MS);
  };

  return (
    <div
      className={chromeVisible ? 'focus-overlay' : 'focus-overlay is-chrome-hidden'}
      role="dialog"
      aria-modal="true"
      aria-label="字幕沉浸模式"
      onPointerMove={(e) => {
        if (e.pointerType !== 'touch') revealChrome();
      }}
      onPointerEnter={(e) => {
        if (e.pointerType !== 'touch') revealChrome();
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== 'touch' && !hoveringChromeRef.current) {
          scheduleHide(700);
        }
      }}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest('button, .focus-playbar-row, .focus-title')) return;
        if (chromeVisible) {
          clearHideTimer();
          setChromeVisible(false);
        } else {
          revealChrome();
        }
      }}
    >
      <div className="focus-title" title={title}>
        <span className="focus-title-text" lang="ja">
          <Furigana text={title} />
        </span>
      </div>

      <button
        type="button"
        className="focus-exit"
        onClick={handleClose}
        onPointerEnter={handleChromeEnter}
        onPointerLeave={handleChromeLeave}
        aria-label="退出字幕沉浸模式"
        title="退出字幕沉浸模式（Esc）"
      >
        <CloseIcon width={16} height={16} />
        <span>退出</span>
      </button>

      <div ref={stageRef} className="focus-stage" role="list" aria-label="双语字幕">
        {lines.map((item, i) => {
          const active = i === index;
          return (
            <button
              key={item.id}
              type="button"
              role="listitem"
              ref={(node) => {
                lineRefs.current[i] = node;
              }}
              className={
                active
                  ? playing
                    ? 'focus-line is-active is-playing'
                    : 'focus-line is-active'
                  : 'focus-line'
              }
              aria-current={active ? 'true' : undefined}
              onClick={() => onSelect(i)}
            >
              <span className="focus-ja" lang="ja">
                <Furigana text={item.ja} />
              </span>
              <span className="focus-zh">{item.zh}</span>
            </button>
          );
        })}
      </div>

      <div className="focus-playbar" role="group" aria-label="播放控制">
        <div
          className="focus-playbar-row"
          onPointerEnter={handleChromeEnter}
          onPointerLeave={handleChromeLeave}
          onClick={() => revealChrome()}
        >
          <div className="focus-bar-meta">
            <SceneTimePill current={sceneTime} duration={sceneDuration} />
          </div>

          <div className="transport">
            <button
              type="button"
              className="ctrl"
              onClick={onPrev}
              aria-label={isPassage ? '上一段' : '上一句'}
              title={isPassage ? '上一段' : '上一句'}
            >
              <PrevIcon width={18} height={18} />
            </button>
            <button
              type="button"
              className={playing ? 'ctrl ctrl-play is-playing' : 'ctrl ctrl-play'}
              onClick={onToggle}
              aria-label={playing ? '暂停' : '播放'}
              title={playing ? '暂停' : '播放'}
            >
              {playing ? <PauseIcon width={20} height={20} /> : <PlayIcon width={20} height={20} />}
            </button>
            <button
              type="button"
              className="ctrl"
              onClick={onNext}
              aria-label={isPassage ? '下一段' : '下一句'}
              title={isPassage ? '下一段' : '下一句'}
            >
              <NextIcon width={18} height={18} />
            </button>
            <button
              type="button"
              className="ctrl ctrl-replay"
              onClick={onReplay}
              aria-label={isPassage ? '重播本段' : '重播本句'}
              title={isPassage ? '重播本段' : '重播本句'}
            >
              <ReplayIcon width={17} height={17} />
            </button>
          </div>

          <div className="modes">
            <button
              type="button"
              className={loop === 'line' ? 'pill pill-icon is-on' : 'pill pill-icon'}
              onClick={() => onToggleLoop('line')}
              aria-pressed={loop === 'line'}
              aria-label={isPassage ? '单段循环' : '单句循环'}
              title={isPassage ? '单段循环' : '单句循环'}
            >
              <LoopOneIcon width={17} height={17} />
            </button>
            <button
              type="button"
              className={loop === 'all' ? 'pill pill-icon is-on' : 'pill pill-icon'}
              onClick={() => onToggleLoop('all')}
              aria-pressed={loop === 'all'}
              aria-label={isPassage ? '整篇循环' : '整段循环'}
              title={isPassage ? '整篇循环' : '整段循环'}
            >
              <LoopAllIcon width={17} height={17} />
            </button>
            <button
              type="button"
              className={loop === 'scenes' ? 'pill pill-icon is-on' : 'pill pill-icon'}
              onClick={() => onToggleLoop('scenes')}
              aria-pressed={loop === 'scenes'}
              aria-label="所有场景随机循环"
              title="所有场景随机循环"
            >
              <ShuffleIcon width={16} height={16} />
            </button>
            <div className="speed-group" role="group" aria-label="播放速度">
              {speeds.map((speed) => (
                <button
                  key={speed}
                  type="button"
                  className={rate === speed ? 'pill is-on' : 'pill'}
                  onClick={() => onRateChange(speed)}
                  aria-pressed={rate === speed}
                  aria-label={`速度 ${speed} 倍`}
                >
                  {speed}×
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
