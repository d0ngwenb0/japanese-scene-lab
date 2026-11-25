import { useEffect, useRef, type CSSProperties } from 'react';
import { VolumeIcon } from './Icons';

interface Props {
  volume: number;
  onChange: (volume: number) => void;
}

export function VolumeControl({ volume, onChange }: Props) {
  const percent = Math.round(Math.min(1, Math.max(0, volume)) * 100);
  const muted = percent === 0;
  const lastNonZeroRef = useRef(volume > 0 ? volume : 1);

  useEffect(() => {
    if (volume > 0) {
      lastNonZeroRef.current = volume;
    }
  }, [volume]);

  const toggleMute = () => {
    if (muted) {
      onChange(lastNonZeroRef.current > 0 ? lastNonZeroRef.current : 1);
    } else {
      onChange(0);
    }
  };

  const level = muted ? 'mute' : percent <= 50 ? 'low' : 'high';
  const sliderStyle = {
    '--control-value': percent,
    '--attr-min': 0,
    '--attr-max': 100,
  } as CSSProperties;

  return (
    <div className="volume-control" role="group" aria-label="音量控制">
      <button
        type="button"
        className={muted ? 'pill pill-icon volume-btn is-muted' : 'pill pill-icon volume-btn'}
        onClick={toggleMute}
        aria-pressed={muted}
        aria-label={muted ? '取消静音' : '静音'}
        title={muted ? '取消静音（M）' : `音量 ${percent}%（M 静音）`}
        aria-keyshortcuts="M"
      >
        <VolumeIcon level={level} width={17} height={17} />
      </button>
      <div className="volume-slider-wrap">
        <input
          type="range"
          className="volume-slider"
          min={0}
          max={100}
          step={5}
          value={percent}
          style={sliderStyle}
          aria-label="音量"
          aria-valuetext={muted ? '静音' : `${percent}%`}
          onChange={(event) => {
            const nextPercent = Number(event.target.value);
            onChange(Math.min(1, Math.max(0, nextPercent / 100)));
          }}
        />
        <span className="volume-value" aria-hidden="true">
          {percent}%
        </span>
      </div>
    </div>
  );
}
