import { useEffect, useState, type CSSProperties } from 'react';
import type { Scenario } from '../types';
import { Furigana } from '../lib/furigana';
import { getSpeakerColors } from '../lib/speakerColors';

interface Props {
  scenario: Scenario;
  index: number;
  playing: boolean;
  itemRefs: React.MutableRefObject<Array<HTMLElement | null>>;
  onSelect: (index: number) => void;
}

export function JlptStage({ scenario, index, playing, itemRefs, onSelect }: Props) {
  const jlpt = scenario.jlpt;
  const [selected, setSelected] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);

  const speakerColors = getSpeakerColors(scenario.speakers);

  useEffect(() => {
    setSelected(null);
    setChecked(false);
    setShowTranscript(false);
  }, [scenario.id]);

  return (
    <div className="jlpt-stage">
      {jlpt && (
        <section className="jlpt-card" aria-label="JLPT 听力题目">
          <div className="jlpt-card-head">
            <span className="jlpt-level-badge">{jlpt.level}</span>
            <span className="jlpt-type-label">{jlpt.type}</span>
            <span className="jlpt-status-dot">
              {playing ? <i className="passage-live-dot" aria-hidden="true" /> : null}
              <span>{playing ? '播放中' : `第 ${index + 1} / ${scenario.lines.length} 句`}</span>
            </span>
          </div>

          <div className="jlpt-question">
            <p className="jlpt-question-ja ja" lang="ja">
              <Furigana text={jlpt.question} glossary />
            </p>
            <p className="jlpt-question-zh zh">{jlpt.questionZh}</p>
          </div>

          <div className="jlpt-options" role="radiogroup" aria-label="听力选项">
            {jlpt.options.map((opt, i) => {
              const isSelected = selected === i;
              const isCorrect = checked && i === jlpt.answer;
              const isWrong = checked && isSelected && i !== jlpt.answer;
              const cls = [
                'jlpt-option',
                isSelected ? 'is-selected' : '',
                isCorrect ? 'is-correct' : '',
                isWrong ? 'is-wrong' : '',
              ]
                .filter(Boolean)
                .join(' ');

              return (
                <button
                  key={i}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  className={cls}
                  onClick={() => {
                    if (checked) return;
                    setSelected(i);
                  }}
                >
                  <span className="jlpt-opt-num">{i + 1}</span>
                  <span className="jlpt-opt-text ja" lang="ja">
                    <Furigana text={opt} glossary />
                  </span>
                </button>
              );
            })}
          </div>

          <div className="jlpt-actions">
            {!checked ? (
              <button
                type="button"
                className="jlpt-check-btn"
                disabled={selected === null}
                onClick={() => setChecked(true)}
              >
                核对答案
              </button>
            ) : (
              <button
                type="button"
                className="jlpt-reset-btn"
                onClick={() => {
                  setSelected(null);
                  setChecked(false);
                }}
              >
                重新作答
              </button>
            )}

            <button
              type="button"
              className="jlpt-transcript-toggle"
              onClick={() => setShowTranscript((v) => !v)}
            >
              {showTranscript ? '收起原文（盲听）' : '查看听力原文'}
            </button>
          </div>

          {checked && (
            <div className={selected === jlpt.answer ? 'jlpt-explain is-right' : 'jlpt-explain is-wrong'}>
              <p className="jlpt-explain-title">
                {selected === jlpt.answer
                  ? `回答正确（选项 ${jlpt.answer + 1}）`
                  : `正确答案是选项 ${jlpt.answer + 1}`}
              </p>
              <p className="jlpt-explain-body">{jlpt.explanation}</p>
            </div>
          )}
        </section>
      )}

      {showTranscript && (
        <section className="jlpt-transcript" aria-label="听力原文">
          {scenario.lines.map((item, i) => {
            const active = i === index;
            const speakerInfo = scenario.speakers.find((s) => s.id === item.speaker);
            const spk = speakerInfo?.label ?? item.speaker;
            return (
              <div
                key={item.id}
                role="button"
                tabIndex={0}
                ref={(node) => {
                  itemRefs.current[i] = node;
                }}
                className={active ? 'jlpt-line is-active' : 'jlpt-line'}
                style={
                  {
                    '--speaker-color': speakerColors.get(item.speaker) ?? 'var(--accent)',
                  } as CSSProperties
                }
                onClick={() => onSelect(i)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect(i);
                  }
                }}
              >
                <span className="jlpt-line-spk">{spk}</span>
                <div className="jlpt-line-body">
                  <p className="ja" lang="ja">
                    <Furigana text={item.ja} glossary />
                  </p>
                  <p className="zh" lang="zh-CN">
                    {item.zh}
                  </p>
                </div>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
