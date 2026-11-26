import { useEffect, useRef, useState, type CSSProperties } from 'react';

type Phase = 'idle' | 'pulling' | 'ready' | 'refreshing' | 'error';

const THRESHOLD = 64;

function isInsideExcludedArea(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest('.menu-popover, .scene-menu, .sheet-layer, .ai-pane, .focus-overlay, .gloss-popover'))
  );
}

function hasScrolledAncestor(target: EventTarget | null): boolean {
  let node = target instanceof Element ? target : null;
  while (node && node !== document.body) {
    const style = getComputedStyle(node);
    if (
      (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
      node.scrollHeight > node.clientHeight + 1 &&
      node.scrollTop > 0
    ) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
}

async function deleteStaleShellCaches(): Promise<void> {
  if (!('caches' in window)) return;
  const names = await caches.keys();
  await Promise.all(
    names.map(async (name) => {
      const cache = await caches.open(name);
      const requests = await cache.keys();
      await Promise.all(
        requests
          .filter((request) => !request.url.split('?')[0].toLowerCase().endsWith('.mp3'))
          .map((request) => cache.delete(request)),
      );
    }),
  );
}

async function forceRefresh(): Promise<void> {
  if (navigator.onLine === false) {
    throw new Error('offline');
  }

  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations.map(async (registration) => {
        try {
          await Promise.race([
            registration.update(),
            new Promise((resolve) => window.setTimeout(resolve, 4000)),
          ]);
        } catch {
          // 网络失败时仍然继续执行强制刷新。
        }
        try {
          registration.active?.postMessage({ type: 'SKIP_WAITING' });
          registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
          await registration.unregister();
        } catch {
          // 忽略单个 registration 的失败。
        }
      }),
    );
  }

  await deleteStaleShellCaches();

  const url = new URL(window.location.href);
  url.searchParams.set('_refresh', Date.now().toString());
  window.location.replace(url.toString());
}

export function PullToRefresh() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [distance, setDistance] = useState(0);
  const startY = useRef<number | null>(null);
  const startX = useRef<number | null>(null);
  const distanceRef = useRef(0);
  const refreshingRef = useRef(false);
  const errorTimer = useRef<number | null>(null);

  useEffect(() => {
    const reset = () => {
      startY.current = null;
      startX.current = null;
      distanceRef.current = 0;
      setDistance(0);
      setPhase((current) => (current === 'refreshing' ? current : 'idle'));
    };

    const refresh = async () => {
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      setPhase('refreshing');
      setDistance(THRESHOLD);
      try {
        await forceRefresh();
      } catch {
        refreshingRef.current = false;
        setPhase('error');
        setDistance(0);
        if (errorTimer.current) window.clearTimeout(errorTimer.current);
        errorTimer.current = window.setTimeout(() => setPhase('idle'), 1800);
      }
    };

    const onStart = (event: TouchEvent) => {
      if (refreshingRef.current || event.touches.length !== 1) return;
      if (window.scrollY > 0 || isInsideExcludedArea(event.target)) return;
      if (hasScrolledAncestor(event.target)) return;
      startY.current = event.touches[0].clientY;
      startX.current = event.touches[0].clientX;
    };

    const onMove = (event: TouchEvent) => {
      if (startY.current === null || startX.current === null) return;
      if (event.touches.length !== 1) {
        reset();
        return;
      }
      const dy = event.touches[0].clientY - startY.current;
      const dx = event.touches[0].clientX - startX.current;
      if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) {
        reset();
        return;
      }
      if (window.scrollY > 0 || hasScrolledAncestor(event.target)) {
        reset();
        return;
      }
      if (dy > 4) event.preventDefault();
      const next = Math.min(96, dy * 0.55);
      distanceRef.current = next;
      setDistance(next);
      setPhase(next >= THRESHOLD ? 'ready' : 'pulling');
    };

    const onEnd = () => {
      if (startY.current === null) return;
      const shouldRefresh = distanceRef.current >= THRESHOLD;
      startY.current = null;
      startX.current = null;
      if (shouldRefresh) {
        void refresh();
      } else {
        reset();
      }
    };

    const onCancel = () => {
      if (!refreshingRef.current) reset();
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onCancel);

    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onCancel);
      if (errorTimer.current) window.clearTimeout(errorTimer.current);
    };
  }, []);

  const label =
    phase === 'refreshing'
      ? '正在获取最新版本…'
      : phase === 'error'
        ? '刷新失败，请检查网络'
        : phase === 'ready'
          ? '松开强制刷新'
          : '下拉强制刷新';

  return (
    <div
      className={`pull-refresh is-${phase}`}
      style={{ '--pull-distance': `${distance}px` } as CSSProperties}
      role="status"
      aria-live="polite"
      aria-hidden={phase === 'idle'}
    >
      <span className="pull-refresh-icon" aria-hidden="true">
        {phase === 'refreshing' ? <span className="pull-refresh-spinner" /> : '↓'}
      </span>
      <span>{label}</span>
    </div>
  );
}
