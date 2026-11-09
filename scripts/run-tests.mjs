import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';

// 统一入口：扫描 tests/ 下全部 *.test.mjs，不需要在 package.json 里硬编码文件清单。
// 背景：曾经 test:node 只点名 7 个、test:supabase 4 个，剩下 22 个任何脚本都不跑，
// 导致 4 个文件长期红着无人发现（2026-11）。
//
// 用法：
//   node scripts/run-tests.mjs                      全部
//   node scripts/run-tests.mjs --exclude=pwa.test.mjs
//   node scripts/run-tests.mjs --only=album         只跑文件名含 album 的
const args = process.argv.slice(2);
const excludes = args.filter(arg => arg.startsWith('--exclude=')).map(arg => arg.slice('--exclude='.length)).filter(Boolean);
const only = args.filter(arg => arg.startsWith('--only=')).map(arg => arg.slice('--only='.length)).filter(Boolean);

const all = (await readdir('tests')).filter(name => name.endsWith('.test.mjs')).sort();
let selected = only.length ? all.filter(name => only.some(token => name.includes(token))) : all;
for (const token of excludes) selected = selected.filter(name => !name.includes(token));

if (!selected.length) {
  console.error('没有匹配到任何测试文件（only=' + only.join(',') + ' exclude=' + excludes.join(',') + '）');
  process.exit(1);
}

const skipped = all.length - selected.length;
console.log(`运行 ${selected.length} / ${all.length} 个测试文件${skipped ? `（跳过 ${excludes.join(', ')}）` : ''}`);
const child = spawn(process.execPath, ['--test', ...selected.map(name => 'tests/' + name)], { stdio: 'inherit' });
child.on('exit', code => process.exit(code ?? 1));
