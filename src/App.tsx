import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import scenariosData from './data/scenarios.json';
import type { Scenario, Settings, ThemeMode } from './types';
import { loadState, saveState } from './lib/storage';
import { useBgm } from './lib/useBgm';
import { stripFurigana } from './lib/copy';
import { ScenarioList } from './components/ScenarioList';
import { PlayerView } from './components/PlayerView';
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

  useBgm(settings.bgm);

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

  const open = useCallback((id: string) => {
    setAutoPlayNext(false);
    window.location.hash = `#/s/${id}`;
  }, []);

  const back = useCallback(() => {
    setAutoPlayNext(false);
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
        />
      ) : (
        <ScenarioList
          scenarios={scenarios}
          settings={settings}
          bgm={settings.bgm}
          onBgmChange={(bgm) => updateSettings({ bgm })}
          onSettingsChange={updateSettings}
          onOpen={open}
        />
      )}
      <PullToRefresh />
    </div>
  );
}
