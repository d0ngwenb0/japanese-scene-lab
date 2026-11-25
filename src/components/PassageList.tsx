import { type KeyboardEvent, type MouseEvent, type MutableRefObject } from 'react';
import type { Scenario } from '../types';
import { Furigana } from '../lib/furigana';
import { stripFurigana } from '../lib/copy';

interface Props {
  scenario: Scenario;
  index: number;
  playing: boolean;
  itemRefs: MutableRefObject<Array<HTMLElement | null>>;
  onSelect: (index: number) => void;
}

function hasSelectionInside(event: MouseEvent<HTMLElement>) {
  const selection = window.getSelection();
  return Boolean(
    selection &&
      !selection.isCollapsed &&
      selection.toString().trim() &&
      ((selection.anchorNode && event.currentTarget.contains(selection.anchorNode)) ||
        (selection.focusNode && event.currentTarget.contains(selection.focusNode))),
  );
}

function handleSegmentKeyDown(event: KeyboardEvent<HTMLElement>, onTrigger: () => void) {
  if (event.key === 'Enter') {
    event.preventDefault();
    onTrigger();
  } else if (event.key === ' ') {
    event.preventDefault();
  }
}

function handleSegmentKeyUp(event: KeyboardEvent<HTMLElement>, onTrigger: () => void) {
  if (event.key === ' ') {
    event.preventDefault();
    onTrigger();
  }
}

export function PassageList({ scenario, index, playing, itemRefs, onSelect }: Props) {
  const chars = scenario.lines.reduce((sum, line) => sum + stripFurigana(line.ja).length, 0);
  const minutes = Math.max(1, Math.ceil(chars / 220));

  return (
    <div className="passage-stage">
      <div className="passage-sheet">
        <div className="passage-kicker">
          <span><span aria-hidden="true">📖</span> 短文</span>
          <span className="passage-kicker-status">
            {playing ? <i className="passage-live-dot" aria-hidden="true" /> : null}
            {playing ? '朗读中' : '点击句子跳转'} · {index + 1} / {scenario.lines.length} 句
          </span>
        </div>

        <div className="passage-body">
          <p className="passage-flow" lang="ja">
            {scenario.lines.map((item, i) => {
              const active = i === index;
              return (
                <span
                  key={item.id}
                  ref={(node) => {
                    itemRefs.current[i] = node;
                  }}
                  className={active ? 'passage-seg is-active' : 'passage-seg'}
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    if (hasSelectionInside(event)) return;
                    onSelect(i);
                  }}
                  onKeyDown={(event) => handleSegmentKeyDown(event, () => onSelect(i))}
                  onKeyUp={(event) => handleSegmentKeyUp(event, () => onSelect(i))}
                  aria-current={active ? 'true' : undefined}
                >
                  <Furigana text={item.ja} glossary />
                </span>
              );
            })}
          </p>

          <p className="passage-flow-zh" lang="zh-CN">
            {scenario.lines.map((item, i) => {
              const active = i === index;
              return (
                <span
                  key={`${item.id}-zh`}
                  className={active ? 'passage-seg-zh is-active' : 'passage-seg-zh'}
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    if (hasSelectionInside(event)) return;
                    onSelect(i);
                  }}
                  onKeyDown={(event) => handleSegmentKeyDown(event, () => onSelect(i))}
                  onKeyUp={(event) => handleSegmentKeyUp(event, () => onSelect(i))}
                  aria-current={active ? 'true' : undefined}
                >
                  {item.zh}
                </span>
              );
            })}
          </p>
        </div>

        <div className="passage-bottom">
          <div className="passage-footer">
            <span>{scenario.lines.length} 句 · 约 {minutes} 分钟</span>
            <span>整段连读 · 句内双色同步高亮</span>
          </div>
        </div>
      </div>
    </div>
  );
}
