/** Agrupa as linhas pendentes por mecânica (keyword) vs. frase, com cartas afetadas. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileOracleCard } from '../packages/engine/dist/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raw = JSON.parse(fs.readFileSync(path.join(root, 'data', 'oracle-cards.json'), 'utf8'));
const SKIP = new Set(['token', 'double_faced_token', 'emblem', 'art_series', 'vanguard', 'scheme', 'plane', 'phenomenon', 'planar']);
const num = (v) => { if (v === undefined) return undefined; const n = parseInt(v, 10); return Number.isNaN(n) ? undefined : n; };

const kw = new Map(); // mecânica → Set(cartas)
const sentences = new Map(); // frase normalizada → Set(cartas)
let partial = 0;
for (const c of raw) {
  if (SKIP.has(c.layout) || ['funny', 'memorabilia'].includes(c.set_type) || c.card_faces) continue;
  const def = compileOracleCard({ name: c.name, manaCost: c.mana_cost, typeLine: c.type_line ?? '', oracleText: c.oracle_text, power: num(c.power), toughness: num(c.toughness), loyalty: num(c.loyalty), colors: c.colors ?? [] });
  if (!def || def.automation !== 'partial') continue;
  partial++;
  for (const n of def.automationNotes ?? []) {
    const line = n.replace(/ \(não aplicado[^)]*\)$/, '');
    // keyword: "Morph {2}{U}", "Level up {1}", "Persist", "Cumulative upkeep {1}", "Ward—Pay 2 life."
    const m = line.match(/^([A-Z][a-z]+(?: [a-z]+)*)(?:[ —]+(?:\{[^}]+\})+|\s+\d+|—[^.]+\.?)?$/);
    if (m && !/\b(when|whenever|target|you|each|at the beginning|if|as |gets|deals|enters|can't|is|has)\b/i.test(line.replace(/^[A-Z][a-z]+/, ''))) {
      const k = m[1];
      if (!kw.has(k)) kw.set(k, new Set());
      kw.get(k).add(c.name);
    } else {
      const k = line.replace(/\b\d+\b/g, 'N').replace(/\{[^}]+\}/g, '{}').slice(0, 90);
      if (!sentences.has(k)) sentences.set(k, new Set());
      sentences.get(k).add(c.name);
    }
  }
}
const kwRanked = [...kw.entries()].map(([k, s]) => [k, s.size]).sort((a, b) => b[1] - a[1]);
const kwCards = new Set(); for (const [, s] of kw) for (const c of s) kwCards.add(c);
console.log(`parciais: ${partial} · cartas com alguma keyword pendente: ${kwCards.size} · keywords distintas: ${kwRanked.length}`);
console.log('\n-- keywords/mecânicas por cartas afetadas --');
for (const [k, n] of kwRanked.slice(0, 120)) console.log(String(n).padStart(5), k);
fs.writeFileSync(path.join(root, 'data', 'tail-keywords.txt'), kwRanked.map(([k, n]) => `${String(n).padStart(5)} ${k}`).join('\n'));
const sRanked = [...sentences.entries()].map(([k, s]) => [k, s.size]).sort((a, b) => b[1] - a[1]);
fs.writeFileSync(path.join(root, 'data', 'tail-sentences.txt'), sRanked.map(([k, n]) => `${String(n).padStart(5)} ${k}`).join('\n'));
console.log(`\nfrases distintas: ${sRanked.length} (salvas em data/tail-sentences.txt)`);
