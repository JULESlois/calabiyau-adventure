// 发布产物安全检查:开发调试入口不得进入 dist。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const FORBIDDEN = ['__CBQ__', 'grantAll', 'goRoom'];

function filesUnder(path: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(path)) {
    const fullPath = join(path, name);
    if (statSync(fullPath).isDirectory()) files.push(...filesUnder(fullPath));
    else files.push(fullPath);
  }
  return files;
}

const violations: string[] = [];
for (const file of filesUnder(DIST)) {
  if (!/\.(?:html|js|css|map)$/.test(file)) continue;
  const content = readFileSync(file, 'utf8');
  for (const token of FORBIDDEN) {
    if (content.includes(token)) violations.push(`${file}: ${token}`);
  }
}

if (violations.length > 0) {
  console.error(`发布产物包含调试入口:\n${violations.join('\n')}`);
  process.exit(1);
}

console.log('发布产物调试入口检查通过');
