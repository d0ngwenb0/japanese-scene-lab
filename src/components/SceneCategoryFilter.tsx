import type { CategoryFilter, SceneCategory } from '../lib/sceneCategories';
import { CATEGORY_OPTIONS } from '../lib/sceneCategories';

interface Props {
  value: CategoryFilter;
  onChange: (value: CategoryFilter) => void;
  counts: Record<SceneCategory, number>;
}

export function SceneCategoryFilter({ value, onChange, counts }: Props) {
  return (
    <div className="filter-row category-filter-row">
      <div className="filter-group category-filter" role="group" aria-label="按场景分类筛选">
        <span className="filter-label">分类</span>
        <div className="category-scroll">
          <button
            type="button"
            className={value === 'all' ? 'filter-chip category-chip is-on' : 'filter-chip category-chip'}
            onClick={() => onChange('all')}
            aria-pressed={value === 'all'}
          >
            全部
          </button>
          {CATEGORY_OPTIONS.filter((option) => counts[option.value] > 0 || value === option.value).map((option) => (
            <button
              key={option.value}
              type="button"
              className={
                value === option.value
                  ? 'filter-chip category-chip is-on'
                  : 'filter-chip category-chip'
              }
              onClick={() => onChange(option.value)}
              aria-pressed={value === option.value}
              title={`${option.label} · ${counts[option.value]} 个场景`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
