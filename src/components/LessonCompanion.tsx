import { useEffect, useRef, type CSSProperties } from 'react';
import type { LessonSectionKind, Scenario, SceneLesson } from '../types';
import { Furigana } from '../lib/furigana';
import { ChevronDownIcon, PauseIcon, PlayIcon } from './Icons';

interface ControlBarProps {
  scenario: Scenario;
  lesson: SceneLesson | null;
  loading: boolean;
  sectionIndex: number;
  currentTime: number;
  duration: number;
  missing: boolean;
  scriptOpen: boolean;
  previewPlaying: boolean;
  onSelectSection: (index: number) => void;
  onSeek: (seconds: number) => void;
  onToggleScript: () => void;
  onPlayPreview: (lineId: string) => void;
}

const KIND_LABELS: Record<LessonSectionKind, string> = {
  intro: '导入',
  walkthrough: '精讲',
  culture: '拓展',
  strategy: '攻略',
  summary: '总结',
};

function formatClock(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '00:00';
  const rounded = Math.floor(sec);
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function LessonControlBar({
  scenario,
  lesson,
  loading,
  sectionIndex,
  currentTime,
  duration,
  missing,
  scriptOpen,
  previewPlaying,
  onSelectSection,
  onSeek,
  onToggleScript,
  onPlayPreview,
}: ControlBarProps) {
  const navPillRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const chip = navPillRefs.current[sectionIndex];
    if (chip) {
      chip.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [sectionIndex]);

  if (loading && !lesson) {
    return (
      <div className="lesson-bar lesson-bar-loading" lang="zh-CN">
        <span>正在加载老师精讲课程…</span>
      </div>
    );
  }

  if (!lesson) return null;

  const activeSection = lesson.sections[sectionIndex];
  const primaryLineId = activeSection?.lineIds?.[0];
  const lineIdxMap = new Map(scenario.lines.map((l, idx) => [l.id, idx + 1]));

  return (
    <div className="lesson-bar" lang="zh-CN">
      <div className="lesson-bar-top">
        <nav className="lesson-nav" aria-label="课程章节导航">
          <div className="lesson-nav-track">
            {lesson.sections.map((sec, i) => {
              const active = i === sectionIndex;
              const firstNum = sec.lineIds?.[0] ? lineIdxMap.get(sec.lineIds[0]) : undefined;
              const chipLabel =
                sec.kind === 'walkthrough' && firstNum
                  ? `#${String(firstNum).padStart(2, '0')}`
                  : KIND_LABELS[sec.kind];
              return (
                <button
                  key={sec.id}
                  ref={(node) => {
                    navPillRefs.current[i] = node;
                  }}
                  type="button"
                  className={active ? 'lesson-nav-pill is-active' : 'lesson-nav-pill'}
                  onClick={() => onSelectSection(i)}
                  aria-current={active ? 'step' : undefined}
                  title={sec.title}
                >
                  <span>{chipLabel}</span>
                </button>
              );
            })}
          </div>
        </nav>

        <div className="lesson-bar-actions">
          {primaryLineId ? (
            <button
              type="button"
              className={previewPlaying ? 'lesson-bar-btn is-active' : 'lesson-bar-btn'}
              onClick={() => onPlayPreview(primaryLineId)}
              aria-pressed={previewPlaying}
              title={previewPlaying ? '停止原声' : '听这一句的日语原声'}
            >
              {previewPlaying ? <PauseIcon width={12} height={12} /> : <PlayIcon width={12} height={12} />}
              <span>{previewPlaying ? '停原声' : '听原声'}</span>
            </button>
          ) : null}
          <button
            type="button"
            className={scriptOpen ? 'lesson-bar-btn is-active' : 'lesson-bar-btn'}
            onClick={onToggleScript}
            aria-expanded={scriptOpen}
            title={scriptOpen ? '收起老师讲稿' : '展开老师实时讲稿'}
          >
            <span>讲稿</span>
            <ChevronDownIcon width={13} height={13} />
          </button>
        </div>
      </div>

      <div className="lesson-deck-progress">
        <div className="lesson-deck-meta">
          <span className="lesson-deck-title">
            {String(sectionIndex + 1).padStart(2, '0')} · {activeSection?.title ?? lesson.title}
          </span>
          <span className="lesson-deck-time">
            {formatClock(currentTime)} / {formatClock(duration)}
          </span>
        </div>
        <input
          type="range"
          className="lesson-seek-range"
          min={0}
          max={duration > 0 ? duration : 1}
          step={0.1}
          value={Math.min(currentTime, duration || 1)}
          disabled={duration <= 0}
          style={
            {
              '--seek-pct': `${duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0}%`,
            } as CSSProperties
          }
          onChange={(e) => onSeek(Number(e.target.value))}
          aria-label="讲解播放进度"
        />
      </div>

      {missing && (
        <p className="warn lesson-warn">
          讲解音频未加载到，请先运行 <code>npm run lesson:tts</code> 生成。
        </p>
      )}
    </div>
  );
}

interface ScriptDockProps {
  lesson: SceneLesson | null;
  sectionIndex: number;
  onClose: () => void;
}

export function LessonScriptDock({ lesson, sectionIndex, onClose }: ScriptDockProps) {
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = 0;
    }
  }, [sectionIndex, lesson?.sceneId]);

  if (!lesson) return null;
  const activeSection = lesson.sections[sectionIndex];
  if (!activeSection) return null;

  return (
    <section className="lesson-caption-dock" aria-label="老师讲稿" lang="zh-CN">
      <div className="lesson-caption-head">
        <div className="lesson-caption-title-wrap">
          <span className="lesson-caption-badge">
            {String(sectionIndex + 1).padStart(2, '0')} · {KIND_LABELS[activeSection.kind]}
          </span>
          <h2 className="lesson-caption-title">{activeSection.title}</h2>
        </div>
        <button
          type="button"
          className="lesson-caption-close"
          onClick={onClose}
          aria-label="收起老师讲稿"
        >
          收起
        </button>
      </div>
      <div className="lesson-caption-body" ref={bodyRef}>
        {activeSection.paragraphs.map((para, pIdx) => (
          <p key={pIdx}>
            <Furigana text={para} />
          </p>
        ))}
      </div>
    </section>
  );
}
