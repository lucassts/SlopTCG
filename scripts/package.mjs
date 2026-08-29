/**
 * Empacota o SlopTCG num executável único (Node SEA): servidor + cliente
 * web embutido. O resultado é um SlopTCG.exe (ou binário mac/linux) que o
 * usuário roda com dois cliques — sem Node, sem npm, sem terminal.
 *
 * Uso: npm run package   (exige `npm run build` antes; o script confere)
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_DIST = path.join(ROOT, 'apps/web/dist');
const BUILD = path.join(ROOT, 'build');
const RELEASE = path.join(ROOT, 'release');

if (!fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
  console.error('apps/web/dist não existe — rode `npm run build` primeiro.');
  process.exit(1);
}
fs.mkdirSync(BUILD, { recursive: true });
fs.mkdirSync(RELEASE, { recursive: true });

// 1. Bundle do servidor (TS → um único CJS, dependências inclusas).
console.log('1/4 bundling do servidor…');
execSync(
  `npx esbuild packages/server/src/index.ts --bundle --platform=node --format=cjs --outfile=build/server.cjs --log-level=warning`,
  { cwd: ROOT, stdio: 'inherit' },
);

// 2. Cliente web embutido como base64.
console.log('2/4 embutindo o cliente web…');
const assets = {};
function walk(dir, prefix = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const key = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(full, key);
    else assets[key] = fs.readFileSync(full).toString('base64');
  }
}
walk(WEB_DIST);
const single = path.join(BUILD, 'sloptcg.cjs');
fs.writeFileSync(
  single,
  `globalThis.__SLOPTCG_ASSETS__ = ${JSON.stringify(assets)};\n` +
    fs.readFileSync(path.join(BUILD, 'server.cjs'), 'utf8'),
);

// 3. Blob SEA.
console.log('3/4 gerando o blob SEA…');
fs.writeFileSync(
  path.join(BUILD, 'sea-config.json'),
  JSON.stringify({
    main: 'build/sloptcg.cjs',
    output: 'build/sea-prep.blob',
    disableExperimentalSEAWarning: true,
  }),
);
execSync('node --experimental-sea-config build/sea-config.json', { cwd: ROOT, stdio: 'inherit' });

// 4. Injeta o blob numa cópia do binário do Node.
console.log('4/4 gerando o executável…');
const exeName =
  process.platform === 'win32' ? 'SlopTCG.exe' : process.platform === 'darwin' ? 'SlopTCG-mac' : 'SlopTCG-linux';
const exePath = path.join(RELEASE, exeName);
fs.copyFileSync(process.execPath, exePath);
execSync(
  `npx postject "${exePath}" NODE_SEA_BLOB build/sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2${process.platform === 'darwin' ? ' --macho-segment-name NODE_SEA' : ''}`,
  { cwd: ROOT, stdio: 'inherit' },
);

const sizeMb = (fs.statSync(exePath).size / 1024 / 1024).toFixed(1);
console.log(`\npronto → ${exePath} (${sizeMb} MB)`);
