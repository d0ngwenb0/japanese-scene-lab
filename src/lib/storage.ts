import type { Settings } from '../types';

const VERSION = 2;

const KEY = 'scene-lab:v1';

export interface PersistedState {
  version: number;
  settings: Settings;
}

export const defaultSettings: Settings = {
  rate: 1,
  volume: 1,
  loop: 'off',
  theme: 'auto',
  palette: 'default',
  view: 'card',
  posColor: false,
};

const fallback: PersistedState = { version: VERSION, settings: defaultSettings };

const VIEW_DEFAULT_CARD_KEY = 'scene-lab:view-default-card:v1';

export function loadState(): PersistedState {
  try {
    let cardDefaulting = false;
    try {
      if (!localStorage.getItem(VIEW_DEFAULT_CARD_KEY)) {
        localStorage.setItem(VIEW_DEFAULT_CARD_KEY, '1');
        cardDefaulting = true;
      }
    } catch {
      // localStorage 不可写时仍以设置默认值为准。
    }

    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    const settings = { ...defaultSettings, ...(parsed.settings ?? {}) } as Settings & {
      customOrder?: unknown;
      uiStyle?: unknown;
    };
    delete settings.customOrder;
    delete settings.uiStyle;
    delete (settings as { furigana?: unknown }).furigana;
    delete (settings as { translation?: unknown }).translation;
    delete (settings as { sortMode?: unknown }).sortMode;
    delete (settings as { bgm?: unknown }).bgm;
    // 旧版本只有浅色/夜间两档：把旧的默认浅色迁移成自动，手动选的夜间保留。
    if (parsed.version !== VERSION && settings.theme === 'light') {
      settings.theme = 'auto';
    }
    if (![0.75, 1, 1.25].includes(settings.rate)) {
      settings.rate = 1;
    }
    if (typeof settings.volume !== 'number' || !Number.isFinite(settings.volume)) {
      settings.volume = 1;
    } else {
      settings.volume = Math.min(1, Math.max(0, Math.round(settings.volume * 100) / 100));
    }
    if (!['default', 'sakura', 'matcha', 'ocean'].includes(settings.palette)) {
      settings.palette = 'default';
    }
    if (cardDefaulting) {
      settings.view = 'card';
    } else if (!['list', 'card'].includes(settings.view)) {
      settings.view = 'card';
    }
    if (typeof settings.posColor !== 'boolean') {
      settings.posColor = false;
    }
    return {
      version: VERSION,
      settings,
    };
  } catch {
    return fallback;
  }
}

export function saveState(state: PersistedState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // 隐私模式下 localStorage 可能不可写，忽略即可。
  }
}
