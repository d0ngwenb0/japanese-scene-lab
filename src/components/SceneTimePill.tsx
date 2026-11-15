interface Props {
  current: number;
  duration: number;
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

export function SceneTimePill({ current, duration }: Props) {
  const valid = duration > 0;
  const remaining = Math.max(0, duration - current);
  const progress = valid ? Math.min(1, Math.max(0, remaining / duration)) : 0;
  const display = valid ? formatSec(remaining) : '--:--';
  const total = valid ? formatSec(duration) : '--:--';

  const r = 15.5;
  const circumference = 2 * Math.PI * r;
  const dashOffset = circumference * (1 - progress);

  return (
    <div
      className="scene-time"
      aria-label={`场景剩余时间 ${display}，总时长 ${total}`}
      title={`场景剩余 ${display} / 总时长 ${total}`}
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
    </div>
  );
}
