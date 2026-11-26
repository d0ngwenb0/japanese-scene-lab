import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { PaletteMode, ThemeMode } from '../types';
import { MoreHorizontalIcon, RefreshIcon } from './Icons';

interface Props {
  theme: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  palette: PaletteMode;
  onPaletteChange: (palette: PaletteMode) => void;
  timerEndAt: number | null;
  timerPreset: number | null;
  onTimerChange: (minutes: number | null) => void;
}

const TIMER_PRESETS = [5, 15, 30, 60];

const THEMES: Array<{ value: ThemeMode; label: string }> = [
  { value: 'auto', label: '自动' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '夜间' },
];

const PALETTES: Array<{ value: PaletteMode; label: string; swatch: string }> = [
  { value: 'default', label: '原色', swatch: '#d94f36' },
  { value: 'sakura', label: '樱', swatch: '#c15b78' },
  { value: 'matcha', label: '青竹', swatch: '#5b7c4b' },
  { value: 'ocean', label: '海', swatch: '#3f6f9e' },
];

function formatRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function MobileMoreMenu({
  theme,
  onThemeChange,
  palette,
  onPaletteChange,
  timerEndAt,
  timerPreset,
  onTimerChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const timerActive = timerEndAt !== null && timerEndAt > now;
  const remaining = timerActive && timerEndAt !== null ? formatRemaining(timerEndAt - now) : '';

  useEffect(() => {
    if (timerEndAt === null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [timerEndAt]);

  useEffect(() => {
    if (!open) return;
    const onOutside = (event: Event) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('pointerdown', onOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('pointerdown', onOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleForceRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((reg) => reg.unregister()));
      }
      if ('caches' in window) {
        const keys = await window.caches.keys();
        await Promise.all(keys.map((key) => window.caches.delete(key)));
      }
      await fetch(window.location.href, { cache: 'reload' }).catch(() => {});
    } catch {
      // 忽略清理异常，继续重载
    }
    window.location.reload();
  };

  return (
    <div className="menu-wrap mobile-more-wrap" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={timerActive ? 'icon-btn mobile-more-btn has-timer' : 'icon-btn mobile-more-btn'}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="更多设置"
        title="更多设置"
      >
        <MoreHorizontalIcon width={16} height={16} />
        {timerActive ? <span className="mobile-more-dot" aria-hidden="true" /> : null}
      </button>

      {open && (
        <div className="menu-popover mobile-more-menu" role="menu" aria-label="更多设置">
          <div className="mobile-more-section">
            <div className="mobile-more-head">
              <span className="mobile-more-label">定时关闭</span>
              {timerActive ? <span className="mobile-more-status">剩余 {remaining}</span> : null}
            </div>
            <div className="mobile-more-chips">
              {TIMER_PRESETS.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  role="menuitemradio"
                  aria-checked={timerActive && timerPreset === minutes}
                  className={
                    timerActive && timerPreset === minutes
                      ? 'mobile-more-chip is-on'
                      : 'mobile-more-chip'
                  }
                  onClick={() => {
                    onTimerChange(minutes);
                    setOpen(false);
                  }}
                >
                  {minutes}分
                </button>
              ))}
              {timerActive && (
                <button
                  type="button"
                  role="menuitem"
                  className="mobile-more-chip is-cancel"
                  onClick={() => {
                    onTimerChange(null);
                    setOpen(false);
                  }}
                >
                  取消
                </button>
              )}
            </div>
          </div>

          <div className="mobile-more-section">
            <span className="mobile-more-label">明暗外观</span>
            <div className="mobile-more-chips">
              {THEMES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={theme === option.value}
                  className={theme === option.value ? 'mobile-more-chip is-on' : 'mobile-more-chip'}
                  onClick={() => onThemeChange(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mobile-more-section">
            <span className="mobile-more-label">界面配色</span>
            <div className="mobile-more-chips">
              {PALETTES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={palette === option.value}
                  className={palette === option.value ? 'mobile-more-chip is-on' : 'mobile-more-chip'}
                  onClick={() => onPaletteChange(option.value)}
                >
                  <span
                    className="palette-swatch"
                    style={{ '--swatch': option.swatch } as CSSProperties}
                    aria-hidden="true"
                  />
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            role="menuitem"
            className="mobile-more-refresh"
            onClick={handleForceRefresh}
            disabled={refreshing}
          >
            <RefreshIcon width={14} height={14} />
            <span>{refreshing ? '正在刷新缓存…' : '强制刷新（清除缓存）'}</span>
          </button>
        </div>
      )}
    </div>
  );
}
