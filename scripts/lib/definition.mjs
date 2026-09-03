/**
 * Mesmo mapeamento Scryfall → CardDefinition que o servidor usa
 * (`packages/server/src/index.ts`), compartilhado pelo auditor e pelo
 * relatório de lacunas do metagame.
 */
import { compileOracleCard, DEMO_CARDS } from '../../packages/engine/dist/index.js';

const DEMO_BY_NAME = new Map(Object.values(DEMO_CARDS).map((c) => [c.name.toLowerCase(), c]));
export const FRONT_FACE_LAYOUTS = new Set(['transform', 'modal_dfc', 'adventure', 'split', 'flip', 'battle', 'prepare']);
export const num = (v) => { if (v === undefined) return undefined; const n = parseInt(v, 10); return Number.isNaN(n) ? undefined : n; };

/** { def, source: 'full' | 'partial' | 'manual' | 'multiface' | 'registry', input?, failedLines? } */
export function toDefinition(official) {
  const registry = DEMO_BY_NAME.get(official.name.toLowerCase());
  const face = official.card_faces?.[0];
  const input = {
    name: official.name.split('//')[0].trim(),
    manaCost: official.mana_cost || face?.mana_cost,
    typeLine: (official.type_line || face?.type_line || '').split('//')[0].trim(),
    oracleText: official.oracle_text ?? face?.oracle_text,
    power: num(official.power ?? face?.power),
    toughness: num(official.toughness ?? face?.toughness),
    loyalty: num(official.loyalty ?? face?.loyalty),
    defense: num(official.defense ?? face?.defense),
    colors: official.colors ?? face?.colors ?? [],
    oracleId: official.oracle_id,
    scryfallId: official.id,
  };
  const multiface = !!official.card_faces;
  if (multiface && !FRONT_FACE_LAYOUTS.has(official.layout ?? '')) return { def: null, source: 'multiface', input, failedLines: ['(layout sem modelo: ' + official.layout + ')'] };
  const back = official.card_faces?.[1];
  if (back && FRONT_FACE_LAYOUTS.has(official.layout ?? '')) {
    input.layout = official.layout;
    input.backFace = {
      name: (back.name ?? '').trim(), manaCost: back.mana_cost, typeLine: (back.type_line ?? '').trim(), oracleText: back.oracle_text,
      power: num(back.power), toughness: num(back.toughness), loyalty: num(back.loyalty), defense: num(back.defense), colors: back.colors ?? [],
    };
  }
  const diag = { failedLines: [] };
  const compiled = compileOracleCard(input, diag);
  if (compiled && multiface && !compiled.backFace) {
    compiled.automation = 'partial';
    compiled.automationNotes = [...(compiled.automationNotes ?? []), 'Outra face não modelada'];
    return { def: compiled, source: 'partial', input, failedLines: diag.failedLines };
  }
  if (compiled && compiled.automation === 'full') return { def: compiled, source: 'full', input, failedLines: [] };
  if (registry) return { def: { ...registry, scryfallId: official.id }, source: 'registry', input, failedLines: diag.failedLines };
  if (compiled) return { def: compiled, source: compiled.automation, input, failedLines: diag.failedLines };
  return { def: null, source: 'manual', input, failedLines: diag.failedLines };
}
