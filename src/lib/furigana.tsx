import type { ReactNode } from 'react';

const TOKEN = /\{([^{}|]+)\|([^{}|]+)\}/g;

/**
 * 把 {漢字|かんじ} 渲染成 <ruby>漢字<rt data-reading="かんじ" /></ruby>。
 * 注音由 CSS ::before 生成，不进入文本选区，避免复制/查词典时混入假名。
 */
export function Furigana({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;

  for (const match of text.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(text.slice(last, index));
    nodes.push(
      <ruby key={key++} aria-label={`${match[1]}（${match[2]}）`}>
        {match[1]}
        <rt data-reading={match[2]} aria-hidden="true" />
      </ruby>,
    );
    last = index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));

  return <>{nodes}</>;
}
