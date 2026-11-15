import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { Scenario, Settings } from '../types';
import { ThemeToggle } from './ThemeToggle';
import { BgmToggle } from './BgmToggle';
import { PaletteToggle } from './PaletteToggle';
import { FullscreenToggle } from './FullscreenToggle';
import { ForceRefreshButton } from './ForceRefreshButton';
import { GridIcon, ListIcon, ShuffleIcon } from './Icons';
import { Furigana } from '../lib/furigana';
import {
  CATEGORY_OPTIONS,
  isSceneCategory,
  sceneCategory,
  type CategoryFilter,
  type SceneCategory,
} from '../lib/sceneCategories';
import { SceneCategoryFilter } from './SceneCategoryFilter';

interface Props {
  scenarios: Scenario[];
  settings: Settings;
  bgm: boolean;
  onBgmChange: (enabled: boolean) => void;
  onSettingsChange: (patch: Partial<Settings>) => void;
  onOpen: (id: string) => void;
}

type KindFilter = 'all' | 'dialogue' | 'passage' | 'jlpt';

const KIND_OPTIONS: Array<{ value: KindFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'dialogue', label: '对话' },
  { value: 'passage', label: '短文' },
  { value: 'jlpt', label: 'JLPT' },
];

const FILTER_STORAGE_KEY = 'scene-lab:filter:v1';
let lastRandomId: string | null = null;

interface StoredFilters {
  kind: KindFilter;
  category: CategoryFilter;
}

function readStoredFilters(): StoredFilters {
  try {
    const raw = sessionStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return { kind: 'all', category: 'all' };
    const parsed = JSON.parse(raw) as Partial<StoredFilters>;
    const kind = KIND_OPTIONS.some((item) => item.value === parsed.kind)
      ? (parsed.kind as KindFilter)
      : 'all';
    const category = parsed.category === 'all' || isSceneCategory(parsed.category)
      ? (parsed.category as CategoryFilter)
      : 'all';
    return { kind, category };
  } catch {
    return { kind: 'all', category: 'all' };
  }
}

