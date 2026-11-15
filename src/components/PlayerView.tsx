import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { Line, LoopMode, Scenario, Settings, ThemeMode } from '../types';
import { Furigana } from '../lib/furigana';
import { usePlayer } from '../lib/usePlayer';
import { BackIcon, CopyIcon, LoopAllIcon, LoopOneIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, ReplayIcon, ShuffleIcon, SparklesIcon } from './Icons';
import { copyText, formatLine, formatScene, stripFurigana } from '../lib/copy';
import { ThemeToggle } from './ThemeToggle';
import { BgmToggle } from './BgmToggle';
import { PlaybackTimer } from './PlaybackTimer';
import { PaletteToggle } from './PaletteToggle';
import { ForceRefreshButton } from './ForceRefreshButton';
import { FullscreenToggle } from './FullscreenToggle';
import { SceneSwitcher } from './SceneSwitcher';
import { AiChat } from './AiChat';
import { PassageList } from './PassageList';
import { getSpeakerColors } from '../lib/speakerColors';

const SPEEDS = [0.75, 1, 1.25];

interface Props {
  scenario: Scenario;
  scenarios: Scenario[];
  settings: Settings;
  theme: ThemeMode;
  bgm: boolean;
  autoPlay?: boolean;
  onBgmChange: (enabled: boolean) => void;
  onBack: () => void;
  onThemeChange: (mode: ThemeMode) => void;
  onSettingsChange: (patch: Partial<Settings>) => void;
  onSceneChange: (id: string) => void;
  onSceneEnd?: () => void;
  timerEndAt: number | null;
  timerPreset: number | null;
  timerStopTick: number;
  onTimerChange: (minutes: number | null) => void;
}

