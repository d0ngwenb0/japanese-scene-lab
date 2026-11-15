import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { PaletteMode } from '../types';
import { CheckIcon, PaletteIcon } from './Icons';

interface Props {
  palette: PaletteMode;
  onChange: (palette: PaletteMode) => void;
}

const PALETTES: Array<{ value: PaletteMode; label: string; hint: string; swatch: string }> = [
  { value: 'default', label: '原色', hint: '默认暖纸', swatch: '#d94f36' },
  { value: 'sakura', label: '樱', hint: '柔和粉调', swatch: '#c15b78' },
  { value: 'matcha', label: '青竹', hint: '清爽绿调', swatch: '#5b7c4b' },
  { value: 'ocean', label: '海', hint: '冷静蓝调', swatch: '#3f6f9e' },
];

export function PaletteToggle({ palette, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = PALETTES.find((option) => option.value === palette) ?? PALETTES[0];

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
        className="icon-btn palette-trigger"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
        aria-label={`主题：${current.label}（${current.hint}）`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`主题：${current.label}`}
      >
        <PaletteIcon
          width={15}
          height={15}
          style={{ '--swatch': current.swatch } as CSSProperties}
        />
      </button>

      {open && (
        <div
          ref={menuRef}
          className="menu-popover palette-menu"
          role="menu"
          aria-label="选择主题"
          onKeyDown={onMenuKeyDown}
        >
          {PALETTES.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={palette === option.value}
              tabIndex={-1}
              className="menu-item palette-item"
              onClick={() => {
                onChange(option.value);
                setOpen(false);
                triggerRef.current?.focus();
              }}
            >
              <span
                className="palette-swatch"
                style={{ '--swatch': option.swatch } as CSSProperties}
                aria-hidden="true"
              />
              <span>{option.label}</span>
              {palette === option.value && (
                <CheckIcon width={13} height={13} className="theme-check" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
