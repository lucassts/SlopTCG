/**
 * Baixa o bulk "oracle-cards" do Scryfall para data/oracle-cards.json.
 * Os dados NUNCA são versionados (ver .gitignore) — cada dev/servidor baixa
 * o seu. Uso: node scripts/fetch-cards.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'data');
const outFile = path.join(outDir, 'oracle-cards.json');

const meta = await fetch('https://api.scryfall.com/bulk-data/oracle-cards', {
  headers: { 'User-Agent': 'SlopMTG/0.1 (open source card game client)' },
}).then((r) => r.json());

console.log(`Baixando ${meta.download_uri} (~${Math.round(meta.size / 1024 / 1024)} MB)…`);
const res = await fetch(meta.download_uri);
if (!res.ok) throw new Error(`download falhou: ${res.status}`);

fs.mkdirSync(outDir, { recursive: true });
const buf = Buffer.from(await res.arrayBuffer());
fs.writeFileSync(outFile, buf);
console.log(`ok → ${outFile} (${buf.length} bytes, atualizado em ${meta.updated_at})`);
