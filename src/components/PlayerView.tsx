import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { Line, LoopMode, Scenario, SceneLesson, Settings, ThemeMode } from '../types';
import { Furigana } from '../lib/furigana';
import { hasLesson, loadLesson } from '../lib/lessons';
import { useLessonPlayer, type LessonLoopMode } from '../lib/useLessonPlayer';
import { usePlayer } from '../lib/usePlayer';
import { BackIcon, CopyIcon, LessonIcon, LoopAllIcon, LoopOneIcon, LyricsIcon, NextIcon, PauseIcon, PlayIcon, PosColorIcon, PrevIcon, ReplayIcon, ShuffleIcon, SparklesIcon, StarIcon } from './Icons';
import { copyText, formatLine, formatScene, stripFurigana } from '../lib/copy';
import { ThemeToggle } from './ThemeToggle';
import { PlaybackTimer } from './PlaybackTimer';
import { PaletteToggle } from './PaletteToggle';
import { ForceRefreshButton } from './ForceRefreshButton';
import { FullscreenToggle } from './FullscreenToggle';
import { JlptStage } from './JlptStage';
import { LessonStage } from './LessonStage';
import { SceneSwitcher } from './SceneSwitcher';
import { AiChat } from './AiChat';
import { PassageList } from './PassageList';
import { FocusLyricsOverlay } from './FocusLyricsOverlay';
import { SceneTimePill } from './SceneTimePill';
import { VolumeControl } from './VolumeControl';
import { getSpeakerColors } from '../lib/speakerColors';

const SPEEDS = [0.75, 1, 1.25];

