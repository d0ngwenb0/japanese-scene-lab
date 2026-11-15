import { useEffect, useRef, useState } from 'react';
import { CheckIcon, TimerIcon } from './Icons';

interface Props {
  endAt: number | null;
  activeMinutes: number | null;
  onSelect: (minutes: number | null) => void;
}

const PRESETS = [5, 10, 15, 30, 45, 60];

function formatRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function PlaybackTimer({ endAt, activeMinutes, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [customMinutes, setCustomMinutes] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const active = endAt !== null && endAt > now;
  const remainingText = active && endAt !== null ? formatRemaining(endAt - now) : '';

  useEffect(() => {
    if (endAt === null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [endAt]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const applyCustom = () => {
    const parsed = Math.round(Number(customMinutes));
    if (!Number.isFinite(parsed) || parsed < 1) return;
    onSelect(Math.min(360, parsed));
    setCustomMinutes('');
    setOpen(false);
  };

  return (
    <div className="menu-wrap" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={active ? 'icon-btn timer-btn is-on' : 'icon-btn timer-btn'}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={active ? `定时关闭：剩余 ${remainingText}` : '定时关闭'}
        title={active ? `定时关闭中，剩余 ${remainingText}` : '定时关闭（倒计时停止播放）'}
      >
        <TimerIcon width={15} height={15} />
        {active ? <span className="timer-badge">{remainingText}</span> : null}
      </button>
      {open && (
        <div className="menu-popover timer-popover" role="menu" aria-label="定时关闭">
          <div className="timer-head">
            <span className="timer-title">定时关闭</span>
            <span className="timer-hint">
              {active ? `剩余 ${remainingText}` : '到时自动暂停播放'}
            </span>
          </div>
          {PRESETS.map((minutes) => {
            const checked = active && activeMinutes === minutes;
            return (
              <button
                key={minutes}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                className="menu-item"
                onClick={() => {
                  onSelect(minutes);
                  setOpen(false);
                }}
              >
                <span>{minutes} 分钟</span>
                {checked && <CheckIcon className="theme-check" width={13} height={13} />}
              </button>
            );
          })}
          {active && (
            <button
              type="button"
              role="menuitem"
              className="menu-item timer-cancel"
              onClick={() => {
                onSelect(null);
                setOpen(false);
              }}
            >
              <span>取消定时</span>
            </button>
          )}
          <form
            className="timer-custom"
            onSubmit={(event) => {
              event.preventDefault();
              applyCustom();
            }}
          >
            <input
              type="number"
              min={1}
              max={360}
              inputMode="numeric"
              value={customMinutes}
              onChange={(event) => setCustomMinutes(event.target.value)}
              placeholder="自定义(分)"
              aria-label="自定义分钟数"
            />
            <button type="submit" disabled={!customMinutes.trim()}>
              开始
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
