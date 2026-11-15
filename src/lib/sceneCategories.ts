import type { Scenario } from '../types';

export const CATEGORY_OPTIONS = [
  { value: 'work', label: '求职工作' },
  { value: 'shopping', label: '买东西' },
  { value: 'medical', label: '就医健康' },
  { value: 'food', label: '吃饭' },
  { value: 'transport', label: '出行交通' },
  { value: 'home', label: '居住邻里' },
  { value: 'admin', label: '行政手续' },
  { value: 'study', label: '学习校园' },
  { value: 'social', label: '交友日常' },
  { value: 'travel', label: '旅行住宿' },
  { value: 'service', label: '生活服务' },
  { value: 'opinion', label: '观点讨论' },
] as const;

export type SceneCategory = (typeof CATEGORY_OPTIONS)[number]['value'] | 'other';
export type CategoryFilter = 'all' | SceneCategory;

export function isSceneCategory(value: unknown): value is SceneCategory {
  return (
    value === 'other' ||
    CATEGORY_OPTIONS.some((option) => option.value === value)
  );
}

export function categoryLabel(category: SceneCategory): string {
  if (category === 'other') return '其他';
  return CATEGORY_OPTIONS.find((option) => option.value === category)?.label ?? '其他';
}

export function sceneCategory(scene: Pick<Scenario, 'id'> & { category?: string }): SceneCategory {
  return isSceneCategory(scene.category) ? scene.category : 'other';
}
