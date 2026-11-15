import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { ThemeMode } from '../types';
import { AutoIcon, CheckIcon, MoonIcon, SunIcon } from './Icons';

interface Props {
  mode: ThemeMode;
  onChange: (mode: ThemeMode) => void;
}

const OPTIONS: Array<{ value: ThemeMode; label: string; hint: string }> = [
  { value: 'auto', label: '自动', hint: '跟随系统外观' },
  { value: 'light', label: '浅色', hint: '始终使用浅色' },
  { value: 'dark', label: '夜间', hint: '始终使用夜间' },
];

function ModeIcon({ mode, size }: { mode: ThemeMode; size: number }) {
  if (mode === 'light') return <SunIcon width={size} height={size} />;
  if (mode === 'dark') return <MoonIcon width={size} height={size} />;
  return <AutoIcon width={size} height={size} />;
}

export function ThemeToggle({ mode, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = OPTIONS.find((option) => option.value === mode) ?? OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [],
    );
    const active = items.find((item) => item.getAttribute('aria-checked') === 'true') ?? items[0];
    active?.focus();
  }, [open]);

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

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [],
    );
    if (!items.length) return;
    if (event.key === 'Tab') {
      window.setTimeout(() => setOpen(false), 0);
      return;
    }
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(index + 1 + items.length) % items.length].focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length].focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0].focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1].focus();
    }
  };

  return (
    <div className="menu-wrap" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="icon-btn theme-trigger"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
        aria-label={`明暗：${current.label}（${current.hint}）`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`明暗：${current.label}`}
      >
        <ModeIcon mode={mode} size={15} />
      </button>

      {open && (
        <div
          ref={menuRef}
          className="menu-popover"
          role="menu"
          aria-label="选择明暗"
          onKeyDown={onMenuKeyDown}
        >
          {OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={mode === option.value}
              tabIndex={-1}
              className="menu-item"
              onClick={() => {
                onChange(option.value);
                setOpen(false);
                triggerRef.current?.focus();
              }}
            >
              <ModeIcon mode={option.value} size={14} />
              <span>{option.label}</span>
              {mode === option.value && <CheckIcon width={13} height={13} className="theme-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
