import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { Scenario } from '../types';
import { Furigana } from '../lib/furigana';
import { stripFurigana } from '../lib/copy';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ListIcon,
  SearchIcon,
  ShuffleIcon,
} from './Icons';

interface Props {
  scenarios: Scenario[];
  currentId: string;
  onSelect: (id: string) => void;
}

export function SceneSwitcher({ scenarios, currentId, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return scenarios.filter((scene) => {
      if (!needle) return true;
      return `${stripFurigana(scene.title)} ${scene.titleZh}`.toLocaleLowerCase().includes(needle);
    });
  }, [scenarios, query]);
  const currentIndex = scenarios.findIndex((scene) => scene.id === currentId);
  const prevScene = currentIndex > 0 ? scenarios[currentIndex - 1] : null;
  const nextScene = currentIndex >= 0 && currentIndex < scenarios.length - 1 ? scenarios[currentIndex + 1] : null;

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      const current = menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]');
      current?.scrollIntoView({ block: 'center' });
      searchRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
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
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT') {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        items[0]?.focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        items[items.length - 1]?.focus();
      }
      return;
    }
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

  const choose = (id: string) => {
    setOpen(false);
    if (id === currentId) {
      triggerRef.current?.focus();
      return;
    }
    onSelect(id);
  };

  const go = (scene: Scenario | null) => {
    if (!scene) return;
    setOpen(false);
    onSelect(scene.id);
  };

  const randomScene = () => {
    const pool = scenarios.filter((scene) => scene.id !== currentId);
    if (!pool.length) return;
    const scene = pool[Math.floor(Math.random() * pool.length)];
    setOpen(false);
    onSelect(scene.id);
  };

  return (
    <div className="scene-nav" ref={rootRef}>
      <button
        type="button"
        className="scene-step-btn"
        onClick={() => go(prevScene)}
        disabled={!prevScene}
        aria-label="上一个场景"
        title="上一个场景"
        data-short="上场"
      >
        <ChevronLeftIcon width={15} height={15} className="scene-step-icon" />
        <span className="scene-step-label" aria-hidden="true">上一场</span>
      </button>
      <div className="menu-wrap">
      <button
        ref={triggerRef}
        type="button"
        className="scene-switch-btn"
        onClick={() => {
          if (open) {
            setOpen(false);
          } else {
            setQuery('');
            setOpen(true);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setQuery('');
            setOpen(true);
          }
        }}
        aria-label="切换场景"
        aria-haspopup="menu"
        aria-expanded={open}
        title="切换场景"
      >
        <ListIcon width={15} height={15} className="scene-switch-icon" />
        <span className="scene-switch-label">场景</span>
        <ChevronDownIcon width={13} height={13} className="scene-switch-caret" />
      </button>

      {open && (
        <div
          ref={menuRef}
          className="menu-popover scene-menu"
          role="menu"
          aria-label="切换场景"
          onKeyDown={onMenuKeyDown}
        >
          <div className="scene-menu-head">
            <span>切换场景</span>
            <span>{filtered.length} / {scenarios.length} 个</span>
          </div>
          <div className="scene-menu-tools">
            <label className="scene-menu-search">
              <SearchIcon width={14} height={14} />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索场景标题"
                aria-label="搜索场景标题"
              />
            </label>
          </div>
          <div className="scene-menu-list">
            {filtered.map((scene) => {
              const current = scene.id === currentId;
              return (
                <button
                  key={scene.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={current}
                  tabIndex={-1}
                  className="scene-menu-item"
                  onClick={() => choose(scene.id)}
                >
                  <span className="scene-menu-emoji" aria-hidden="true">
                    {scene.emoji}
                  </span>
                  <span className="scene-menu-main">
                    <span className="scene-menu-title" lang="ja">
                      <Furigana text={scene.title} />
                    </span>
                    <span className="scene-menu-zh">{scene.kind === 'passage' ? '短文 · ' : ''}{scene.titleZh}</span>
                  </span>
                  <span className="scene-menu-check" aria-hidden="true">
                    {current ? <CheckIcon width={14} height={14} /> : null}
                  </span>
                </button>
              );
            })}
            {!filtered.length && (
              <div className="scene-menu-empty">没有匹配的场景</div>
            )}
          </div>
        </div>
      )}
      </div>
      <button
        type="button"
        className="scene-step-btn"
        onClick={() => go(nextScene)}
        disabled={!nextScene}
        aria-label="下一个场景"
        title="下一个场景"
        data-short="下场"
      >
        <ChevronRightIcon width={15} height={15} className="scene-step-icon" />
        <span className="scene-step-label" aria-hidden="true">下一场</span>
      </button>
      <button
        type="button"
        className="scene-step-btn scene-random-btn"
        onClick={randomScene}
        aria-label="随机切换场景"
        title="随机切换场景"
      >
        <ShuffleIcon width={14} height={14} />
        <span className="scene-random-label">随机</span>
      </button>
    </div>
  );
}
