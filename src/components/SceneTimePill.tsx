interface Props {
  current: number;
  duration: number;
  countdown: boolean;
  onToggleMode: () => void;
}

function formatSec(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function SceneTimePill({ current, duration, countdown, onToggleMode }: Props) {
  const valid = duration > 0;
  const remaining = Math.max(0, duration - current);
  const left = !valid
    ? '--:--'
    : countdown
      ? `-${formatSec(remaining)}`
      : formatSec(current);
  const total = valid ? formatSec(duration) : '--:--';

  return (
    <button
      type="button"
      className={countdown ? 'scene-time is-countdown' : 'scene-time'}
      onClick={onToggleMode}
      aria-label={countdown ? `剩余时间 ${left}，总时长 ${total}，点击切换正计时` : `已播放 ${left}，总时长 ${total}，点击切换倒计时`}
      title={countdown ? '倒计时（点击切换为正计时）' : '正计时（点击切换为倒计时）'}
    >
      <span>{left}</span>
      <span className="scene-time-sep">/</span>
      <span className="scene-time-total">{total}</span>
    </button>
  );
}
