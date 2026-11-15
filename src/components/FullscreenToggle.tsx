import { ExitFullscreenIcon, FullscreenIcon } from './Icons';
import { useFullscreen } from '../lib/useFullscreen';

export function FullscreenToggle() {
  const { isFullscreen, toggleFullscreen } = useFullscreen();

  return (
    <button
      type="button"
      className={isFullscreen ? 'icon-btn fullscreen-btn is-on' : 'icon-btn fullscreen-btn'}
      onClick={toggleFullscreen}
      aria-label={isFullscreen ? '退出全屏' : '网页全屏'}
      aria-pressed={isFullscreen}
      title={isFullscreen ? '退出全屏 (F)' : '网页全屏 (F)'}
    >
      {isFullscreen ? (
        <ExitFullscreenIcon width={15} height={15} />
      ) : (
        <FullscreenIcon width={15} height={15} />
      )}
    </button>
  );
}
