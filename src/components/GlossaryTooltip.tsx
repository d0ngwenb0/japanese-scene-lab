import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { getGlossaryEntry, type GlossaryEntry } from '../lib/glossary';

type ActiveState = {
  entry: GlossaryEntry & { surface: string };
  placement: 'top' | 'bottom';
  coords: { x: number; y: number } | null;
};

const OPEN_DELAY_MS = 90;
const CLOSE_DELAY_MS = 90;

function hasNonCollapsedSelection(): boolean {
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
}

function hasSelectionInside(el: HTMLElement | null): boolean {
  if (!el) return false;
  const selection = window.getSelection();
  return Boolean(
    selection &&
      !selection.isCollapsed &&
      selection.toString().trim() &&
      ((selection.anchorNode && el.contains(selection.anchorNode)) ||
        (selection.focusNode && el.contains(selection.focusNode))),
  );
}

export function GlossaryTooltip() {
  const tooltipId = useId();
  const popoverRef = useRef<HTMLDivElement>(null);
  const activeWordRef = useRef<HTMLElement | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const touchStartRef = useRef<{ x: number; y: number; time: number; wordEl: HTMLElement | null } | null>(null);
  const suppressClickUntilRef = useRef(0);
  const [active, setActive] = useState<ActiveState | null>(null);
  const [fallbackOpen, setFallbackOpen] = useState(false);

  const supportsAnchor =
    typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('position-area: block-start');

  const clearTimers = useCallback(() => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const hideTooltip = useCallback(() => {
    clearTimers();
    if (activeWordRef.current) {
      activeWordRef.current.classList.remove('is-gloss-active');
      activeWordRef.current.removeAttribute('aria-describedby');
      activeWordRef.current = null;
    }
    const pop = popoverRef.current;
    if (pop && 'hidePopover' in pop && typeof pop.hidePopover === 'function') {
      try {
        if (pop.matches(':popover-open')) {
          pop.hidePopover();
        }
      } catch {
        // 忽略已关闭的 popover 状态异常
      }
    }
    setFallbackOpen(false);
    setActive(null);
  }, [clearTimers]);

  const showForWord = useCallback(
    (wordEl: HTMLElement) => {
      const key = wordEl.dataset.glossKey;
      if (!key) return;
      const entry = getGlossaryEntry(key);
      if (!entry) return;

      if (activeWordRef.current && activeWordRef.current !== wordEl) {
        activeWordRef.current.classList.remove('is-gloss-active');
        activeWordRef.current.removeAttribute('aria-describedby');
      }

      wordEl.classList.add('is-gloss-active');
      wordEl.setAttribute('aria-describedby', tooltipId);
      activeWordRef.current = wordEl;

      let coords: { x: number; y: number } | null = null;
      let placement: 'top' | 'bottom' = 'top';
      if (!supportsAnchor) {
        const rect = wordEl.getBoundingClientRect();
        placement = rect.top < 120 ? 'bottom' : 'top';
        const half = Math.min(168, window.innerWidth / 2 - 12);
        const x = Math.min(Math.max(rect.left + rect.width / 2, half), window.innerWidth - half);
        const y = placement === 'top' ? rect.top - 10 : rect.bottom + 10;
        coords = { x, y };
      }

      setActive({ entry, placement, coords });

      const pop = popoverRef.current;
      if (pop && 'showPopover' in pop && typeof pop.showPopover === 'function') {
        try {
          // 切换锚点时重触发顶部层以刷新 CSS Anchor Positioning 的 fallback 计算
          if (pop.matches(':popover-open')) {
            pop.hidePopover();
          }
          pop.showPopover();
        } catch {
          setFallbackOpen(true);
        }
      } else {
        setFallbackOpen(true);
      }
    },
    [supportsAnchor, tooltipId],
  );

  useEffect(() => {
    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
      if (event.buttons !== 0) return;
      const target = event.target as HTMLElement | null;
      if (!target) return;

      if (target.closest('.gloss-popover')) {
        if (closeTimerRef.current !== null) {
          window.clearTimeout(closeTimerRef.current);
          closeTimerRef.current = null;
        }
        return;
      }

      if (hasSelectionInside(popoverRef.current)) return;
      if (hasNonCollapsedSelection()) return;

      const wordEl = target.closest('.gloss-word[data-gloss-key]') as HTMLElement | null;
      if (!wordEl) return;

      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }

      if (activeWordRef.current === wordEl) return;

      if (openTimerRef.current !== null) {
        window.clearTimeout(openTimerRef.current);
        openTimerRef.current = null;
      }

      const delay = activeWordRef.current ? 0 : OPEN_DELAY_MS;
      if (delay === 0) {
        showForWord(wordEl);
      } else {
        openTimerRef.current = window.setTimeout(() => {
          openTimerRef.current = null;
          showForWord(wordEl);
        }, delay);
      }
    };

    const onPointerOut = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (!target.closest('.gloss-word') && !target.closest('.gloss-popover')) return;
      if (hasSelectionInside(popoverRef.current)) return;

      const next = event.relatedTarget as HTMLElement | null;
      if (
        next &&
        ((activeWordRef.current && activeWordRef.current.contains(next)) ||
          Boolean(next.closest('.gloss-word[data-gloss-key]')) ||
          Boolean(next.closest('.gloss-popover')))
      ) {
        return;
      }

      if (openTimerRef.current !== null) {
        window.clearTimeout(openTimerRef.current);
        openTimerRef.current = null;
      }
      if (closeTimerRef.current === null) {
        closeTimerRef.current = window.setTimeout(() => {
          closeTimerRef.current = null;
          if (!hasSelectionInside(popoverRef.current)) {
            hideTooltip();
          }
        }, CLOSE_DELAY_MS);
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('.gloss-popover')) return;
      if (event.pointerType === 'touch') {
        const wordEl = target?.closest('.gloss-word[data-gloss-key]') as HTMLElement | null;
        touchStartRef.current = {
          x: event.clientX,
          y: event.clientY,
          time: Date.now(),
          wordEl,
        };
        if (!wordEl && (activeWordRef.current || openTimerRef.current !== null)) {
          hideTooltip();
        }
        return;
      }
      if (event.button === 2) return;
      if (activeWordRef.current || openTimerRef.current !== null) {
        hideTooltip();
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' || !touchStartRef.current) return;
      const start = touchStartRef.current;
      touchStartRef.current = null;
      const dist = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      const elapsed = Date.now() - start.time;
      if (!start.wordEl || dist >= 10 || elapsed >= 380 || hasNonCollapsedSelection()) return;

      if (!start.wordEl.closest('.jlpt-option')) {
        suppressClickUntilRef.current = Date.now() + 450;
      }
      if (activeWordRef.current === start.wordEl) {
        hideTooltip();
      } else {
        showForWord(start.wordEl);
      }
    };

    const onPointerCancel = () => {
      touchStartRef.current = null;
    };

    const onClickCapture = (event: MouseEvent) => {
      if (Date.now() >= suppressClickUntilRef.current) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('.gloss-word[data-gloss-key]') && !target.closest('.jlpt-option')) {
        event.preventDefault();
        event.stopPropagation();
        suppressClickUntilRef.current = 0;
      }
    };

    const onScroll = () => {
      if (activeWordRef.current) {
        hideTooltip();
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && activeWordRef.current) {
        event.preventDefault();
        hideTooltip();
      }
    };

    const onBlur = () => {
      if (activeWordRef.current) {
        hideTooltip();
      }
    };

    document.addEventListener('pointerover', onPointerOver, true);
    document.addEventListener('pointerout', onPointerOut, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerCancel, true);
    document.addEventListener('click', onClickCapture, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', onBlur);

    return () => {
      clearTimers();
      touchStartRef.current = null;
      if (activeWordRef.current) {
        activeWordRef.current.classList.remove('is-gloss-active');
        activeWordRef.current.removeAttribute('aria-describedby');
        activeWordRef.current = null;
      }
      document.removeEventListener('pointerover', onPointerOver, true);
      document.removeEventListener('pointerout', onPointerOut, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerCancel, true);
      document.removeEventListener('click', onClickCapture, true);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [clearTimers, hideTooltip, showForWord]);

  const entry = active?.entry ?? null;
  const reading = entry?.r;
  const showReading = Boolean(reading && reading !== entry?.surface);
  const showLemma = Boolean(entry?.l && entry.l !== entry.surface);

  const manualStyle =
    !supportsAnchor && active?.coords
      ? ({
          left: `${active.coords.x}px`,
          top: `${active.coords.y}px`,
        } as const)
      : undefined;

  const className = [
    'gloss-popover',
    !supportsAnchor && active?.coords ? 'is-manual-pos' : '',
    fallbackOpen && active ? 'is-fallback-open' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={popoverRef}
      id={tooltipId}
      role="tooltip"
      className={className}
      data-placement={active?.placement ?? 'top'}
      style={manualStyle}
      {...({ popover: 'manual' } as Record<string, string>)}
    >
      {entry && (
        <div className="gloss-popover-inner">
          <div className="gloss-head">
            <span className="gloss-term" lang="ja">
              {entry.surface}
            </span>
            {showReading && (
              <span className="gloss-reading" lang="ja">
                {reading}
              </span>
            )}
            <span
              className={entry.p === '助' ? 'gloss-pos is-particle' : 'gloss-pos'}
              data-pos={entry.p}
            >
              {entry.p === '助' ? '助詞' : entry.p}
            </span>
            <button
              type="button"
              className="gloss-close"
              onClick={hideTooltip}
              aria-label="关闭释义"
            >
              ×
            </button>
          </div>
          <div className="gloss-zh" lang="zh-CN">
            {entry.z}
          </div>
          {showLemma && entry.l && (
            <div className="gloss-base">
              <span className="gloss-base-label">原形：</span>
              <span lang="ja">{entry.l}</span>
              {entry.lr ? <span lang="ja">（{entry.lr}）</span> : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
