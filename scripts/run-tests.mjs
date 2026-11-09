import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';

// 统一入口：默认跑 tests/ 下全部 *.test.mjs，可传文件名片段筛选。
// 存在的原因：tests/ 里有 30+ 个文件，而 test:node / test:supabase 只点名了 11 个，
// 其余长期没人跑（2026-11 就有 4 个文件红着无人发现）。
const only = process.argv.slice(2);
const all = (await readdir('tests')).filter(name => name.endsWith('.test.mjs')).sort();
const selected = only.length ? all.filter(name => only.some(token => name.includes(token))) : all;

if (!selected.length) {
  console.error('没有匹配到任何测试文件：' + (only.join(', ') || '(全部)'));
  process.exit(1);
}

console.log(`运行 ${selected.length} 个测试文件`);
const child = spawn(process.execPath, ['--test', ...selected.map(name => 'tests/' + name)], { stdio: 'inherit' });
child.on('exit', code => process.exit(code ?? 1));
