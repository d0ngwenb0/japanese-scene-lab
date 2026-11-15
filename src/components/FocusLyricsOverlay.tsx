import { useEffect, useRef } from 'react';
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

interface Props {
  lines: Line[];
  index: number;
  playing: boolean;
  loop: LoopMode;
  rate: number;
  speeds: number[];
  isPassage: boolean;
  sceneTime: number;
  sceneDuration: number;
  timeCountdown: boolean;
  onToggleTimeMode: () => void;
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
  lines,
  index,
  playing,
  loop,
  rate,
  speeds,
  isPassage,
  sceneTime,
  sceneDuration,
  timeCountdown,
  onToggleTimeMode,
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
  const mountedRef = useRef(false);

  useEffect(() => {
    const el = lineRefs.current[index];
    if (!el) return;
    el.scrollIntoView({
      behavior: mountedRef.current ? 'smooth' : 'auto',
      block: 'center',
    });
    mountedRef.current = true;
  }, [index]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="focus-overlay" role="dialog" aria-modal="true" aria-label="字幕沉浸模式">
      <button
        type="button"
        className="focus-exit"
        onClick={onClose}
        aria-label="退出字幕沉浸模式"
        title="退出字幕沉浸模式（Esc）"
      >
        <CloseIcon width={16} height={16} />
        <span>退出</span>
      </button>

      <div className="focus-stage" role="list" aria-label="双语字幕">
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
        <div className="focus-playbar-row">
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
              className="ctrl"
              onClick={onReplay}
              aria-label={isPassage ? '重播本段' : '重播本句'}
              title={isPassage ? '重播本段' : '重播本句'}
            >
              <ReplayIcon width={17} height={17} />
            </button>
          </div>

          <SceneTimePill
            current={sceneTime}
            duration={sceneDuration}
            countdown={timeCountdown}
            onToggleMode={onToggleTimeMode}
          />

          <div className="modes">
            <button
              type="button"
              className={loop === 'line' ? 'pill pill-icon is-on' : 'pill pill-icon'}
              onClick={() => onToggleLoop('line')}
              aria-pressed={loop === 'line'}
              aria-label={isPassage ? '单段循环' : '单句循环'}
              title={isPassage ? '单段循环' : '单句循环'}
            >
              <LoopOneIcon width={18} height={18} />
            </button>
            <button
              type="button"
              className={loop === 'all' ? 'pill pill-icon is-on' : 'pill pill-icon'}
              onClick={() => onToggleLoop('all')}
              aria-pressed={loop === 'all'}
              aria-label={isPassage ? '整篇循环' : '整段循环'}
              title={isPassage ? '整篇循环' : '整段循环'}
            >
              <LoopAllIcon width={18} height={18} />
            </button>
            <button
              type="button"
              className={loop === 'scenes' ? 'pill pill-icon is-on' : 'pill pill-icon'}
              onClick={() => onToggleLoop('scenes')}
              aria-pressed={loop === 'scenes'}
              aria-label="所有场景随机循环"
              title="所有场景随机循环"
            >
              <ShuffleIcon width={17} height={17} />
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
