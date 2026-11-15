import { useCallback, useEffect, useState } from 'react';

interface WebkitDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}

interface WebkitElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

let fallbackFullscreen = false;
const listeners = new Set<() => void>();

function getNativeFullscreenElement(): Element | null {
  if (typeof document === 'undefined') return null;
  const doc = document as WebkitDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

function readFullscreenState(): boolean {
  return Boolean(getNativeFullscreenElement()) || fallbackFullscreen;
}

function syncDocumentState() {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.fullscreen = readFullscreenState() ? 'true' : 'false';
  }
  for (const notify of listeners) notify();
}

async function enterFullscreen() {
  const el = document.documentElement as WebkitElement;
  try {
    if (el.requestFullscreen) {
      await el.requestFullscreen();
      fallbackFullscreen = false;
      syncDocumentState();
      return;
    }
    if (el.webkitRequestFullscreen) {
      await el.webkitRequestFullscreen();
      fallbackFullscreen = false;
      syncDocumentState();
      return;
    }
  } catch {
    // 浏览器或无手势环境下原生全屏被拒绝时回退到网页铺满模式。
  }
  fallbackFullscreen = true;
  syncDocumentState();
}

async function exitFullscreen() {
  fallbackFullscreen = false;
  const doc = document as WebkitDocument;
  try {
    if (doc.fullscreenElement && doc.exitFullscreen) {
      await doc.exitFullscreen();
    } else if (doc.webkitFullscreenElement && doc.webkitExitFullscreen) {
      await doc.webkitExitFullscreen();
    }
  } catch {
    // 忽略退出异常，确保状态回落。
  }
  syncDocumentState();
}

let bound = false;

function ensureGlobalListeners() {
  if (bound || typeof document === 'undefined' || typeof window === 'undefined') return;
  bound = true;

  const onFullscreenChange = () => {
    if (getNativeFullscreenElement()) {
      fallbackFullscreen = false;
    }
    syncDocumentState();
  };

  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);

  window.addEventListener(
    'keydown',
    (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="menu"]')) return;

      if (event.key === 'f' || event.key === 'F') {
        event.preventDefault();
        if (readFullscreenState()) void exitFullscreen();
        else void enterFullscreen();
        return;
      }

      if (event.key === 'Escape' && fallbackFullscreen && !document.querySelector('.menu-popover')) {
        event.preventDefault();
        event.stopPropagation();
        fallbackFullscreen = false;
        syncDocumentState();
      }
    },
    true,
  );
}

export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(readFullscreenState);

  useEffect(() => {
    ensureGlobalListeners();
    const update = () => setIsFullscreen(readFullscreenState());
    listeners.add(update);
    syncDocumentState();
    return () => {
      listeners.delete(update);
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (readFullscreenState()) void exitFullscreen();
    else void enterFullscreen();
  }, []);

  return { isFullscreen, toggleFullscreen };
}
