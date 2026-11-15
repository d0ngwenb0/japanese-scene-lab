import type { Line, Scenario } from '../types';

const MARKUP = /\{([^{}|]+)\|[^{}|]+\}/g;

/** 复制时去掉 {漢字|かんじ} 标注，只留汉字。 */
export function stripFurigana(text: string): string {
  return text.replace(MARKUP, '$1');
}

export function formatLine(scene: Scenario, line: Line): string {
  const speaker = scene.speakers.find((item) => item.id === line.speaker)?.label ?? line.speaker;
  return `${speaker}：${stripFurigana(line.ja)}\n${line.zh}`;
}

export function formatScene(scene: Scenario): string {
  const body = scene.lines.map((line) => formatLine(scene, line)).join('\n\n');
  return `${stripFurigana(scene.title)} · ${scene.titleZh}\n\n${body}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 权限被拒或非安全上下文，继续走降级方案。
  }

  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-9999px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
