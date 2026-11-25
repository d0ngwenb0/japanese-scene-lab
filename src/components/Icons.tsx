import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function PlayIcon(props: IconProps) {
  return (
    <svg {...base} {...props} fill="currentColor" stroke="none">
      <path d="M8.2 5.2a1 1 0 0 1 1.53-.85l9.1 6.8a1 1 0 0 1 0 1.7l-9.1 6.8a1 1 0 0 1-1.53-.85z" />
    </svg>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <svg {...base} {...props} fill="currentColor" stroke="none">
      <rect x="7" y="5" width="3.6" height="14" rx="1.2" />
      <rect x="13.4" y="5" width="3.6" height="14" rx="1.2" />
    </svg>
  );
}

export function PrevIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M18.5 6.2v11.6L9 12z" fill="currentColor" stroke="none" />
      <path d="M6 5.5v13" />
    </svg>
  );
}

export function NextIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5.5 6.2v11.6L15 12z" fill="currentColor" stroke="none" />
      <path d="M18 5.5v13" />
    </svg>
  );
}

export function ReplayIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 10a8 8 0 1 1 2.3 5.7" />
      <path d="M4 4.5V10h5.5" />
    </svg>
  );
}

export function BackIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="3.8" />
      <path d="M12 3v2M12 19v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M3 12h2M19 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M19.5 14.1A7.5 7.5 0 0 1 9.9 4.5a7.5 7.5 0 1 0 9.6 9.6z" />
    </svg>
  );
}

export function AutoIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="7.2" />
      <path d="M12 4.8a7.2 7.2 0 0 1 0 14.4z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PaletteIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3a9 9 0 0 0 0 18h1.4a2.1 2.1 0 0 0 2.1-2.1c0-.55-.21-1.06-.58-1.45-.36-.38-.57-.88-.57-1.42 0-1.16.94-2.1 2.1-2.1H18a3 3 0 0 0 3-3c0-4.42-4.03-8-9-8z" />
      <circle cx="8.2" cy="10.2" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="11.5" cy="7.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15.3" cy="9.2" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="8.8" cy="14.2" r="1.8" fill="var(--swatch, currentColor)" stroke="none" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m16.5 16.5 4 4" />
    </svg>
  );
}

export function ShuffleIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M16 3h5v5" />
      <path d="M4 20 21 3" />
      <path d="M21 16v5h-5" />
      <path d="M15 15l6 6" />
      <path d="M4 4l5 5" />
    </svg>
  );
}

export function SparklesIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7z" />
      <path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z" />
      <path d="M5 14l.6 1.7L7.5 16l-1.9.6L5 18.5l-.6-1.9L2.5 16l1.9-.3z" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 5H5a2 2 0 0 0-2 2v10" />
    </svg>
  );
}

export function ListIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4.6" cy="6" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="4.6" cy="12" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="4.6" cy="18" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function GridIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.4" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.4" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.4" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.4" />
    </svg>
  );
}

export function BookIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
      <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20" />
    </svg>
  );
}

export function SendIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 19V5" />
      <path d="m6 11 6-6 6 6" />
    </svg>
  );
}

export function StopIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="7" y="7" width="10" height="10" rx="2" />
    </svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 7h16" />
      <path d="M9 7V5h6v2" />
      <path d="m7 7 1 12h8l1-12" />
      <path d="M10 11v5M14 11v5" />
    </svg>
  );
}

export function KeyIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="8" cy="12" r="3.5" />
      <path d="M11.5 12H20" />
      <path d="M17 12v3" />
      <path d="M20 12v2.5" />
    </svg>
  );
}

export function FullscreenIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9" />
      <path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9" />
      <path d="M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15" />
      <path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
    </svg>
  );
}

export function ExitFullscreenIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M9 4v3.5A1.5 1.5 0 0 1 7.5 9H4" />
      <path d="M15 4v3.5A1.5 1.5 0 0 0 16.5 9H20" />
      <path d="M20 15h-3.5a1.5 1.5 0 0 0-1.5 1.5V20" />
      <path d="M4 15h3.5A1.5 1.5 0 0 1 9 16.5V20" />
    </svg>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" />
      <path d="M4 3.5V8h4.5" />
      <path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" />
      <path d="M20 20.5V16h-4.5" />
    </svg>
  );
}

export function LoopAllIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m17 3 3.5 3.5L17 10" />
      <path d="M3.5 11.5v-1a4 4 0 0 1 4-4h13" />
      <path d="m7 21-3.5-3.5L7 14" />
      <path d="M20.5 12.5v1a4 4 0 0 1-4 4h-13" />
    </svg>
  );
}

export function LoopOneIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m17 3 3.5 3.5L17 10" />
      <path d="M3.5 11.5v-1a4 4 0 0 1 4-4h13" />
      <path d="m7 21-3.5-3.5L7 14" />
      <path d="M20.5 12.5v1a4 4 0 0 1-4 4h-13" />
      <path d="M11 10.6 12.4 9.5v5.2" />
    </svg>
  );
}

export function MicIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
      <path d="M9 21h6" />
    </svg>
  );
}

export function TimerIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 1.5" />
      <path d="M9.5 2.5h5" />
    </svg>
  );
}

export function LyricsIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 6h16" />
      <path d="M6 12h12" />
      <path d="M8 18h8" />
    </svg>
  );
}

export function StarIcon({ filled, ...props }: IconProps & { filled?: boolean }) {
  return (
    <svg
      {...base}
      {...props}
      fill={filled ? 'currentColor' : 'none'}
    >
      <path d="M12 2.8l2.85 5.77 6.37.93-4.61 4.49 1.09 6.34L12 17.34l-5.7 3 1.09-6.34-4.61-4.49 6.37-.93z" />
    </svg>
  );
}

export function VolumeIcon({
  level = 'high',
  ...props
}: IconProps & { level?: 'mute' | 'low' | 'high' }) {
  return (
    <svg {...base} {...props}>
      <path d="M11 5.5 6.8 9H4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h2.8L11 18.5z" />
      {level === 'mute' ? (
        <path d="m15.5 9.5 5 5M20.5 9.5l-5 5" />
      ) : level === 'low' ? (
        <path d="M15.2 9.4a4.2 4.2 0 0 1 0 5.2" />
      ) : (
        <>
          <path d="M15.2 9.4a4.2 4.2 0 0 1 0 5.2" />
          <path d="M18 6.8a7.8 7.8 0 0 1 0 10.4" />
        </>
      )}
    </svg>
  );
}