function PlayingMark() {
  return (
    <span className="playing-mark" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

export function PlayerView({
  scenario,
  scenarios,
  settings,
  theme,
  bgm,
  autoPlay,
  onBgmChange,
  onBack,
  onThemeChange,
  onSettingsChange,
  onSceneChange,
  onSceneEnd,
  timerEndAt,
  timerPreset,
  timerStopTick,
  onTimerChange,
}: Props) {
  const [aiOpen, setAiOpen] = useState(false);
  const [pausedByAi, setPausedByAi] = useState(false);

  const { index, playing, lineProgress, missing, toggle, pause, resume, select, next, prev, replay } = usePlayer({
    sceneId: scenario.id,
    lines: scenario.lines,
    loop: settings.loop,
    rate: settings.rate,
    autoPlay,
    onSceneEnd,
  });

  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);
  const [toast, setToast] = useState('');
  const lastTimerStopTickRef = useRef(timerStopTick);

  useEffect(() => {
    if (timerStopTick <= lastTimerStopTickRef.current) return;
    lastTimerStopTickRef.current = timerStopTick;
    setPausedByAi(false);
    pause();
    setToast('定时时间到，已暂停播放');
  }, [timerStopTick, pause]);
  const [aiWidth, setAiWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem('scene-lab:ai-width:v1'));
      if (saved >= 300 && saved <= 900) return saved;
    } catch {
      // 忽略。
    }
    return Math.round(Math.min(440, Math.max(360, window.innerWidth * 0.3)));
  });
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const toastTimer = useRef<number | null>(null);



  const closeAi = useCallback(() => {
    setAiOpen(false);
    if (pausedByAi) {
      setPausedByAi(false);
      resume();
    }
  }, [pausedByAi, resume]);

  const toggleAi = useCallback(() => {
    if (aiOpen) {
      closeAi();
    } else {
      if (pause()) setPausedByAi(true);
      setAiOpen(true);
    }
  }, [aiOpen, closeAi, pause]);

  useEffect(() => {
    if (playing && pausedByAi) {
      setPausedByAi(false);
    }
  }, [playing, pausedByAi]);

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 1800);
  }, []);

  const isPassage = scenario.kind === 'passage';
  const line = scenario.lines[index];
  const total = scenario.lines.length;
  const overall = ((index + lineProgress) / total) * 100;
  const speakerColors = useMemo(() => getSpeakerColors(scenario.speakers), [scenario.speakers]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const speakerLabel = scenario.speakers.find((s) => s.id === line.speaker)?.label ?? '';
    const artist = speakerLabel ? `${speakerLabel} · ${line.zh}` : line.zh;

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: stripFurigana(line.ja),
        artist,
        album: stripFurigana(scenario.title),
        artwork: [
          {
            src: `${import.meta.env.BASE_URL}apple-touch-icon.png`,
            sizes: '180x180',
            type: 'image/png',
          },
        ],
      });
      navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    } catch {
      // Ignore browsers that reject MediaMetadata updates
    }
  }, [line, playing, scenario.speakers, scenario.title]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const safeSet = (action: MediaSessionAction, handler: (() => void) | null) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        // Unsupported action
      }
    };
    safeSet('play', resume);
    safeSet('pause', pause);
    safeSet('previoustrack', prev);
    safeSet('nexttrack', next);
    return () => {
      safeSet('play', null);
      safeSet('pause', null);
      safeSet('previoustrack', null);
      safeSet('nexttrack', null);
    };
  }, [resume, pause, prev, next]);

  const handleCopyAll = useCallback(async () => {
    const ok = await copyText(formatScene(scenario));
    showToast(
      ok
        ? `已复制整篇（${scenario.lines.length} ${isPassage ? '段' : '句'}）`
        : '复制失败，请手动选择文本',
    );
  }, [scenario, showToast]);

  const copySentence = useCallback(
    async (item: Line) => {
      const ok = await copyText(formatLine(scenario, item));
      showToast(ok ? (isPassage ? '已复制本段' : '已复制本句') : '复制失败，请手动选择文本');
    },
    [scenario, showToast],
  );

  useEffect(() => {
    const el = itemRefs.current[index];
    const box = listRef.current;
    if (!el || !box) return;
    const boxRect = box.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const top = elRect.top - boxRect.top + box.scrollTop;
    const bottom = top + elRect.height;
    if (top >= box.scrollTop && bottom <= box.scrollTop + box.clientHeight) return;
    const target = top - box.clientHeight / 2 + elRect.height / 2;
    box.scrollTo({ top: Math.max(target, 0), behavior: 'smooth' });
  }, [index]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (target?.closest('[role="menu"]')) return;
      // 焦点在按钮上时，空格应激活按钮，而不是切换播放。
      if (event.key === ' ' && target?.closest('button, a, [role="button"]')) return;
      switch (event.key) {
        case ' ':
          event.preventDefault();
          toggle();
          break;
        case 'ArrowRight':
          event.preventDefault();
          next();
          break;
        case 'ArrowLeft':
          event.preventDefault();
          prev();
          break;
        case 'r':
        case 'R':
          replay();
          break;
        case 'l':
        case 'L':
          onSettingsChange({ loop: settings.loop === 'line' ? 'off' : 'line' });
          break;
        case 'Escape':
          if (event.defaultPrevented || document.documentElement.dataset.fullscreen === 'true') return;
          if (document.querySelector('.menu-popover')) return;
          if (aiOpen) {
            closeAi();
            return;
          }
          onBack();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, next, prev, replay, onBack, onSettingsChange, settings.loop, aiOpen, closeAi]);

  const clampAiWidth = useCallback(
    (width: number) => {
      const max = Math.max(300, Math.min(640, window.innerWidth - 480));
      return Math.min(Math.max(300, width), max);
    },
    [],
  );

  useEffect(() => {
    const onResize = () => setAiWidth((width) => clampAiWidth(width));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clampAiWidth]);

  const persistAiWidth = useCallback((width: number) => {
    try {
      localStorage.setItem('scene-lab:ai-width:v1', String(Math.round(width)));
    } catch {
      // 忽略。
    }
  }, []);

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = { startX: event.clientX, startWidth: aiWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.classList.add('is-resizing');
    event.preventDefault();
  };

  const moveResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setAiWidth(clampAiWidth(drag.startWidth + (drag.startX - event.clientX)));
  };

  const endResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    document.body.classList.remove('is-resizing');
    setAiWidth((width) => {
      persistAiWidth(width);
      return width;
    });
  };

  const toggleLoop = useCallback(
    (mode: Exclude<LoopMode, 'off'>) => {
      onSettingsChange({ loop: settings.loop === mode ? 'off' : mode });
    },
    [onSettingsChange, settings.loop],
  );

  return (
    <div
      className={aiOpen ? 'page player-page is-ai-open' : 'page player-page'}
      style={
        {
          '--ai-width': `${aiWidth}px`,
        } as CSSProperties
      }
    >
      <header className="player-bar">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="返回场景列表">
          <BackIcon width={18} height={18} />
        </button>
        <div className="ptitle">
          <span className="ptitle-icon" aria-hidden="true">
            {scenario.emoji}
          </span>
          <h1 lang="ja" title={stripFurigana(scenario.title)}>
            <Furigana text={scenario.title} />
          </h1>
          {isPassage ? <span className="kind-badge">短文</span> : null}
          <span className="ptitle-zh">{scenario.titleZh}</span>
        </div>
        <div className="pbar-right">
          <SceneSwitcher
            scenarios={scenarios}
            currentId={scenario.id}
            onSelect={onSceneChange}
          />
          <BgmToggle enabled={bgm} onChange={onBgmChange} />
          <PlaybackTimer
            endAt={timerEndAt}
            activeMinutes={timerPreset}
            onSelect={onTimerChange}
          />
          <ThemeToggle mode={theme} onChange={onThemeChange} />
          <PaletteToggle
            palette={settings.palette}
            onChange={(palette) => onSettingsChange({ palette })}
          />
          <ForceRefreshButton />
          <FullscreenToggle />
        </div>
      </header>

      <div className="list-pane">
        <div className="list-tools">
          <div className="list-tools-left">
            <div className="list-progress">
              <span>
                第 {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')} {isPassage ? '段' : '句'}
              </span>
              <div className="list-progress-track">
                <div className="list-progress-fill" style={{ width: `${overall}%` }} />
              </div>
            </div>
          </div>
          <div className="list-tools-right">
            <button
              type="button"
              className={aiOpen ? 'tool-btn ai-trigger is-active' : 'tool-btn ai-trigger'}
              onClick={toggleAi}
              aria-label={aiOpen ? '收起 AI' : '问 AI'}
              aria-expanded={aiOpen}
              title={aiOpen ? '收起 AI' : '问 AI'}
            >
              <SparklesIcon width={16} height={16} />
            </button>
            <button
              type="button"
              className="tool-btn"
              onClick={handleCopyAll}
              aria-label={isPassage ? '复制整篇短文' : '复制整段对话'}
              title={isPassage ? '复制整篇短文' : '复制整段对话'}
            >
              <CopyIcon width={16} height={16} strokeWidth={2} />
            </button>
          </div>
        </div>
        {missing && (
          <p className="warn list-warn">
            音频没加载到。先运行 <code>npm run tts</code> 生成音频。
          </p>
        )}
        <div className="subs" ref={listRef}>
          {isPassage ? (
            <PassageList
              scenario={scenario}
              index={index}
              playing={playing}
              itemRefs={itemRefs}
              onSelect={select}
            />
          ) : (
          scenario.lines.map((item, i) => {
            const active = i === index;
            const speakerInfo = scenario.speakers.find((s) => s.id === item.speaker);
            const spk = speakerInfo?.label ?? item.speaker;
            const side = speakerInfo?.self ? 'right' : 'left';
            return (
              <div
                key={item.id}
                className={active ? `turn ${side} is-active` : `turn ${side}`}
                style={
                  {
                    '--speaker-color': speakerColors.get(item.speaker) ?? 'var(--accent)',
                  } as CSSProperties
                }
              >
                <div
                  role="button"
                  tabIndex={0}
                  ref={(node) => {
                    itemRefs.current[i] = node;
                  }}
                  className={active ? (playing ? 'bubble is-active is-playing' : 'bubble is-active') : 'bubble'}
                  onClick={(event) => {
                    const selection = window.getSelection();
                    if (
                      selection &&
                      !selection.isCollapsed &&
                      selection.toString().trim() &&
                      ((selection.anchorNode && event.currentTarget.contains(selection.anchorNode)) ||
                        (selection.focusNode && event.currentTarget.contains(selection.focusNode)))
                    ) {
                      return;
                    }
                    select(i);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      select(i);
                    } else if (event.key === ' ') {
                      event.preventDefault();
                    }
                  }}
                  onKeyUp={(event) => {
                    if (event.key === ' ') {
                      event.preventDefault();
                      select(i);
                    }
                  }}
                  aria-current={active ? 'true' : undefined}
                >
                  <span className="bubble-meta">
                    <span className="bubble-avatar" aria-hidden="true">
                      {spk.slice(0, 1)}
                    </span>
                    <span className="bubble-speaker" lang="ja">
                      {spk}
                    </span>
                    <span className="bubble-index">{String(i + 1).padStart(2, '0')}</span>
                    {active && playing ? <PlayingMark /> : null}
                  </span>
                  <span className="bubble-ja" lang="ja">
                    <Furigana text={item.ja} />
                  </span>
                  <span className="bubble-zh">{item.zh}</span>
                </div>
                <div className="bubble-actions">
                  <button
                    type="button"
                    className="bubble-copy"
                    onClick={() => copySentence(item)}
                    aria-label={`复制第 ${i + 1} 句`}
                    title="复制本句"
                  >
                    <CopyIcon width={16} height={16} strokeWidth={2} />
                  </button>
                </div>
              </div>
            );
          })
          )}
        </div>
      </div>

      <div className="playbar" role="group" aria-label="播放控制">
        <div className="playbar-row">
          <div className="transport">
            <button type="button" className="ctrl" onClick={prev} aria-label={isPassage ? '上一段' : '上一句'} title={isPassage ? '上一段' : '上一句'} aria-keyshortcuts="ArrowLeft">
              <PrevIcon width={18} height={18} />
            </button>
            <button
              type="button"
              className={playing ? 'ctrl ctrl-play is-playing' : 'ctrl ctrl-play'}
              onClick={toggle}
              aria-label={playing ? '暂停' : '播放'}
              title={playing ? '暂停' : '播放'}
              aria-keyshortcuts="Space"
            >
              {playing ? (
                <PauseIcon width={20} height={20} />
              ) : (
                <PlayIcon width={20} height={20} />
              )}
            </button>
            <button type="button" className="ctrl" onClick={next} aria-label={isPassage ? '下一段' : '下一句'} title={isPassage ? '下一段' : '下一句'} aria-keyshortcuts="ArrowRight">
              <NextIcon width={18} height={18} />
            </button>
            <button
              type="button"
              className="ctrl ctrl-replay"
              onClick={replay}
              aria-label={isPassage ? '重播本段' : '重播本句'}
              title={isPassage ? '重播本段' : '重播本句'}
              aria-keyshortcuts="R"
            >
              <ReplayIcon width={17} height={17} />
            </button>
          </div>

          <div className="modes">
            <button
              type="button"
              className={settings.loop === 'line' ? 'pill pill-icon is-on' : 'pill pill-icon'}
              onClick={() => toggleLoop('line')}
              aria-pressed={settings.loop === 'line'}
              aria-label={isPassage ? '单段循环' : '单句循环'}
              title={isPassage ? '单段循环（L）' : '单句循环（L）'}
              aria-keyshortcuts="L"
            >
              <LoopOneIcon width={18} height={18} />
            </button>
            <button
              type="button"
              className={settings.loop === 'all' ? 'pill pill-icon is-on' : 'pill pill-icon'}
              onClick={() => toggleLoop('all')}
              aria-pressed={settings.loop === 'all'}
              aria-label={isPassage ? '整篇循环' : '整段循环'}
              title={isPassage ? '整篇循环' : '整段循环'}
            >
              <LoopAllIcon width={18} height={18} />
            </button>
            <button
              type="button"
              className={settings.loop === 'scenes' ? 'pill pill-icon is-on' : 'pill pill-icon'}
              onClick={() => toggleLoop('scenes')}
              aria-pressed={settings.loop === 'scenes'}
              aria-label="所有场景随机循环"
              title="所有场景随机循环"
            >
              <ShuffleIcon width={17} height={17} />
            </button>
            <div className="speed-group" role="group" aria-label="播放速度">
              {SPEEDS.map((speed) => (
                <button
                  key={speed}
                  type="button"
                  className={settings.rate === speed ? 'pill is-on' : 'pill'}
                  onClick={() => onSettingsChange({ rate: speed })}
                  aria-pressed={settings.rate === speed}
                  aria-label={`速度 ${speed} 倍`}
                >
                  {speed}×
                </button>
              ))}
            </div>
            </div>
        </div>
      </div>

      <div
        className="ai-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="拖动调整对话区和 AI 区宽度"
        aria-valuemin={300}
        aria-valuemax={640}
        aria-valuenow={aiWidth}
        tabIndex={0}
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        onDoubleClick={() => {
          const fallback = Math.round(Math.min(440, Math.max(360, window.innerWidth * 0.3)));
          setAiWidth(fallback);
          persistAiWidth(fallback);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          setAiWidth((width) => {
            const next = clampAiWidth(width + (event.key === 'ArrowLeft' ? 24 : -24));
            persistAiWidth(next);
            return next;
          });
        }}
      />

      <AiChat
        scenario={scenario}
        line={line}
        open={aiOpen}
        pausedByAi={pausedByAi}
        onClose={closeAi}
      />

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  );
}
