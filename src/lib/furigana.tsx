import { Fragment, type ReactNode } from 'react';

const TOKEN = /\{([^{}|]+)\|([^{}|]+)\}/g;

/**
 * 把 {漢字|かん じ} / {今日|きょう} 渲染成标准 HTML <ruby>：
 * - 读音用空格（或中点）分隔且段数等于字数时：单字对齐（モノルビ），保留在同一 <ruby> 内
 * - 读音不分隔时（单字或熟字训/当て字）：整词居中（グループルビ）
 * 注音由 CSS ::before 生成，不进入文本选区，避免复制/查词典时混入假名。
 */
export function Furigana({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;

  for (const match of text.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(text.slice(last, index));

    const base = match[1];
    const rawReading = match[2].trim();
    const parts = rawReading.split(/[\s・]+/).filter(Boolean);
    const chars = [...base];

    if (parts.length > 1 && parts.length === chars.length) {
      nodes.push(
        <ruby key={key++} className="is-mono" aria-label={`${base}（${parts.join('')}）`}>
          {chars.map((char, i) => (
            <Fragment key={i}>
              {char}
              <rt data-reading={parts[i]} aria-hidden="true" />
            </Fragment>
          ))}
        </ruby>,
      );
    } else {
      const reading = parts.join('');
      nodes.push(
        <ruby key={key++} aria-label={`${base}（${reading}）`}>
          {base}
          <rt data-reading={reading} aria-hidden="true" />
        </ruby>,
      );
    }

    last = index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));

  return <>{nodes}</>;
}
