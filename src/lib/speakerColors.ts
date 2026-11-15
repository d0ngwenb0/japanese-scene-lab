import type { Speaker } from '../types';

const OTHER_COLORS = ['var(--peer, var(--teal))', 'var(--indigo)', 'var(--gold)'];

/** 自己固定用场景主色；对方按出场顺序用青 / 靛 / 金区分。 */
export function getSpeakerColors(speakers: Speaker[]): Map<string, string> {
  const others = speakers.filter((speaker) => !speaker.self);
  return new Map(
    speakers.map((speaker) => {
      if (speaker.self) return [speaker.id, 'var(--accent)'] as const;
      const index = others.findIndex((item) => item.id === speaker.id);
      return [speaker.id, OTHER_COLORS[Math.max(index, 0) % OTHER_COLORS.length]] as const;
    }),
  );
}
