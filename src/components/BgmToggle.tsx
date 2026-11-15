import { MusicIcon, MusicOffIcon } from './Icons';

interface Props {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

export function BgmToggle({ enabled, onChange }: Props) {
  return (
    <button
      type="button"
      className={enabled ? 'icon-btn bgm-btn is-on' : 'icon-btn bgm-btn'}
      onClick={() => onChange(!enabled)}
      aria-label={enabled ? '关闭背景音乐' : '开启背景音乐'}
      aria-pressed={enabled}
      title={enabled ? '背景音乐：开（点击关闭）' : '背景音乐：关（点击开启）'}
    >
      {enabled ? <MusicIcon width={15} height={15} /> : <MusicOffIcon width={15} height={15} />}
    </button>
  );
}
