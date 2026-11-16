import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import scenariosData from './data/scenarios.json';
import type { Scenario, Settings, ThemeMode } from './types';
import { loadState, saveState } from './lib/storage';
import { useBgm } from './lib/useBgm';
import { useFavorites } from './lib/favorites';
import { stripFurigana } from './lib/copy';
import { ScenarioList } from './components/ScenarioList';
import { PlayerView } from './components/PlayerView';
import { resetFocusChrome } from './components/FocusLyricsOverlay';
import { PullToRefresh } from './components/PullToRefresh';

const scenarios = scenariosData as Scenario[];

function readSceneId(): string | null {
  const match = window.location.hash.match(/^#\/s\/([a-z0-9-]+)/i);
  return match?.[1] ?? null;
}

export default function App() {
  const [state, setState] = useState(loadState);
  const [sceneId, setSceneId] = useState<string | null>(readSceneId);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  );

  const { settings } = state;
  const activeForBgm = useMemo(
    () => (sceneId ? scenarios.find((s) => s.id === sceneId) : undefined),
    [sceneId],
  );

  useBgm(
    settings.bgm || Boolean(activeForBgm?.bgm),
    activeForBgm?.bgm,
    activeForBgm?.bgm ? 0.14 : undefined,
  );

  useEffect(() => {
    const onHashChange = () => setSceneId(readSceneId());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    saveState(state);
  }, [state]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const resolvedTheme =
    settings.theme === 'auto' ? (systemDark ? 'dark' : 'light') : settings.theme;

  const active = useMemo(
    () => scenarios.find((scene) => scene.id === sceneId) ?? null,
    [sceneId],
  );

  const edgeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.palette = settings.palette;
    const style = getComputedStyle(document.documentElement);
    const surface = style.getPropertyValue('--surface').trim() || style.getPropertyValue('--bg').trim();
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', surface || (resolvedTheme === 'dark' ? '#1c1e23' : '#fffdf9'));

    // 切页 / 换主题后强制顶端实色条重新合成，让 WebKit 重新采样顶部颜色，避免掉回模糊。
    const frame = window.requestAnimationFrame(() => {
      const edge = edgeRef.current;
      if (!edge) return;
      edge.style.display = 'none';
      void edge.offsetHeight;
      edge.style.display = '';
    });
    return () => window.cancelAnimationFrame(frame);
  }, [resolvedTheme, settings.palette, active]);

  useEffect(() => {
    document.title = active ? `${stripFurigana(active.title)} · Scene Lab` : 'Scene Lab · 场景日语';
    window.scrollTo(0, 0);
  }, [active]);

  const [autoPlayNext, setAutoPlayNext] = useState(false);
  const [replayTick, setReplayTick] = useState(0);
  const [focusMode, setFocusMode] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const { isFavorite, toggleFavorite, favoriteCount } = useFavorites();

  useEffect(() => {
    if (!focusMode) resetFocusChrome();
  }, [focusMode]);
  const [timerEndAt, setTimerEndAt] = useState<number | null>(null);
  const [timerPreset, setTimerPreset] = useState<number | null>(null);
  const [timerStopTick, setTimerStopTick] = useState(0);

  const open = useCallback((id: string) => {
    setAutoPlayNext(false);
    window.location.hash = `#/s/${id}`;
  }, []);

  const back = useCallback(() => {
    setAutoPlayNext(false);
    setFocusMode(false);
    setAiOpen(false);
    window.location.hash = '#/';
  }, []);

  const advanceToRandomScene = useCallback(() => {
    if (!active) return;
    const pool = scenarios.length > 1
      ? scenarios.filter((s) => s.id !== active.id)
      : scenarios;
    const next = pool[Math.floor(Math.random() * pool.length)];
    if (!next) return;
    setAutoPlayNext(true);
    if (next.id === active.id) {
      setReplayTick((t) => t + 1);
    } else {
      window.location.hash = `#/s/${next.id}`;
    }
  }, [active]);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setState((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }));
  }, []);

  const setPlaybackTimer = useCallback((minutes: number | null) => {
    if (minutes === null || minutes <= 0) {
      setTimerEndAt(null);
      setTimerPreset(null);
      return;
    }
    setTimerEndAt(Date.now() + minutes * 60_000);
    setTimerPreset(minutes);
  }, []);

  useEffect(() => {
    if (timerEndAt === null) return;
    const triggerStop = () => {
      if (Date.now() < timerEndAt) return false;
      setTimerEndAt(null);
      setTimerPreset(null);
      setAutoPlayNext(false);
      updateSettings({ bgm: false });
      setTimerStopTick((t) => t + 1);
      return true;
    };
    if (triggerStop()) return;
    const timeoutId = window.setTimeout(
      triggerStop,
      Math.max(0, timerEndAt - Date.now()) + 50,
    );
    const onVisibility = () => {
      if (document.visibilityState === 'visible') triggerStop();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearTimeout(timeoutId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [timerEndAt, updateSettings]);

  const changeTheme = useCallback(
    (theme: ThemeMode) => {
      updateSettings({ theme });
    },
    [updateSettings],
  );

  return (
    <div className="app">
      <div ref={edgeRef} className="top-edge" aria-hidden="true" />
      {active ? (
        <PlayerView
          key={`${active.id}:${replayTick}`}
          scenario={active}
          scenarios={scenarios}
          settings={settings}
          theme={settings.theme}
          bgm={settings.bgm}
          autoPlay={autoPlayNext}
          onBgmChange={(bgm) => updateSettings({ bgm })}
          onBack={back}
          onThemeChange={changeTheme}
          onSettingsChange={updateSettings}
          onSceneChange={open}
          onSceneEnd={advanceToRandomScene}
          timerEndAt={timerEndAt}
          timerPreset={timerPreset}
          timerStopTick={timerStopTick}
          onTimerChange={setPlaybackTimer}
          focusMode={focusMode}
          onFocusModeChange={setFocusMode}
          aiOpen={aiOpen}
          onAiOpenChange={setAiOpen}
          isFavorite={isFavorite(active.id)}
          onToggleFavorite={() => toggleFavorite(active.id)}
        />
      ) : (
        <ScenarioList
          scenarios={scenarios}
          settings={settings}
          bgm={settings.bgm}
          onBgmChange={(bgm) => updateSettings({ bgm })}
          onSettingsChange={updateSettings}
          onOpen={open}
          isFavorite={isFavorite}
          onToggleFavorite={toggleFavorite}
          favoriteCount={favoriteCount}
        />
      )}
      <PullToRefresh />
    </div>
  );
}
