/**
 * Lacunas de automação no metagame de um formato (MTGGoldfish).
 *
 *   node scripts/meta-gap.mjs --format legacy [--min-share 0.3] [--max-archetypes 80] [--refresh]
 *
 * 1. Baixa a página de metagame (arquétipos, META%, nº de decks) e, de cada
 *    arquétipo, a lista da decklist de amostra (campo oculto `deck_input[deck]`).
 * 2. Classifica cada carta com o mesmo compilador do auditor (full / partial /
 *    manual / multiface).
 * 3. Escreve `data/meta/<formato>-gap.md` e `.json`: cartas não-full ranqueadas
 *    por peso no meta (META% × cópias; sideboard vale metade), com as linhas
 *    de texto que seguram cada uma — e um ranking das linhas pendentes por peso,
 *    que é a lista de trabalho.
 *
 * HTML fica em cache em `data/meta/cache/` (use --refresh para baixar de novo).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toDefinition } from './lib/definition.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argVal = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const FORMAT = argVal('--format', 'legacy');
const MIN_SHARE = parseFloat(argVal('--min-share', '0.3'));
const MAX_ARCH = parseInt(argVal('--max-archetypes', '80'), 10);
const REFRESH = args.includes('--refresh');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36';
const cacheDir = path.join(root, 'data', 'meta', 'cache');
fs.mkdirSync(cacheDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchHtml(url, key) {
  const file = path.join(cacheDir, key.replace(/[^a-z0-9_-]+/gi, '_') + '.html');
  if (!REFRESH && fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  await sleep(400);
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  if (!res.ok) throw new Error(`${res.status} em ${url}`);
  const html = await res.text();
  fs.writeFileSync(file, html);
  return html;
}
const decode = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

// ------------------------------------------------------------ metagame page
const metaHtml = await fetchHtml(`https://www.mtggoldfish.com/metagame/${FORMAT}/full#paper`, `${FORMAT}-metagame`);
const archetypes = [];
for (const tile of metaHtml.split("<div class='archetype-tile'").slice(1)) {
  const m = tile.match(/<a href="\/archetype\/([^"#]+)#paper">([^<]+)<\/a>/);
  const share = tile.match(/META%[\s\S]*?statistic-value'>\s*([\d.]+)%\s*<span[^>]*>\s*\((\d+)\)/);
  if (!m || !share) continue;
  archetypes.push({ slug: m[1], name: decode(m[2].trim()), share: parseFloat(share[1]), decks: parseInt(share[2], 10) });
}
const selected = archetypes.filter((a) => a.share >= MIN_SHARE).slice(0, MAX_ARCH);
console.log(`${FORMAT}: ${archetypes.length} arquétipos na página, ${selected.length} com META% ≥ ${MIN_SHARE} (cobrem ${selected.reduce((s, a) => s + a.share, 0).toFixed(1)}% do meta)`);

// ---------------------------------------------------------- archetype lists
const lists = [];
for (const a of selected) {
  let html;
  try { html = await fetchHtml(`https://www.mtggoldfish.com/archetype/${a.slug}#paper`, `${FORMAT}-arch-${a.slug}`); }
  catch (e) { console.log(`  ! ${a.name}: ${e.message}`); continue; }
  const m = html.match(/id="deck_input_deck" value="([^"]*)"/);
  if (!m) { console.log(`  ! ${a.name}: sem decklist`); continue; }
  const lines = decode(m[1]).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const main = []; const side = [];
  let inSide = false;
  for (const line of lines) {
    if (/^sideboard$/i.test(line)) { inSide = true; continue; }
    const mm = line.match(/^(\d+)\s+(.+)$/);
    if (!mm) continue;
    (inSide ? side : main).push({ count: parseInt(mm[1], 10), name: mm[2].trim() });
  }
  lists.push({ ...a, main, side });
  process.stdout.write(`  ${a.name} (${a.share}%): ${main.reduce((s, c) => s + c.count, 0)} main / ${side.reduce((s, c) => s + c.count, 0)} side\n`);
}

// ------------------------------------------------------------ classificação
const raw = JSON.parse(fs.readFileSync(path.join(root, 'data', 'oracle-cards.json'), 'utf8'));
const byName = new Map();
for (const c of raw) {
  if (['token', 'double_faced_token', 'emblem', 'art_series', 'vanguard', 'scheme', 'plane', 'phenomenon'].includes(c.layout)) continue;
  const keys = [c.name.toLowerCase(), c.name.split('//')[0].trim().toLowerCase()];
  for (const k of keys) if (!byName.has(k) || (byName.get(k).set_type === 'funny' && c.set_type !== 'funny')) byName.set(k, c);
}
const cards = new Map(); // name → { name, status, weight, archetypes, failedLines, notes }
const status = new Map();
const classify = (name) => {
  const key = name.toLowerCase().split('//')[0].trim();
  if (status.has(key)) return status.get(key);
  const official = byName.get(key);
  let r;
  if (!official) r = { source: 'desconhecida', failedLines: ['(nome não encontrado no Scryfall bulk)'], notes: [] };
  else {
    const d = toDefinition(official);
    r = { source: d.source, failedLines: d.failedLines ?? [], notes: d.def?.automationNotes ?? [], official };
  }
  status.set(key, r);
  return r;
};
let weightTotal = 0, weightFull = 0;
for (const l of lists) {
  for (const [group, mult] of [[l.main, 1], [l.side, 0.5]]) {
    for (const c of group) {
      const st = classify(c.name);
      const w = l.share * c.count * mult;
      weightTotal += w;
      if (st.source === 'full' || st.source === 'registry') weightFull += w;
      const key = c.name.split('//')[0].trim();
      const e = cards.get(key) ?? { name: key, status: st.source, weight: 0, archetypes: new Set(), failedLines: st.failedLines, notes: st.notes };
      e.weight += w;
      e.archetypes.add(l.name);
      cards.set(key, e);
    }
  }
}
const gap = [...cards.values()].filter((c) => c.status !== 'full' && c.status !== 'registry').sort((a, b) => b.weight - a.weight);
const okCount = [...cards.values()].length - gap.length;

// Linhas pendentes ranqueadas por peso (a lista de trabalho).
const lineWeight = new Map();
for (const c of gap) {
  const lines = c.failedLines.length ? c.failedLines : c.notes.length ? c.notes : ['(sem diagnóstico)'];
  for (const raw of lines) {
    const line = raw.replace(new RegExp(c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '~').replace(/\d+/g, 'N');
    const e = lineWeight.get(line) ?? { line, weight: 0, cards: new Set() };
    e.weight += c.weight; e.cards.add(c.name);
    lineWeight.set(line, e);
  }
}
const linesRanked = [...lineWeight.values()].sort((a, b) => b.weight - a.weight);

// ------------------------------------------------------------------- saída
const pct = (x) => (100 * x).toFixed(1) + '%';
const md = [];
md.push(`# Lacunas de automação — ${FORMAT} (MTGGoldfish, ${new Date().toISOString().slice(0, 10)})`, '');
md.push(`- Arquétipos considerados: ${lists.length} (META% ≥ ${MIN_SHARE}; ${selected.reduce((s, a) => s + a.share, 0).toFixed(1)}% do meta).`);
md.push(`- Cartas distintas: ${cards.size} · full: ${okCount} · com lacuna: ${gap.length}.`);
md.push(`- **Cobertura ponderada pelo meta** (META% × cópias, sideboard vale metade): **${pct(weightFull / weightTotal)}** das cartas jogadas já são full.`, '');
md.push('## Cartas com lacuna, por peso no meta', '', '| # | Carta | Status | Peso | Arquétipos | O que segura |', '|---|---|---|---|---|---|');
gap.forEach((c, i) => {
  const why = (c.failedLines.length ? c.failedLines : c.notes).map((l) => l.replace(/\|/g, '\\|')).slice(0, 3).join(' · ');
  md.push(`| ${i + 1} | ${c.name} | ${c.status} | ${c.weight.toFixed(1)} | ${c.archetypes.size} | ${why} |`);
});
md.push('', '## Linhas de texto pendentes, por peso (lista de trabalho)', '', '| Peso | Cartas | Linha |', '|---|---|---|');
for (const l of linesRanked.slice(0, 80)) md.push(`| ${l.weight.toFixed(1)} | ${l.cards.size} | ${l.line.replace(/\|/g, '\\|')} |`);
md.push('', '## Arquétipos', '', '| META% | Decks | Arquétipo | Cartas com lacuna (main) |', '|---|---|---|---|');
for (const l of lists) {
  const bad = l.main.filter((c) => { const s = classify(c.name).source; return s !== 'full' && s !== 'registry'; }).map((c) => c.name);
  md.push(`| ${l.share}% | ${l.decks} | ${l.name} | ${bad.join(', ')} |`);
}
fs.mkdirSync(path.join(root, 'data', 'meta'), { recursive: true });
fs.writeFileSync(path.join(root, 'data', 'meta', `${FORMAT}-gap.md`), md.join('\n') + '\n');
fs.writeFileSync(path.join(root, 'data', 'meta', `${FORMAT}-gap.json`), JSON.stringify({ format: FORMAT, archetypes: lists.map((l) => ({ name: l.name, share: l.share, decks: l.decks })), coverageWeighted: weightFull / weightTotal, gap: gap.map((c) => ({ ...c, archetypes: [...c.archetypes] })), lines: linesRanked.slice(0, 200).map((l) => ({ ...l, cards: [...l.cards] })) }, null, 2));
console.log(`\ncobertura ponderada: ${pct(weightFull / weightTotal)} · cartas com lacuna: ${gap.length}/${cards.size}`);
console.log('\n-- top 40 cartas com lacuna --');
for (const c of gap.slice(0, 40)) console.log(`${c.weight.toFixed(1).padStart(7)}  ${c.status.padEnd(9)} ${c.name}  ← ${(c.failedLines[0] ?? c.notes[0] ?? '').slice(0, 90)}`);
console.log('\n-- top 30 linhas pendentes --');
for (const l of linesRanked.slice(0, 30)) console.log(`${l.weight.toFixed(1).padStart(7)}  ${String(l.cards.size).padStart(3)}  ${l.line.slice(0, 110)}`);
console.log(`\nrelatório: data/meta/${FORMAT}-gap.md`);
