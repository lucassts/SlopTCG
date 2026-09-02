/** Ranking das linhas que derrubam MÁGICAS (instantâneas/feitiços) para manual. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileOracleCard } from '../packages/engine/dist/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raw = JSON.parse(fs.readFileSync(path.join(root, 'data', 'oracle-cards.json'), 'utf8'));
const SKIP = new Set(['token', 'double_faced_token', 'emblem', 'art_series', 'vanguard', 'scheme', 'plane', 'phenomenon', 'planar']);
const lines = new Map();
let spells = 0, ok = 0, manual = 0;
for (const c of raw) {
  if (SKIP.has(c.layout) || ['funny', 'memorabilia'].includes(c.set_type) || c.card_faces) continue;
  const t = c.type_line ?? '';
  if (!/\b(Instant|Sorcery)\b/.test(t)) continue;
  spells++;
  const diag = { failedLines: [] };
  const def = compileOracleCard({ name: c.name, manaCost: c.mana_cost, typeLine: t, oracleText: c.oracle_text, colors: c.colors ?? [], loyalty: c.loyalty ? parseInt(c.loyalty, 10) : undefined }, diag);
  if (def) { ok++; continue; }
  manual++;
  const first = diag.failedLines[0] ?? '(sem efeito)';
  const key = first.replace(/\b\d+\b/g, 'N').slice(0, 110);
  lines.set(key, (lines.get(key) ?? 0) + 1);
}
console.log(`mágicas: ${spells} · automatizadas: ${ok} (${((ok / spells) * 100).toFixed(1)}%) · manuais: ${manual}`);
for (const [k, n] of [...lines.entries()].sort((a, b) => b[1] - a[1]).slice(0, 70)) console.log(String(n).padStart(6), k);
