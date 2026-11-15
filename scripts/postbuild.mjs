/**
 * GitHub Pages 是纯静态托管：
 * - 404.html 兜底，避免直接刷新深链接时出现 GitHub 的 404
 * - .nojekyll 让 Pages 原样发布带下划线的资源
 */
import { copyFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const dist = join(process.cwd(), 'dist');

await copyFile(join(dist, 'index.html'), join(dist, '404.html'));
await writeFile(join(dist, '.nojekyll'), '');
console.log('postbuild: 404.html / .nojekyll 已生成');
