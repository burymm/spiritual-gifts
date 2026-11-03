/**
 * Собирает Angular-фронт и кладёт бандл в back/public — Fastify раздаёт его
 * в проде как статику. Запускается buildCommand на Vercel
 * (npm run build:front) и локально по необходимости.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const back = path.resolve(here, '..');
const front = path.resolve(back, '..', 'front');

// Запускаем npm через interpreter (npm_execpath), а не через npm.cmd:
// Node с 18.20 не даёт spawn'ить .cmd без shell, а на Linux .cmd не существует.
const run = (args) => {
  const npmCli = process.env.npm_execpath;
  if (npmCli !== undefined && npmCli.endsWith('.js')) {
    return execFileSync(process.execPath, [npmCli, ...args], {
      cwd: front,
      stdio: 'inherit',
    });
  }
  return execFileSync('npm', args, {
    cwd: front,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
};

run(['ci']);
run(['run', 'build']);

const dist = path.join(front, 'dist', 'spiritual-gifts', 'browser');
if (!existsSync(path.join(dist, 'index.html'))) {
  console.error(`[build-front] не нашли index.html в ${dist}`);
  process.exit(1);
}

const dest = path.join(back, 'public');
rmSync(dest, { recursive: true, force: true });
cpSync(dist, dest, { recursive: true });
console.log(`[build-front] фронт скопирован в ${dest}`);
