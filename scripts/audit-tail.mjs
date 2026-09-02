/** Distribuição da cauda: quantas linhas distintas seguram as cartas parciais e o retorno por linha. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileOracleCard } from '../packages/engine/dist/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raw = JSON.parse(fs.readFileSync(path.join(root, 'data', 'oracle-cards.json'), 'utf8'));
const SKIP = new Set(['token', 'double_faced_token', 'emblem', 'art_series', 'vanguard', 'scheme', 'plane', 'phenomenon', 'planar']);
const num = (v) => { if (v === undefined) return undefined; const n = parseInt(v, 10); return Number.isNaN(n) ? undefined : n; };

const lineCards = new Map(); // linha → set de cartas
let partial = 0, oneLine = 0, twoLines = 0, morePlus = 0;
for (const c of raw) {
  if (SKIP.has(c.layout) || ['funny', 'memorabilia'].includes(c.set_type) || c.card_faces) continue;
  const def = compileOracleCard({ name: c.name, manaCost: c.mana_cost, typeLine: c.type_line ?? '', oracleText: c.oracle_text, power: num(c.power), toughness: num(c.toughness), loyalty: num(c.loyalty), colors: c.colors ?? [] });
  if (!def || def.automation !== 'partial') continue;
  partial++;
  const notes = def.automationNotes ?? [];
  if (notes.length === 1) oneLine++; else if (notes.length === 2) twoLines++; else morePlus++;
  for (const n of notes) {
    const k = n.replace(/\b\d+\b/g, 'N').replace(/\{[^}]+\}/g, '{}').slice(0, 80);
    if (!lineCards.has(k)) lineCards.set(k, new Set());
    lineCards.get(k).add(c.name);
  }
}
const ranked = [...lineCards.entries()].map(([k, s]) => [k, s.size]).sort((a, b) => b[1] - a[1]);
console.log(`parciais (sem dupla-face): ${partial} · com 1 linha pendente: ${oneLine} · 2: ${twoLines} · 3+: ${morePlus}`);
console.log(`linhas distintas pendentes: ${ranked.length}`);
const cum = (n) => ranked.slice(0, n).reduce((a, [, c]) => a + c, 0);
for (const n of [10, 50, 100, 500, 1000, 5000]) console.log(`top ${n} linhas cobrem ${cum(n)} ocorrências`);
const singles = ranked.filter(([, c]) => c === 1).length;
console.log(`linhas que aparecem em UMA única carta: ${singles} (${((singles / ranked.length) * 100).toFixed(0)}%)`);