interface Props {
  scenario: Scenario;
  scenarios: Scenario[];
  settings: Settings;
  theme: ThemeMode;
  autoPlay?: boolean;
  onBack: () => void;
  onThemeChange: (mode: ThemeMode) => void;
  onSettingsChange: (patch: Partial<Settings>) => void;
  onSceneChange: (id: string) => void;
  onSceneEnd?: () => void;
  timerEndAt: number | null;
  timerPreset: number | null;
  timerStopTick: number;
  onTimerChange: (minutes: number | null) => void;
  focusMode: boolean;
  onFocusModeChange: (enabled: boolean) => void;
  aiOpen: boolean;
  onAiOpenChange: (open: boolean) => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
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
  autoPlay,
  onBack,
  onThemeChange,
  onSettingsChange,
  onSceneChange,
  onSceneEnd,
  timerEndAt,
  timerPreset,
  timerStopTick,
  onTimerChange,
  focusMode,
  onFocusModeChange,
  aiOpen,
  onAiOpenChange,
  isFavorite,
  onToggleFavorite,
}: Props) {
  const [pausedByAi, setPausedByAi] = useState(false);
  const pausedSourceByAiRef = useRef<'practice' | 'lesson' | null>(null);
  const sceneHasLesson = hasLesson(scenario.id);
  const [viewMode, setViewMode] = useState<'practice' | 'lesson'>('practice');
  const [lesson, setLesson] = useState<SceneLesson | null>(null);
  const [lessonLoading, setLessonLoading] = useState(false);
  const inLessonView = sceneHasLesson && viewMode === 'lesson';

  useEffect(() => {
    setViewMode('practice');
    if (!hasLesson(scenario.id)) {
      setLesson(null);
      setLessonLoading(false);
      return;
    }
    let cancelled = false;
    setLessonLoading(true);
    loadLesson(scenario.id).then((loaded) => {
      if (cancelled) return;
      setLesson(loaded);
      setLessonLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [scenario.id]);

  const { index, playing, lineProgress, sceneTime, sceneDuration, missing, toggle, pause, resume, select, next, prev, replay } = usePlayer({
    sceneId: scenario.id,
    lines: scenario.lines,
    loop: settings.loop,
    rate: settings.rate,
    volume: settings.volume,
    autoPlay,
    onSceneEnd,
  });

  const lessonPlayer = useLessonPlayer({
    lesson,
    rate: settings.rate,
    volume: settings.volume,
    active: inLessonView,
    onPlayStart: pause,
  });

  const practiceTabRef = useRef<HTMLButtonElement>(null);
  const lessonTabRef = useRef<HTMLButtonElement>(null);

  const switchViewMode = useCallback(
    (nextMode: 'practice' | 'lesson') => {
      if (nextMode === viewMode) return;
      if (nextMode === 'lesson') {
        pause();
        setViewMode('lesson');
      } else {
        lessonPlayer.pause();
        setViewMode('practice');
      }
    },
    [lessonPlayer, pause, viewMode],
  );

  const lastNonZeroVolumeRef = useRef(settings.volume > 0 ? settings.volume : 1);
  useEffect(() => {
    if (settings.volume > 0) {
      lastNonZeroVolumeRef.current = settings.volume;
    }
  }, [settings.volume]);

  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);
  const [toast, setToast] = useState('');
  const lastTimerStopTickRef = useRef(timerStopTick);

  useEffect(() => {
    if (timerStopTick <= lastTimerStopTickRef.current) return;
    lastTimerStopTickRef.current = timerStopTick;
    pausedSourceByAiRef.current = null;
    setPausedByAi(false);
    pause();
    lessonPlayer.pause();
    setToast('定时时间到，已暂停播放');
  }, [lessonPlayer, timerStopTick, pause]);
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
    onAiOpenChange(false);
    if (pausedByAi) {
      const src = pausedSourceByAiRef.current;
      pausedSourceByAiRef.current = null;
      setPausedByAi(false);
      if (src === 'lesson') lessonPlayer.resume();
      else resume();
    }
  }, [lessonPlayer, onAiOpenChange, pausedByAi, resume]);

  const toggleAi = useCallback(() => {
    if (aiOpen) {
      closeAi();
    } else {
      if (inLessonView && lessonPlayer.pause()) {
        pausedSourceByAiRef.current = 'lesson';
        setPausedByAi(true);
      } else if (pause()) {
        pausedSourceByAiRef.current = 'practice';
        setPausedByAi(true);
      }
      onAiOpenChange(true);
    }
  }, [aiOpen, closeAi, inLessonView, lessonPlayer, onAiOpenChange, pause]);

  useEffect(() => {
    if ((playing || lessonPlayer.playing) && pausedByAi) {
      pausedSourceByAiRef.current = null;
      setPausedByAi(false);
    }
  }, [lessonPlayer.playing, playing, pausedByAi]);

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
  const isJlpt = scenario.kind === 'jlpt';
  const line = scenario.lines[index];
  const total = scenario.lines.length;
  const lessonTotal = lesson?.sections.length ?? 0;
  const activePlaying = inLessonView ? lessonPlayer.playing : playing;
  const activeToggle = inLessonView ? lessonPlayer.toggle : toggle;
  const activePrev = inLessonView ? lessonPlayer.prev : prev;
  const activeNext = inLessonView ? lessonPlayer.next : next;
  const activeReplay = inLessonView ? lessonPlayer.replay : replay;
  const overall = inLessonView
    ? lessonTotal > 0
      ? ((lessonPlayer.sectionIndex + lessonPlayer.sectionProgress) / lessonTotal) * 100
      : 0
    : ((index + lineProgress) / total) * 100;
  const speakerColors = useMemo(() => getSpeakerColors(scenario.speakers), [scenario.speakers]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    try {
      if (inLessonView && lesson) {
        const sec = lesson.sections[lessonPlayer.sectionIndex];
        navigator.mediaSession.metadata = new MediaMetadata({
          title: sec?.title ?? lesson.title,
          artist: `老师精讲 · ${scenario.titleZh}`,
          album: stripFurigana(scenario.title),
          artwork: [
            {
              src: `${import.meta.env.BASE_URL}apple-touch-icon.png`,
              sizes: '180x180',
              type: 'image/png',
            },
          ],
        });
        navigator.mediaSession.playbackState = lessonPlayer.playing ? 'playing' : 'paused';
        return;
      }

      const speakerLabel = scenario.speakers.find((s) => s.id === line.speaker)?.label ?? '';
      const artist = speakerLabel ? `${speakerLabel} · ${line.zh}` : line.zh;
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
  }, [inLessonView, lesson, lessonPlayer.playing, lessonPlayer.sectionIndex, line, playing, scenario.speakers, scenario.title, scenario.titleZh]);

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
    safeSet('play', inLessonView ? lessonPlayer.resume : resume);
    safeSet('pause', inLessonView ? lessonPlayer.pause : pause);
    safeSet('previoustrack', activePrev);
    safeSet('nexttrack', activeNext);
    return () => {
      safeSet('play', null);
      safeSet('pause', null);
      safeSet('previoustrack', null);
      safeSet('nexttrack', null);
    };
  }, [activeNext, activePrev, inLessonView, lessonPlayer.pause, lessonPlayer.resume, pause, resume]);

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
          activeToggle();
          break;
        case 'ArrowRight':
          event.preventDefault();
          activeNext();
          break;
        case 'ArrowLeft':
          event.preventDefault();
          activePrev();
          break;
        case 'r':
        case 'R':
          activeReplay();
          break;
        case 'l':
        case 'L':
          if (inLessonView) {
            lessonPlayer.setLoop((cur) => (cur === 'section' ? 'off' : 'section'));
          } else {
            onSettingsChange({ loop: settings.loop === 'line' ? 'off' : 'line' });
          }
          break;
        case 'm':
        case 'M':
          onSettingsChange({
            volume: settings.volume === 0 ? lastNonZeroVolumeRef.current : 0,
          });
          break;
        case 'Escape':
          if (event.defaultPrevented || document.documentElement.dataset.fullscreen === 'true') return;
          if (document.querySelector('.menu-popover')) return;
          if (focusMode) {
            onFocusModeChange(false);
            return;
          }
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
  }, [activeNext, activePrev, activeReplay, activeToggle, inLessonView, lessonPlayer, onBack, onSettingsChange, settings.loop, settings.volume, aiOpen, closeAi, focusMode, onFocusModeChange]);

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

  const toggleLessonLoop = useCallback(
    (mode: Exclude<LessonLoopMode, 'off'>) => {
      lessonPlayer.setLoop((cur) => (cur === mode ? 'off' : mode));
    },
    [lessonPlayer],
  );

  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, current: 'practice' | 'lesson') => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      if (event.key === 'Home') {
        practiceTabRef.current?.focus();
      } else if (event.key === 'End') {
        lessonTabRef.current?.focus();
      } else {
        (current === 'practice' ? lessonTabRef : practiceTabRef).current?.focus();
      }
    }
  };

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
            {sceneHasLesson && (
              <div className="mode-tabs" role="tablist" aria-label="学习模式">
                <button
                  ref={practiceTabRef}
                  type="button"
                  role="tab"
                  id="tab-practice"
                  className="mode-tab"
                  aria-selected={!inLessonView}
                  tabIndex={!inLessonView ? 0 : -1}
                  onClick={() => switchViewMode('practice')}
                  onKeyDown={(e) => handleTabKeyDown(e, 'practice')}
                >
                  {isJlpt ? '听力练习' : isPassage ? '短文原文' : '对话原文'}
                </button>
                <button
                  ref={lessonTabRef}
                  type="button"
                  role="tab"
                  id="tab-lesson"
                  className="mode-tab"
                  aria-selected={inLessonView}
                  tabIndex={inLessonView ? 0 : -1}
                  onClick={() => switchViewMode('lesson')}
                  onKeyDown={(e) => handleTabKeyDown(e, 'lesson')}
                >
                  <LessonIcon width={14} height={14} />
                  <span>老师精讲</span>
                </button>
              </div>
            )}
            <div className="list-progress">
              <span>
                {inLessonView
                  ? `第 ${String(lessonPlayer.sectionIndex + 1).padStart(2, '0')} / ${String(Math.max(lessonTotal, 1)).padStart(2, '0')} 节`
                  : `第 ${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')} ${isPassage ? '段' : '句'}`}
              </span>
              <div className="list-progress-track">
                <div className="list-progress-fill" style={{ width: `${overall}%` }} />
              </div>
            </div>
          </div>
          <div className="list-tools-right">
            <button
              type="button"
              className={isFavorite ? 'tool-btn fav-tool-btn is-active' : 'tool-btn fav-tool-btn'}
              onClick={() => {
                const next = !isFavorite;
                onToggleFavorite();
                showToast(next ? '已收藏场景' : '已取消收藏');
              }}
              aria-label={isFavorite ? '取消收藏' : '收藏场景'}
              aria-pressed={isFavorite}
              title={isFavorite ? '取消收藏' : '收藏场景'}
            >
              <StarIcon width={16} height={16} filled={isFavorite} />
            </button>
            <button
              type="button"
              className={settings.posColor ? 'tool-btn pos-color-btn is-active' : 'tool-btn pos-color-btn'}
              onClick={() => {
                const next = !settings.posColor;
                onSettingsChange({ posColor: next });
                showToast(next ? '已开启词性染色' : '已关闭词性染色');
              }}
              aria-label={settings.posColor ? '关闭词性染色' : '开启词性染色'}
              aria-pressed={settings.posColor}
              title={settings.posColor ? '关闭词性染色' : '开启词性染色'}
            >
              <PosColorIcon width={16} height={16} />
            </button>
            <button
              type="button"
              className={focusMode ? 'tool-btn is-active' : 'tool-btn'}
              onClick={() => onFocusModeChange(true)}
              aria-label="字幕沉浸模式"
              aria-pressed={focusMode}
              title="字幕沉浸模式"
            >
              <LyricsIcon width={16} height={16} />
            </button>
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
        {settings.posColor && (
          <div className="pos-legend" aria-label="词性背景图例">
            <span className="pos-legend-item" data-pos="名">
              名词
            </span>
            <span className="pos-legend-item" data-pos="動">
              动词
            </span>
            <span className="pos-legend-item" data-pos="形">
              形容词
            </span>
            <span className="pos-legend-item" data-pos="副">
              副词
            </span>
            <span className="pos-legend-item" data-pos="助">
              助词
            </span>
            <span className="pos-legend-item" data-pos="敬語">
              敬语・表达
            </span>
          </div>
        )}
        {!inLessonView && missing && (
          <p className="warn list-warn">
            音频没加载到。先运行 <code>npm run tts</code> 生成音频。
          </p>
        )}
        <div className="subs" ref={listRef}>
          <div
            role="tabpanel"
            aria-labelledby={sceneHasLesson ? 'tab-practice' : undefined}
            className="subs-panel"
            hidden={inLessonView}
          >
            {isJlpt ? (
              <JlptStage
                scenario={scenario}
                index={index}
                playing={playing}
                itemRefs={itemRefs}
                onSelect={select}
              />
            ) : isPassage ? (
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
                      <Furigana text={item.ja} glossary />
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
          {sceneHasLesson && (
            <div
              role="tabpanel"
              aria-labelledby="tab-lesson"
              className="subs-panel"
              hidden={!inLessonView}
            >
              <LessonStage
                scenario={scenario}
                lesson={lesson}
                loading={lessonLoading}
                sectionIndex={lessonPlayer.sectionIndex}
                playing={lessonPlayer.playing}
                missing={lessonPlayer.missing}
                onSelectSection={lessonPlayer.selectSection}
                onTogglePlay={lessonPlayer.toggle}
                onJumpToLine={(lineIdx) => {
                  lessonPlayer.pause();
                  setViewMode('practice');
                  select(lineIdx);
                }}
              />
            </div>
          )}
        </div>
      </div>

      <div className={inLessonView ? 'playbar is-lesson' : 'playbar'} role="group" aria-label="播放控制">
        {inLessonView && lesson && (
          <div className="lesson-scrubber">
            <span className="lesson-scrub-label">
              {String(lessonPlayer.sectionIndex + 1).padStart(2, '0')} · {lesson.sections[lessonPlayer.sectionIndex]?.title ?? ''}
            </span>
            <input
              type="range"
              className="lesson-seek-range"
              min={0}
              max={lessonPlayer.duration > 0 ? lessonPlayer.duration : 1}
              step={0.1}
              value={Math.min(lessonPlayer.currentTime, lessonPlayer.duration || 1)}
              disabled={lessonPlayer.duration <= 0}
              onChange={(e) => lessonPlayer.seek(Number(e.target.value))}
              aria-label="讲解播放进度"
            />
          </div>
        )}
        <div className="playbar-row">
          <div className="transport">
            <button
              type="button"
              className="ctrl"
              onClick={activePrev}
              aria-label={inLessonView ? '上一节' : isPassage ? '上一段' : '上一句'}
              title={inLessonView ? '上一节' : isPassage ? '上一段' : '上一句'}
              aria-keyshortcuts="ArrowLeft"
            >
              <PrevIcon width={18} height={18} />
            </button>
            <button
              type="button"
              className={activePlaying ? 'ctrl ctrl-play is-playing' : 'ctrl ctrl-play'}
              onClick={activeToggle}
              aria-label={activePlaying ? '暂停' : '播放'}
              title={activePlaying ? '暂停' : '播放'}
              aria-keyshortcuts="Space"
            >
              {activePlaying ? (
                <PauseIcon width={20} height={20} />
              ) : (
                <PlayIcon width={20} height={20} />
              )}
            </button>
            <button
              type="button"
              className="ctrl"
              onClick={activeNext}
              aria-label={inLessonView ? '下一节' : isPassage ? '下一段' : '下一句'}
              title={inLessonView ? '下一节' : isPassage ? '下一段' : '下一句'}
              aria-keyshortcuts="ArrowRight"
            >
              <NextIcon width={18} height={18} />
            </button>
            <button
              type="button"
              className="ctrl ctrl-replay"
              onClick={activeReplay}
              aria-label={inLessonView ? '重播本节' : isPassage ? '重播本段' : '重播本句'}
              title={inLessonView ? '重播本节' : isPassage ? '重播本段' : '重播本句'}
              aria-keyshortcuts="R"
            >
              <ReplayIcon width={17} height={17} />
            </button>
          </div>

          <SceneTimePill
            current={inLessonView ? lessonPlayer.currentTime : sceneTime}
            duration={inLessonView ? lessonPlayer.duration : sceneDuration}
          />

          <div className="modes">
            {inLessonView ? (
              <>
                <button
                  type="button"
                  className={lessonPlayer.loop === 'section' ? 'pill pill-icon is-on' : 'pill pill-icon'}
                  onClick={() => toggleLessonLoop('section')}
                  aria-pressed={lessonPlayer.loop === 'section'}
                  aria-label="单节循环"
                  title="单节循环（L）"
                  aria-keyshortcuts="L"
                >
                  <LoopOneIcon width={18} height={18} />
                </button>
                <button
                  type="button"
                  className={lessonPlayer.loop === 'all' ? 'pill pill-icon is-on' : 'pill pill-icon'}
                  onClick={() => toggleLessonLoop('all')}
                  aria-pressed={lessonPlayer.loop === 'all'}
                  aria-label="整讲循环"
                  title="整讲循环"
                >
                  <LoopAllIcon width={18} height={18} />
                </button>
              </>
            ) : (
              <>
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
              </>
            )}
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
            <VolumeControl
              volume={settings.volume}
              onChange={(volume) => onSettingsChange({ volume })}
            />
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

      {focusMode && (
        <FocusLyricsOverlay
          title={scenario.title}
          lines={scenario.lines}
          index={index}
          playing={playing}
          loop={settings.loop}
          rate={settings.rate}
          volume={settings.volume}
          speeds={SPEEDS}
          isPassage={isPassage}
          sceneTime={sceneTime}
          sceneDuration={sceneDuration}
          onSelect={select}
          onToggle={toggle}
          onPrev={prev}
          onNext={next}
          onReplay={replay}
          onToggleLoop={toggleLoop}
          onRateChange={(rate) => onSettingsChange({ rate })}
          onVolumeChange={(volume) => onSettingsChange({ volume })}
          posColor={settings.posColor}
          onTogglePosColor={() => onSettingsChange({ posColor: !settings.posColor })}
          onClose={() => onFocusModeChange(false)}
        />
      )}

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  );
}
