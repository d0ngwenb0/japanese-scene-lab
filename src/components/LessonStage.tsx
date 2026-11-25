import { useEffect, useRef } from 'react';
import type { LessonSectionKind, Scenario, SceneLesson } from '../types';
import { Furigana } from '../lib/furigana';
import { LessonIcon, PauseIcon, PlayIcon } from './Icons';

interface Props {
  scenario: Scenario;
  lesson: SceneLesson | null;
  loading: boolean;
  sectionIndex: number;
  playing: boolean;
  missing: boolean;
  onSelectSection: (index: number) => void;
  onTogglePlay: () => void;
  onJumpToLine: (lineIndex: number) => void;
}

const KIND_LABELS: Record<LessonSectionKind, string> = {
  intro: '导入',
  walkthrough: '精讲',
  culture: '拓展',
  strategy: '攻略',
  summary: '总结',
};

function PlayingBars() {
  return (
    <span className="playing-mark" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

export function LessonStage({
  scenario,
  lesson,
  loading,
  sectionIndex,
  playing,
  missing,
  onSelectSection,
  onTogglePlay,
  onJumpToLine,
}: Props) {
  const navPillRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const chapterRefs = useRef<Array<HTMLElement | null>>([]);
  const prevSectionRef = useRef<number>(sectionIndex);

  useEffect(() => {
    const chip = navPillRefs.current[sectionIndex];
    if (chip) {
      chip.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    if (prevSectionRef.current !== sectionIndex) {
      prevSectionRef.current = sectionIndex;
      const chapter = chapterRefs.current[sectionIndex];
      if (chapter) {
        chapter.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [sectionIndex]);

  if (loading && !lesson) {
    return (
      <div className="lesson-stage lesson-loading" lang="zh-CN">
        <p>正在加载老师精讲讲义…</p>
      </div>
    );
  }

  if (!lesson) {
    return (
      <div className="lesson-stage lesson-loading" lang="zh-CN">
        <p>当前场景暂无精讲课程。</p>
      </div>
    );
  }

  return (
    <article className="lesson-stage" lang="zh-CN">
      <header className="lesson-hero">
        <div className="lesson-hero-top">
          <span className="lesson-teacher-badge">
            <LessonIcon width={14} height={14} />
            <span>日语老师精讲 · 共 {lesson.sections.length} 节</span>
          </span>
          <button
            type="button"
            className={playing ? 'lesson-hero-play is-playing' : 'lesson-hero-play'}
            onClick={onTogglePlay}
          >
            {playing ? <PauseIcon width={14} height={14} /> : <PlayIcon width={14} height={14} />}
            <span>{playing ? '暂停讲课' : sectionIndex > 0 ? '继续听讲' : '开始听讲'}</span>
          </button>
        </div>
        <h2 className="lesson-title">{lesson.title}</h2>
        <p className="lesson-subtitle">{lesson.subtitle}</p>
      </header>

      <nav className="lesson-nav" aria-label="课程章节导航">
        <div className="lesson-nav-track">
          {lesson.sections.map((sec, i) => {
            const active = i === sectionIndex;
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
              >
                <span className="lesson-nav-num">{String(i + 1).padStart(2, '0')}</span>
                <span>{KIND_LABELS[sec.kind]}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {missing && (
        <p className="warn lesson-warn">
          讲解音频未加载到，请先运行 <code>npm run lesson:tts</code> 生成。
        </p>
      )}

      <div className="lesson-chapters">
        {lesson.sections.map((sec, i) => {
          const active = i === sectionIndex;
          const refLines = (sec.lineIds ?? [])
            .map((lineId) => {
              const lineIdx = scenario.lines.findIndex((l) => l.id === lineId);
              if (lineIdx < 0) return null;
              return { line: scenario.lines[lineIdx], lineIdx };
            })
            .filter((item): item is NonNullable<typeof item> => item !== null);

          return (
            <section
              key={sec.id}
              ref={(node) => {
                chapterRefs.current[i] = node;
              }}
              className={active ? 'lesson-chapter is-active' : 'lesson-chapter'}
            >
              <h3 className="lesson-chapter-heading">
                <button
                  type="button"
                  className="lesson-chapter-head"
                  onClick={() => onSelectSection(i)}
                >
                  <span className="lesson-chapter-meta">
                    <span className="lesson-chapter-num">{String(i + 1).padStart(2, '0')}</span>
                    <span className="lesson-chapter-kind">{KIND_LABELS[sec.kind]}</span>
                  </span>
                  <span className="lesson-chapter-title">{sec.title}</span>
                  <span className="lesson-chapter-state" aria-hidden="true">
                    {active && playing ? <PlayingBars /> : <PlayIcon width={14} height={14} />}
                  </span>
                </button>
              </h3>

              {refLines.length > 0 && (
                <div className="lesson-refs" aria-label="对应原句">
                  {refLines.map(({ line, lineIdx }) => (
                    <div key={line.id} className="lesson-ref-item">
                      <span className="lesson-ref-num">#{String(lineIdx + 1).padStart(2, '0')}</span>
                      <div className="lesson-ref-text">
                        <p className="lesson-ref-ja" lang="ja">
                          <Furigana text={line.ja} glossary />
                        </p>
                        <p className="lesson-ref-zh">{line.zh}</p>
                      </div>
                      <button
                        type="button"
                        className="lesson-ref-jump"
                        onClick={() => onJumpToLine(lineIdx)}
                        title={`切回原文播放第 ${lineIdx + 1} 句`}
                      >
                        听原句
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="lesson-prose">
                {sec.paragraphs.map((para, pIdx) => (
                  <p key={pIdx}>
                    <Furigana text={para} />
                  </p>
                ))}
              </div>

              {sec.highlights && sec.highlights.length > 0 && (
                <div className="lesson-board">
                  <div className="lesson-board-label">老师板书要点</div>
                  <ul className="lesson-board-list" role="list">
                    {sec.highlights.map((item, hIdx) => (
                      <li key={hIdx} className="lesson-board-item">
                        <div className="lesson-board-top">
                          {item.tag ? <span className="lesson-tag">{item.tag}</span> : null}
                          <span className="lesson-board-ja" lang="ja">
                            <Furigana text={item.ja} glossary />
                          </span>
                        </div>
                        <p className="lesson-board-note">{item.note}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </article>
  );
}
