import { useState } from 'react';
import { RefreshIcon } from './Icons';

/**
 * 强制刷新按钮：注销 Service Worker、清理 Cache Storage 并重新从网络加载页面。
 */
export function ForceRefreshButton() {
  const [refreshing, setRefreshing] = useState(false);

  const handleForceRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((reg) => reg.unregister()));
      }
      if ('caches' in window) {
        const keys = await window.caches.keys();
        await Promise.all(keys.map((key) => window.caches.delete(key)));
      }
      await fetch(window.location.href, { cache: 'reload' }).catch(() => {});
    } catch {
      // 忽略清理异常，继续执行重载。
    }
    window.location.reload();
  };

  return (
    <button
      type="button"
      className={refreshing ? 'icon-btn is-spinning' : 'icon-btn'}
      onClick={handleForceRefresh}
      disabled={refreshing}
      aria-label="强制刷新"
      title="强制刷新（清除缓存并重新加载）"
    >
      <RefreshIcon width={18} height={18} />
    </button>
  );
}