export function ScenarioList({
  scenarios,
  settings,
  bgm,
  onBgmChange,
  onSettingsChange,
  onOpen,
}: Props) {
  const [storedFilters] = useState(readStoredFilters);
  const [kind, setKind] = useState<KindFilter>(storedFilters.kind);
  const [category, setCategory] = useState<CategoryFilter>(storedFilters.category);

  const totalLines = scenarios.reduce((sum, scene) => sum + scene.lines.length, 0);

  const categoryCounts = useMemo(() => {
    const result = Object.fromEntries([
      ...CATEGORY_OPTIONS.map((option) => [option.value, 0]),
      ['other', 0],
    ]) as Record<SceneCategory, number>;
    for (const scene of scenarios) {
      result[sceneCategory(scene)] += 1;
    }
    return result;
  }, [scenarios]);

  const activeFilters = Boolean(kind !== 'all' || category !== 'all');

  const filtered = useMemo(
    () =>
      scenarios.filter((scene) => {
        if (category !== 'all' && sceneCategory(scene) !== category) return false;
        if (kind !== 'all' && (scene.kind ?? 'dialogue') !== kind) return false;
        return true;
      }),
    [scenarios, category, kind],
  );

  const filteredLines = filtered.reduce((sum, scene) => sum + scene.lines.length, 0);
  const filteredHasDialogue = filtered.some((scene) => scene.kind !== 'passage');
  const filteredHasPassage = filtered.some((scene) => scene.kind === 'passage');
  const filteredUnit =
    filteredHasDialogue && filteredHasPassage ? '句/段' : filteredHasPassage ? '段' : '句';

  useEffect(() => {
    if (category !== 'all' && (categoryCounts[category] ?? 0) === 0) {
      setCategory('all');
    }
  }, [category, categoryCounts]);

  useEffect(() => {
    try {
      sessionStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({ kind, category }));
    } catch {
      // 隐私模式下忽略即可。
    }
  }, [kind, category]);

  const resetFilters = () => {
    setKind('all');
    setCategory('all');
  };

  const randomStudy = () => {
    if (!filtered.length) return;
    let pool = filtered;
    if (filtered.length > 1 && lastRandomId) {
      const withoutLast = filtered.filter((scene) => scene.id !== lastRandomId);
      if (withoutLast.length) pool = withoutLast;
    }
    const scene = pool[Math.floor(Math.random() * pool.length)];
    lastRandomId = scene.id;
    onOpen(scene.id);
  };

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            あ
          </span>
          <span className="brand-name">Scene Lab</span>
          <span className="brand-sub">场景日语</span>
        </div>
        <div className="topbar-actions">
          <BgmToggle enabled={bgm} onChange={onBgmChange} />
          <ThemeToggle
            mode={settings.theme}
            onChange={(theme) => onSettingsChange({ theme })}
          />
          <PaletteToggle
            palette={settings.palette}
            onChange={(palette) => onSettingsChange({ palette })}
          />
          <ForceRefreshButton />
          <FullscreenToggle />
        </div>
      </header>

      <main className="home">
        <div className="home-head">
          <h1>场景</h1>
          <div className="home-tools">
            <button
              type="button"
              className="random-btn"
              onClick={randomStudy}
              disabled={!filtered.length}
              title="从当前筛选结果随机打开一个场景"
            >
              <ShuffleIcon width={14} height={14} />
              <span>随机学</span>
            </button>
            <div className="view-toggle" role="group" aria-label="显示方式">
              <button
                type="button"
                className={settings.view === 'list' ? 'view-btn is-on' : 'view-btn'}
                onClick={() => onSettingsChange({ view: 'list' })}
                aria-pressed={settings.view === 'list'}
                aria-label="列表模式"
                title="列表模式"
              >
                <ListIcon width={15} height={15} />
              </button>
              <button
                type="button"
                className={settings.view === 'card' ? 'view-btn is-on' : 'view-btn'}
                onClick={() => onSettingsChange({ view: 'card' })}
                aria-pressed={settings.view === 'card'}
                aria-label="卡片模式"
                title="卡片模式"
              >
                <GridIcon width={15} height={15} />
              </button>
            </div>
            <span className="home-count" aria-live="polite">
              {activeFilters
                ? `找到 ${filtered.length} 个 · ${filteredLines} ${filteredUnit}`
                : `${scenarios.length} 个 · ${totalLines} 句/段`}
            </span>
          </div>
        </div>

        <SceneCategoryFilter value={category} onChange={setCategory} counts={categoryCounts} />

        <div className="filter-row home-filter-row">
          <div className="filter-group" role="group" aria-label="按类型筛选">
            <span className="filter-label">类型</span>
            {KIND_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={kind === option.value ? 'filter-chip is-on' : 'filter-chip'}
                onClick={() => setKind(option.value)}
                aria-pressed={kind === option.value}
              >
                {option.label}
              </button>
            ))}
          </div>

          {activeFilters ? (
            <button type="button" className="filter-reset" onClick={resetFilters}>
              重置
            </button>
          ) : null}
        </div>

        {filtered.length === 0 ? (
          scenarios.length === 0 ? (
            <div className="empty-state">
              <strong>暂无场景</strong>
              <p>当前还没有添加场景。</p>
            </div>
          ) : (
            <div className="empty-state">
              <strong>没有符合条件的场景</strong>
              <p>换个分类或类型试试。</p>
              <button type="button" onClick={resetFilters}>
                清除筛选
              </button>
            </div>
          )
        ) : settings.view === 'card' ? (
          <ul key="cards" className="scene-cards">
            {filtered.map((scene) => (
              <li
                key={scene.id}
                className="scene-card"
                style={
                  {
                    '--scene-light': scene.accent,
                    '--scene-dark': scene.accentDark,
                  } as CSSProperties
                }
              >
                <button
                  type="button"
                  className="scene-card-main"
                  onClick={() => onOpen(scene.id)}
                >
                  <span className="card-head">
                    <span className="scene-icon" aria-hidden="true">
                      {scene.emoji}
                    </span>
                    <span className="card-head-right">
                      {scene.kind === 'passage' ? (
                        <span className="kind-badge">短文</span>
                      ) : scene.kind === 'jlpt' ? (
                        <span className="kind-badge">{scene.jlpt ? `JLPT ${scene.jlpt.level}` : 'JLPT'}</span>
                      ) : null}
                    </span>
                  </span>
                  <span className="card-title" lang="ja">
                    <Furigana text={scene.title} />
                  </span>
                  <span className="card-zh">{scene.titleZh}</span>
                  <span className="card-foot">
                    <span>{scene.lines.length} {scene.kind === 'passage' ? '段' : '句'}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <ul key="list" className="scene-list">
            {filtered.map((scene) => (
              <li
                key={scene.id}
                className="scene-row"
                style={
                  {
                    '--scene-light': scene.accent,
                    '--scene-dark': scene.accentDark,
                  } as CSSProperties
                }
              >
                <button type="button" className="scene" onClick={() => onOpen(scene.id)}>
                  <span className="scene-icon" aria-hidden="true">
                    {scene.emoji}
                  </span>
                  <span className="scene-main">
                    <span className="scene-title">
                      <span className="scene-jp" lang="ja">
                        <Furigana text={scene.title} />
                      </span>
                      <span className="scene-zh">{scene.titleZh}</span>
                      {scene.kind === 'passage' ? (
                        <span className="kind-badge">短文</span>
                      ) : scene.kind === 'jlpt' ? (
                        <span className="kind-badge">{scene.jlpt ? `JLPT ${scene.jlpt.level}` : 'JLPT'}</span>
                      ) : null}
                    </span>
                  </span>
                  <span className="scene-side">
                    <span className="scene-count">{scene.lines.length} {scene.kind === 'passage' ? '段' : '句'}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
