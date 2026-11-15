import type { ReactNode } from 'react';

/** 轻量 Markdown 解析：标题、列表、代码、引用、表格、粗体/斜体/行内代码/链接。 */
export function renderMarkdown(text: string): ReactNode {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  const inline = (value: string): ReactNode[] => {
    const pattern = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[[^\]]+\]\([^)\s]+\)|~~[^~\n]+~~)/g;
    const parts = value.split(pattern);
    return parts.map((part, index) => {
      if (!part) return null;
      const k = `${index}-${part.slice(0, 8)}`;
      if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={k}>{part.slice(2, -2)}</strong>;
      if (/^\*[^*]+\*$/.test(part)) return <em key={k}>{part.slice(1, -1)}</em>;
      if (/^`[^`]+`$/.test(part)) return <code key={k}>{part.slice(1, -1)}</code>;
      if (/^~~[^~]+~~$/.test(part)) return <del key={k}>{part.slice(2, -2)}</del>;
      const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      if (link && /^(https?:\/\/|mailto:)/i.test(link[2])) {
        return (
          <a key={k} href={link[2]} target="_blank" rel="noreferrer">
            {link[1]}
          </a>
        );
      }
      return <span key={k}>{part}</span>;
    });
  };

  const isBlockStart = (line: string, next?: string): boolean => {
    const trimmed = line.trim();
    return (
      !trimmed ||
      /^```/.test(trimmed) ||
      /^#{1,6}\s+/.test(trimmed) ||
      /^>\s?/.test(trimmed) ||
      /^[-*+]\s+/.test(trimmed) ||
      /^\d+[.)]\s+/.test(trimmed) ||
      /^([-*_])\s*\1\s*\1/.test(trimmed) ||
      (trimmed.includes('|') && !!next && /^\s*\|?[\s:|-]+\|/.test(next))
    );
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (/^```/.test(trimmed)) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push(
        <pre key={key++}>
          <code>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(heading[1].length, 3);
      const content = inline(heading[2]);
      blocks.push(
        level === 1 ? (
          <h3 key={key++}>{content}</h3>
        ) : level === 2 ? (
          <h4 key={key++}>{content}</h4>
        ) : (
          <h5 key={key++}>{content}</h5>
        ),
      );
      i += 1;
      continue;
    }

    if (/^([-*_])\s*\1\s*\1[\s\-*_]*$/.test(trimmed)) {
      blocks.push(<hr key={key++} />);
      i += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quote.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push(
        <blockquote key={key++}>
          <p>{inline(quote.join(' '))}</p>
        </blockquote>,
      );
      continue;
    }

    if (/^[-*+]\s+/.test(trimmed)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        items.push(<li key={key++}>{inline(lines[i].trim().replace(/^[-*+]\s+/, ''))}</li>);
        i += 1;
      }
      blocks.push(<ul key={key++}>{items}</ul>);
      continue;
    }

    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) {
        items.push(<li key={key++}>{inline(lines[i].trim().replace(/^\d+[.)]\s+/, ''))}</li>);
        i += 1;
      }
      blocks.push(<ol key={key++}>{items}</ol>);
      continue;
    }

    if (trimmed.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|/.test(lines[i + 1])) {
      const cells = (row: string) =>
        row
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((cell) => cell.trim());
      const header = cells(lines[i]);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(cells(lines[i]));
        i += 1;
      }
      blocks.push(
        <div className="md-table-wrap" key={key++}>
          <table>
            <thead>
              <tr>
                {header.map((cell, index) => (
                  <th key={index}>{inline(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{inline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    const paragraph: string[] = [line];
    i += 1;
    while (i < lines.length && !isBlockStart(lines[i], lines[i + 1])) {
      paragraph.push(lines[i]);
      i += 1;
    }
    blocks.push(<p key={key++}>{inline(paragraph.join('\n'))}</p>);
  }

  return <>{blocks}</>;
}
