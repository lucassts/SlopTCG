/**
 * Baixa o dump "oracle_cards" do Scryfall (uma entrada por carta, texto
 * oracle atual) para data/oracle-cards.json — insumo do auditor de cartas.
 * O arquivo fica fora do repositório (data/ é gitignored): dado da Wizards
 * nunca entra no código.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'data', 'oracle-cards.json');
const headers = { 'User-Agent': 'SlopTCG-audit/0.1 (open source card game engine)', Accept: 'application/json' };

const bulk = await fetch('https://api.scryfall.com/bulk-data', { headers }).then((r) => r.json());
const entry = bulk.data.find((d) => d.type === 'oracle_cards');
// Formato novo: JSONL gzip; o antigo (download_uri, JSON puro) fica como fallback.
const url = entry.jsonl_download_uri ?? entry.download_uri;
console.log(`oracle_cards (${entry.updated_at}) → ${out}`);
const res = await fetch(url, { headers });
if (!res.ok) throw new Error(`download falhou: ${res.status}`);
let buf = Buffer.from(await res.arrayBuffer());
let cards;
if (url.endsWith('.gz') || url.endsWith('.jsonl')) {
  if (url.endsWith('.gz')) buf = zlib.gunzipSync(buf);
  cards = buf.toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
} else {
  cards = JSON.parse(buf.toString('utf8'));
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(cards));
console.log(`ok — ${cards.length} cartas`);
