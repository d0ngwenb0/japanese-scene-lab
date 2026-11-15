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
  const progress = valid
    ? Math.min(1, Math.max(0, (countdown ? remaining : current) / duration))
    : 0;
  const display = !valid
    ? '--:--'
    : countdown
      ? formatSec(remaining)
      : formatSec(current);
  const total = valid ? formatSec(duration) : '--:--';

  const r = 15.5;
  const circumference = 2 * Math.PI * r;
  const dashOffset = circumference * (1 - progress);

  return (
    <button
      type="button"
      className={countdown ? 'scene-time is-countdown' : 'scene-time'}
      onClick={onToggleMode}
      aria-label={countdown ? `倒计时 ${display}，总时长 ${total}，点击切换正计时` : `已播放 ${display}，总时长 ${total}，点击切换倒计时`}
      title={countdown ? `倒计时 ${display} / 总时长 ${total}（点击切换正计时）` : `已播 ${display} / 总时长 ${total}（点击切换倒计时）`}
    >
      <svg className="scene-time-ring" viewBox="0 0 36 36" aria-hidden="true">
        <circle className="scene-time-track" cx="18" cy="18" r={r} />
        <circle
          className="scene-time-fill"
          cx="18"
          cy="18"
          r={r}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <span className="scene-time-text">
        <span className="scene-time-cur">{display}</span>
      </span>
    </button>
  );
}
