import { useCallback, useState } from 'react';

const FAVORITES_KEY = 'scene-lab:favorites:v1';

function readFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeFavorites(ids: string[]): void {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids));
  } catch {
    // 隐私模式忽略
  }
}

export function useFavorites() {
  const [ids, setIds] = useState<string[]>(readFavorites);

  const isFavorite = useCallback((id: string) => ids.includes(id), [ids]);

  const toggleFavorite = useCallback((id: string) => {
    setIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      writeFavorites(next);
      return next;
    });
  }, []);

  return {
    favoriteIds: ids,
    favoriteCount: ids.length,
    isFavorite,
    toggleFavorite,
  };
}
