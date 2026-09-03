/**
 * Auditor da base de cartas.
 *
 * Passa TODAS as cartas do dump oracle do Scryfall (data/oracle-cards.json,
 * gerado por fetch-oracle-bulk.mjs) pelo mesmo caminho que o servidor usa
 * (registro > compilador > manual) e, para cada carta que a engine declara
 * automatizada, JOGA a carta numa partida simulada: conjura com alvos
 * legais, resolve, responde decisões pendentes e ativa cada habilidade.
 *
 * Saída: resumo no console + data/audit-report.json com toda falha.
 *
 *   node scripts/audit-cards.mjs [--limit N] [--only "Nome da Carta"] [--verbose]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileOracleCard, DEMO_CARDS, Game, parseCost } from '../packages/engine/dist/index.js';
import { targetMatchesSpec } from '../packages/engine/dist/effects.js';
import { cardMatchesFilter } from '../packages/engine/dist/cards/types.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argVal = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const LIMIT = argVal('--limit') ? parseInt(argVal('--limit'), 10) : Infinity;
const ONLY = argVal('--only');
const VERBOSE = args.includes('--verbose');

// --------------------------------------------------------------- corpus
const raw = JSON.parse(fs.readFileSync(path.join(root, 'data', 'oracle-cards.json'), 'utf8'));
const SKIP_LAYOUTS = new Set(['token', 'double_faced_token', 'emblem', 'art_series', 'vanguard', 'scheme', 'plane', 'phenomenon', 'planar', 'augment', 'host']);
const SKIP_SET_TYPES = new Set(['funny', 'memorabilia', 'minigame']);
const corpus = raw.filter((c) =>
  !SKIP_LAYOUTS.has(c.layout) &&
  !SKIP_SET_TYPES.has(c.set_type) &&
  !(c.type_line ?? '').startsWith('Token') &&
  (!ONLY || c.name === ONLY),
).slice(0, LIMIT);

// ------------------------------------ mesmo mapeamento do servidor
const DEMO_BY_NAME = new Map(Object.values(DEMO_CARDS).map((c) => [c.name.toLowerCase(), c]));
const KNOWN_TYPES = ['Land', 'Creature', 'Artifact', 'Enchantment', 'Instant', 'Sorcery', 'Planeswalker', 'Battle'];
const num = (v) => { if (v === undefined) return undefined; const n = parseInt(v, 10); return Number.isNaN(n) ? undefined : n; };

function toDefinition(official) {
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
  const FRONT_FACE_LAYOUTS = new Set(['transform', 'modal_dfc', 'adventure', 'split', 'flip', 'battle', 'prepare']);
  const multiface = !!official.card_faces;
  if (multiface && !FRONT_FACE_LAYOUTS.has(official.layout ?? '')) return { def: null, source: 'multiface' };
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
    return { def: compiled, source: 'partial' };
  }
  if (compiled && compiled.automation === 'full') return { def: compiled, source: 'full' };
  if (registry) return { def: { ...registry, scryfallId: official.id }, source: 'registry' };
  if (compiled) return { def: compiled, source: compiled.automation };
  return { def: null, source: 'manual', input, failedLines: diag.failedLines };
}

// ------------------------------------------------ validação estrutural
const KEYWORDS = new Set([
  'flying', 'reach', 'haste', 'vigilance', 'trample', 'lifelink', 'deathtouch', 'defender', 'menace', 'firstStrike',
  'doubleStrike', 'indestructible', 'hexproof', 'shroud', 'flash', 'cantBlock', 'unblockable', 'mustAttack', 'doesntUntap',
  'fear', 'intimidate', 'shadow', 'plainswalk', 'islandwalk', 'swampwalk', 'mountainwalk', 'forestwalk', 'changeling', 'partner',
  'horsemanship', 'blockOnlyFlying',
]);

function targetRefs(effect) {
  const refs = [];
  const walk = (v) => {
    if (typeof v === 'string' && v.startsWith('target:')) refs.push(parseInt(v.slice(7), 10));
    else if (Array.isArray(v)) v.forEach(walk);
    // Habilidades concedidas / de fichas ("token with '…'") têm os próprios alvos.
    else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { if (k !== 'abilities') walk(x); });
  };
  walk(effect);
  return refs;
}

function validateStructure(def) {
  const problems = [];
  const isSpell = def.types.includes('Instant') || def.types.includes('Sorcery');
  if (def.manaCost) {
    try { parseCost(def.manaCost); } catch (e) { problems.push(`custo ilegível ${def.manaCost}`); }
  }
  for (const k of def.keywords ?? []) if (!KEYWORDS.has(k)) problems.push(`keyword desconhecida ${k}`);
  if (def.types.includes('Creature') && !def.isToken) {
    if ((def.power === undefined && def.cdaPower === undefined) || (def.toughness === undefined && def.cdaToughness === undefined)) problems.push('criatura sem poder/resistência numéricos');
  }
  if (isSpell) {
    if (!def.spellEffect?.length && !def.spellModes?.length) problems.push('mágica sem efeito');
    const n = def.spellTargets?.length ?? 0;
    for (const r of targetRefs(def.spellEffect ?? [])) if (r >= n) problems.push(`efeito referencia target:${r} sem spec`);
  }
  for (const [i, ab] of (def.abilities ?? []).entries()) {
    if (ab.kind === 'activated' || ab.kind === 'triggered' || ab.kind === 'loyalty') {
      const n = ab.targets?.length ?? 0;
      for (const r of targetRefs(ab.effect)) if (r >= n) problems.push(`habilidade ${i} referencia target:${r} sem spec`);
      if (!ab.effect?.length && !(ab.kind === 'triggered' && ab.modes?.length) && !(ab.kind === 'activated' && ab.cost?.tapCreature)) problems.push(`habilidade ${i} sem efeito`);
    }
    if (ab.kind === 'activated' && ab.isManaAbility && !ab.effect.some((e) => e.op === 'addMana' || e.op === 'addManaChoice' || e.op === 'addChosenColorMana' || e.op === 'addManaOptions'))
      problems.push(`habilidade de mana ${i} não adiciona mana`);
  }
  if (def.subtypes.includes('Aura') && !def.enchant) problems.push('aura sem enchant');
  return problems;
}

// ------------------------------------------------------- simulação
// Terrenos básicos REAIS do dump, compilados pelo mesmo caminho do servidor —
// um terreno feito à mão esconderia bugs no compilador (aconteceu: o texto
// oracle dos básicos é só lembrete e o Forest compilado ficou sem mana).
const basicFromCorpus = (name) => {
  const official = raw.find((c) => c.name === name && c.layout === 'normal');
  if (!official) throw new Error(`básico não encontrado no dump: ${name}`);
  const def = toDefinition(official).def;
  if (!def?.abilities?.some((a) => a.kind === 'activated' && a.isManaAbility)) throw new Error(`${name} compilou sem habilidade de mana`);
  return def;
};
const LANDS = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].map(basicFromCorpus);
const BEAR = { id: 'grizzly-bears', name: 'Grizzly Bears', manaCost: '{1}{G}', types: ['Creature'], subtypes: ['Bear'], colors: ['G'], power: 2, toughness: 2, automation: 'full' };
const ROCK = {
  id: 'audit-rock', name: 'Audit Rock', manaCost: '{1}', types: ['Artifact'], subtypes: [], colors: [],
  abilities: [{ kind: 'activated', cost: { tap: true }, effect: [{ op: 'addMana', who: 'controller', mana: ['C', 'C', 'C'] }], text: 'Adicionar {C}{C}{C}', isManaAbility: true }],
  automation: 'full',
};
const GLYPH = { id: 'audit-glyph', name: 'Audit Glyph', manaCost: '{1}', types: ['Enchantment'], subtypes: [], colors: [], automation: 'full' };

function fillDeck(extra) {
  const cards = [...extra];
  // 14 de cada: 8 vão para o campo, o resto fica na biblioteca (compras).
  for (let i = 0; i < 14; i++) for (const l of LANDS) cards.push(l);
  return cards;
}

const matchesFilter = (obj, filter) => {
  if (!filter) return true;
  if (!cardMatchesFilter(obj.card, filter)) return false;
  if (filter.token && !obj.isToken) return false;
  if (filter.nontoken && obj.isToken) return false;
  if (filter.tapped && !obj.tapped) return false;
  if (filter.untapped && obj.tapped) return false;
  return true;
};

/** Pick a legal target for a spec, preferring the opponent's stuff. */
function pickTarget(game, me, opp, spec) {
  const s = game.state;
  if (spec.what === 'spell') return null;
  if (spec.what === 'player' || spec.what === 'any') {
    const p = spec.controlledBy === 'opponent' ? opp : opp;
    return { kind: 'player', player: p };
  }
  // Usa a validação de alvos da própria engine: qualquer objeto legal serve (oponente primeiro).
  const order = [...s.players[opp].zones.battlefield, ...s.players[me].zones.battlefield, ...s.players[me].zones.graveyard, ...s.players[opp].zones.graveyard];
  for (const id of order) if (targetMatchesSpec(s, me, spec, { kind: 'object', id })) return { kind: 'object', id };
  return null;
}

/** Answer whatever the engine is waiting on, with minimal legal choices. */
function settle(game, log, maxSteps = 60) {
  for (let i = 0; i < maxSteps; i++) {
    const s = game.state;
    if (s.status !== 'playing') return;
    const pd = s.pendingDecision;
    if (pd) {
      let r;
      if (pd.type === 'discardToHandSize') {
        r = game.apply(pd.player, { type: 'chooseDiscard', objectIds: s.players[pd.player].zones.hand.slice(0, pd.count) });
      } else if (pd.type === 'effectChoice') {
        if (pd.mode === 'nameCard') r = game.apply(pd.player, { type: 'effectChoice', picks: [], text: 'Grizzly Bears' });
        else if (pd.mode === 'confirm') r = game.apply(pd.player, { type: 'effectChoice', picks: [], text: 'yes' });
        else if (pd.mode === 'chooseColor') r = game.apply(pd.player, { type: 'effectChoice', picks: [], text: 'G' });
        else if (pd.mode === 'chooseType') r = game.apply(pd.player, { type: 'effectChoice', picks: [], text: 'Bear' });
        else r = game.apply(pd.player, { type: 'effectChoice', picks: pd.options.slice(0, pd.min) });
      } else if (pd.type === 'chooseMode') {
        r = game.apply(pd.player, { type: 'chooseMode', mode: 0 });
      } else if (pd.type === 'chooseTargets') {
        const opp = pd.player === 'p1' ? 'p2' : 'p1';
        const targets = pd.specs.map((spec) => pickTarget(game, pd.player, opp, spec));
        if (targets.some((t) => !t)) { log.push('gatilho sem alvo legal (ok)'); r = game.apply(pd.player, { type: 'chooseTargets', targets: [] }); }
        else r = game.apply(pd.player, { type: 'chooseTargets', targets });
      }
      if (r && !r.ok) { log.push(`decisão recusada: ${errMsg(r)}`); return; }
      continue;
    }
    if (s.combatAwaiting === 'attackers') {
      // "attacks each combat if able": inclui os obrigados.
      const must = s.players[s.activePlayer].zones.battlefield
        .map((id) => s.objects[id])
        .filter((o) => o.card.keywords?.includes('mustAttack') && !o.tapped && (!o.summoningSick || o.card.keywords?.includes('haste') || o.unearthed || o.castMethod === 'dash' || o.castMethod === 'blitz'))
        .map((o) => o.id);
      const r = game.apply(s.activePlayer, { type: 'declareAttackers', attackers: must });
      if (!r.ok) { log.push(`ataque recusado: ${errMsg(r)}`); return; }
      continue;
    }
    if (s.combatAwaiting === 'blockers') { game.apply(s.activePlayer === 'p1' ? 'p2' : 'p1', { type: 'declareBlockers', blocks: [] }); continue; }
    if (s.stack.length === 0 && s.triggerQueue.length === 0) return;
    if (!s.priority) return;
    const r = game.apply(s.priority, { type: 'passPriority' });
    if (!r.ok) { log.push(`passe recusado: ${errMsg(r)}`); return; }
  }
  log.push('settle: estourou o limite de passos (loop?)');
}

const errMsg = (r) => r.events.find((e) => e.type === 'error')?.message ?? 'sem mensagem';

function checkInvariants(game) {
  const s = game.state;
  const problems = [];
  const seen = new Map();
  for (const pid of ['p1', 'p2']) {
    for (const zone of ['hand', 'library', 'battlefield', 'graveyard', 'exile']) {
      for (const id of s.players[pid].zones[zone]) {
        const key = id;
        if (seen.has(key)) problems.push(`objeto ${id} em duas zonas (${seen.get(key)} e ${pid}.${zone})`);
        seen.set(key, `${pid}.${zone}`);
        const obj = s.objects[id];
        if (!obj) problems.push(`objeto ${id} listado em ${pid}.${zone} mas não existe`);
        else if (obj.zone !== zone) problems.push(`objeto ${id} (${obj.card.name}) zone=${obj.zone} mas está em ${pid}.${zone}`);
      }
    }
    if (!Number.isFinite(s.players[pid].life)) problems.push(`vida de ${pid} não é número`);
    for (const sym of Object.keys(s.players[pid].manaPool)) if (!Number.isFinite(s.players[pid].manaPool[sym]) || s.players[pid].manaPool[sym] < 0) problems.push(`pool de ${pid} inválido`);
  }
  return problems;
}

function simulate(def) {
  const log = [];
  const problems = [];
  const me = 'p1', opp = 'p2';
  let game;
  try {
    game = new Game(
      [
        { id: 'p1', name: 'A', deck: { cards: fillDeck([def, BEAR, ROCK, GLYPH]) } },
        { id: 'p2', name: 'B', deck: { cards: fillDeck([BEAR, BEAR, ROCK, GLYPH]) } },
      ],
      7,
      { firstPlayer: 'p1' },
    );
    game.start();
    game.apply('p1', { type: 'keepHand', bottom: [] });
    game.apply('p2', { type: 'keepHand', bottom: [] });
    settle(game, log);
    // até a main 1 com prioridade
    for (let i = 0; i < 40 && !(game.state.step === 'main1' && game.state.priority === 'p1' && game.state.stack.length === 0); i++) {
      settle(game, log);
      if (game.state.step === 'main1' && game.state.priority === 'p1') break;
      const p = game.state.priority; if (!p) break;
      game.apply(p, { type: 'passPriority' });
    }
    const s = game.state;
    const find = (pid, zone, cardId) => s.players[pid].zones[zone].find((id) => s.objects[id].card.id === cardId);
    const move = (pid, cardId, to) => {
      const id = find(pid, 'library', cardId) ?? find(pid, 'hand', cardId);
      if (id === undefined) return undefined;
      const r = game.apply(pid, { type: 'manualMove', objectId: id, to });
      if (!r.ok) problems.push(`setup: ${errMsg(r)}`);
      return id;
    };
    // mana farta: 5 de cada cor; peças para servir de alvo
    for (const l of LANDS) for (let i = 0; i < 8; i++) move('p1', l.id, 'battlefield');
    for (const l of LANDS) for (let i = 0; i < 2; i++) move('p2', l.id, 'battlefield');
    move('p1', 'grizzly-bears', 'battlefield'); move('p1', 'audit-rock', 'battlefield'); move('p1', 'audit-glyph', 'battlefield');
    move('p2', 'grizzly-bears', 'battlefield'); move('p2', 'grizzly-bears', 'graveyard'); move('p2', 'audit-rock', 'battlefield'); move('p2', 'audit-glyph', 'battlefield');
    const cardId = move('p1', def.id, 'hand');
    if (cardId === undefined) { problems.push('setup: carta não encontrada'); return { problems, log }; }

    // --- jogar / conjurar
    const isLand = def.types.includes('Land');
    if (isLand) {
      const r = game.apply(me, { type: 'playLand', objectId: cardId });
      if (!r.ok) problems.push(`jogar terreno recusado: ${errMsg(r)}`);
      else settle(game, log);
    } else {
      let chosenModes = null;
      if (def.spellModes?.length) {
        chosenModes = def.spellModeChoice ? def.spellModes.map((_, i) => i).slice(0, Math.max(1, def.spellModeChoice.min)) : [0];
        if (def.spellModeChoice?.repeat) while (chosenModes.length < def.spellModeChoice.min) chosenModes.push(0);
      }
      const specs = chosenModes ? chosenModes.flatMap((i) => def.spellModes[i]?.targets ?? []) : (def.enchant ? [{ what: def.enchant.what, controlledBy: def.enchant.controlledBy, typeAnyOf: def.enchant.typeAnyOf }] : def.spellTargets ?? []);
      const targets = specs.map((spec) => pickTarget(game, me, opp, spec));
      if (targets.some((t) => t === null)) {
        log.push(`sem alvo legal para conjurar (${specs.map((x) => x.what).join(',')}) — pulado`);
      } else {
        const action = { type: 'castSpell', objectId: cardId, targets };
        if (chosenModes) { if (def.spellModeChoice) action.modes = chosenModes; else action.mode = 0; }
        if (def.manaCost?.includes('{X}')) action.x = 1;
        let skipCast = false;
        if (def.additionalCost?.sacrifice) {
          const need = def.additionalCost.count ?? 1;
          const sacs = s.players[me].zones.battlefield.map((id) => s.objects[id]).filter((o) => o.id !== cardId && matchesFilter(o, def.additionalCost.sacrifice)).slice(0, need).map((o) => o.id);
          if (sacs.length < need) { log.push('sem permanente legal para o custo adicional de sacrifício — pulado'); skipCast = true; }
          action.sacrifices = sacs;
        }
        if (def.additionalCost?.discard) {
          const hand = s.players[me].zones.hand.filter((id) => id !== cardId).slice(0, def.additionalCost.discard);
          if (hand.length < def.additionalCost.discard) { log.push('mão insuficiente para o custo adicional de descarte — pulado'); skipCast = true; }
          action.discards = hand;
        }
        if (def.additionalCost?.exileFromGraveyard) {
          const gyOk = s.players[me].zones.graveyard.filter((id) => cardMatchesFilter(s.objects[id].card, def.additionalCost.exileFromGraveyard.filter)).length >= def.additionalCost.exileFromGraveyard.count;
          if (!gyOk) { log.push('cemitério sem cartas para o custo adicional de exílio — pulado'); skipCast = true; }
        }
        const r = skipCast ? { ok: true, skipped: true } : game.apply(me, action);
        if (skipCast) { /* cenário não cobre o custo adicional */ }
        else if (!r.ok) { const m = errMsg(r); if (/só pode ser conjurada quando a condição/.test(m)) log.push(`conjuração: ${m}`); else problems.push(`conjuração recusada: ${m}`); }
        else {
          settle(game, log);
          const obj = s.objects[cardId];
          const isPerm = def.types.some((t) => ['Creature', 'Artifact', 'Enchantment', 'Planeswalker'].includes(t));
          if (isPerm && obj.zone !== 'battlefield') {
            // Auras cujo alvo sumiu vão ao cemitério; criaturas 0/0 morrem por SBA — só é problema se não houver explicação.
            if (!(def.enchant) && !(def.toughness !== undefined && def.toughness <= 0))
              problems.push(`permanente não chegou ao campo (zona: ${obj.zone})`);
          }
          if (!isPerm && obj.zone === 'stack') problems.push('mágica ficou presa na pilha');
        }
      }
    }
    // --- habilidades ativadas da permanente
    const obj = s.objects[cardId];
    if (obj.zone === 'battlefield') {
      let loyaltyUsed = false;
      (def.abilities ?? []).forEach((ab, i) => {
        if (ab.kind !== 'activated' && ab.kind !== 'loyalty') return;
        if (ab.kind === 'loyalty') { if (loyaltyUsed) return; loyaltyUsed = true; }
        if (ab.kind === 'activated' && ab.condition) return; // condição pode não valer no cenário
        if (ab.kind === 'activated' && (ab.zone ?? 'battlefield') !== 'battlefield') return; // cemitério: testada abaixo; mão: fora do cenário
        if (game.state.status !== 'playing') return;
        const targets = (ab.targets ?? []).map((spec) => pickTarget(game, me, opp, spec));
        if (targets.some((t) => t === null)) { log.push(`habilidade ${i}: sem alvo legal — pulada`); return; }
        const action = { type: 'activateAbility', objectId: cardId, abilityIndex: i, targets };
        if (ab.kind === 'activated' && ab.effect.some((e) => e.op === 'addManaChoice')) {
          const step = ab.effect.find((e) => e.op === 'addManaChoice');
          action.manaColor = step.colors?.[0] ?? 'G';
        }
        if (ab.kind === 'activated' && ab.effect.some((e) => e.op === 'addManaOptions')) {
          const step = ab.effect.find((e) => e.op === 'addManaOptions');
          action.manaColor = step.options[0];
        }
        // Custos de marcadores: o cenário planta os marcadores para exercitar o efeito.
        if (ab.kind === 'activated' && ab.cost.removeCounters) {
          const { counter, count } = ab.cost.removeCounters;
          s.objects[cardId].counters[counter] = Math.max(s.objects[cardId].counters[counter] ?? 0, count);
        }
        if (ab.kind === 'activated' && ab.cost.tapCreature) {
          const tc = s.players[me].zones.battlefield.map((id) => s.objects[id]).find((o) => o.id !== cardId && o.card.types.includes('Creature') && !o.tapped);
          if (!tc) { log.push(`habilidade ${i}: nenhuma criatura para virar — pulada`); return; }
          action.tapCreature = tc.id;
        }
        if (ab.kind === 'activated' && ab.cost.sacrifice) {
          const sac = s.players[me].zones.battlefield.map((id) => s.objects[id]).find((o) => o.id !== cardId && matchesFilter(o, ab.cost.sacrifice));
          if (!sac) { log.push(`habilidade ${i}: nada para sacrificar — pulada`); return; }
          action.sacrifices = [sac.id];
        }
        if (ab.kind === 'activated' && ab.cost.discard) {
          const hand = s.players[me].zones.hand.slice(0, ab.cost.discard);
          if (hand.length < ab.cost.discard) { log.push(`habilidade ${i}: mão vazia para descartar — pulada`); return; }
          action.discards = hand;
        }
        if (ab.kind === 'loyalty' && ab.cost < 0 && (s.objects[cardId].counters['loyalty'] ?? 0) + ab.cost < 0) { log.push(`habilidade ${i}: lealdade insuficiente — pulada`); return; }
        if (obj.tapped && ab.kind === 'activated' && ab.cost.tap) { log.push(`habilidade ${i}: já virada — pulada`); return; }
        if (obj.zone !== 'battlefield') return;
        const r = game.apply(me, action);
        if (!r.ok) {
          const m = errMsg(r);
          // esperados no cenário: enjoo, mana já gasta por outra habilidade, custo de vida alto
          if (/enjoo|mana insuficiente|pontos de vida para pagar|lealdade insuficiente|energia para pagar|estacionar|não está ativa neste nível|só no nível|precisa exilar|precisa devolver|não satisfaz o custo/.test(m)) log.push(`habilidade ${i}: ${m}`);
          else problems.push(`habilidade ${i} recusada: ${m}`);
        } else settle(game, log);
      });
    }
    // --- habilidades ativadas do cemitério (unearth, scavenge, embalm…): manda a carta para lá e ativa
    const gy = (def.abilities ?? []).map((ab, i) => ({ ab, i })).filter(({ ab }) => ab.kind === 'activated' && ab.zone === 'graveyard');
    if (gy.length > 0 && game.state.status === 'playing' && s.objects[cardId].zone !== 'library') {
      if (s.objects[cardId].zone !== 'graveyard') game.apply(me, { type: 'manualMove', objectId: cardId, to: 'graveyard' });
      for (const { ab, i } of gy) {
        if (s.objects[cardId].zone !== 'graveyard' || game.state.status !== 'playing') break;
        const targets = (ab.targets ?? []).map((spec) => pickTarget(game, me, opp, spec));
        if (targets.some((t) => t === null)) { log.push(`habilidade ${i} (cemitério): sem alvo legal — pulada`); continue; }
        const r = game.apply(me, { type: 'activateAbility', objectId: cardId, abilityIndex: i, targets });
        if (!r.ok) {
          const m = errMsg(r);
          if (/mana insuficiente|feitiço|descarte|sacrificar|precisa exilar|precisa devolver/.test(m)) log.push(`habilidade ${i} (cemitério): ${m}`);
          else problems.push(`habilidade ${i} (cemitério) recusada: ${m}`);
        } else settle(game, log);
      }
    }
    problems.push(...checkInvariants(game));
    // segue até o fim do turno para disparar gatilhos de final/upkeep
    for (let i = 0; i < 60 && game.state.turn === 1 && game.state.status === 'playing'; i++) {
      settle(game, log);
      const p = game.state.priority; if (!p) break;
      const r = game.apply(p, { type: 'passPriority' });
      if (!r.ok) { problems.push(`passe recusado no fim: ${errMsg(r)}`); break; }
    }
    problems.push(...checkInvariants(game));
  } catch (err) {
    problems.push(`EXCEÇÃO: ${err instanceof Error ? err.stack?.split('\n').slice(0, 3).join(' | ') : String(err)}`);
  }
  return { problems, log };
}

// ------------------------------------------------------------------ run
const report = { total: corpus.length, bySource: {}, structural: [], simulation: [], compilerCrashes: [], unparsedLines: new Map(), partialLines: new Map(), registryDiff: [] };
let done = 0;
const TRACE = !!process.env.AUDIT_TRACE;
for (const card of corpus) {
  if (TRACE) fs.appendFileSync('data/audit-trace.log', card.name + String.fromCharCode(10));
  let mapped;
  try { mapped = toDefinition(card); } catch (err) {
    report.compilerCrashes.push({ name: card.name, error: String(err?.message ?? err) });
    continue;
  }
  report.bySource[mapped.source] = (report.bySource[mapped.source] ?? 0) + 1;
  if (mapped.source === 'registry') {
    const oracle = (card.oracle_text ?? '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
    const mine = (mapped.def.text ?? '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
    const costDiff = (card.mana_cost ?? '') !== (mapped.def.manaCost ?? '');
    const ptDiff = num(card.power) !== mapped.def.power || num(card.toughness) !== mapped.def.toughness;
    if (oracle.toLowerCase() !== mine.toLowerCase() || costDiff || ptDiff)
      report.registryDiff.push({ name: card.name, oracle, mine, costDiff: costDiff ? `${card.mana_cost} vs ${mapped.def.manaCost}` : null, ptDiff: ptDiff ? `${card.power}/${card.toughness} vs ${mapped.def.power}/${mapped.def.toughness}` : null });
  }
  if (mapped.def) {
    const sp = validateStructure(mapped.def);
    if (sp.length) report.structural.push({ name: card.name, source: mapped.source, problems: sp });
    if (mapped.source !== 'manual') {
      const { problems, log } = simulate(mapped.def);
      if (problems.length) report.simulation.push({ name: card.name, source: mapped.source, problems, log: VERBOSE ? log : undefined, text: card.oracle_text });
    }
    for (const line of mapped.def.automationNotes ?? []) {
      const key = line.replace(/\b\d+\b/g, 'N').slice(0, 90);
      report.unparsedLines.set(key, (report.unparsedLines.get(key) ?? 0) + 1);
      report.partialLines.set(key, (report.partialLines.get(key) ?? 0) + 1);
    }
  } else if (mapped.source === 'manual' && mapped.input) {
    // Só a linha que de fato derrubou a carta (mágicas são tudo-ou-nada).
    for (const line of mapped.failedLines ?? []) {
      const key = line.trim().replace(/\b\d+\b/g, 'N').slice(0, 100);
      if (key) report.unparsedLines.set(key, (report.unparsedLines.get(key) ?? 0) + 1);
    }
  }
  if (++done % 2000 === 0) console.error(`… ${done}/${corpus.length}`);
}

const topUnparsed = [...report.unparsedLines.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80);
const topPartial = [...report.partialLines.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80);
const out = { ...report, unparsedLines: topUnparsed, partialLines: topPartial };
fs.writeFileSync(path.join(root, 'data', 'audit-report.json'), JSON.stringify(out, null, 2));

console.log(`\n=== Auditoria de ${corpus.length} cartas ===`);
console.log('por fonte:', report.bySource);
console.log(`crashes do compilador: ${report.compilerCrashes.length}`);
console.log(`problemas estruturais: ${report.structural.length}`);
console.log(`falhas de simulação: ${report.simulation.length}`);
console.log(`registro divergente do oracle: ${report.registryDiff.length}`);
const bucket = new Map();
for (const f of report.simulation) for (const p of f.problems) { const k = p.replace(/\d+/g, 'N').slice(0, 80); bucket.set(k, (bucket.get(k) ?? 0) + 1); }
console.log('\n-- falhas de simulação por tipo --');
for (const [k, n] of [...bucket.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${String(n).padStart(6)}  ${k}`);
console.log('\n-- linhas não automatizadas mais frequentes (todas) --');
for (const [k, n] of topUnparsed.slice(0, 30)) console.log(`${String(n).padStart(6)}  ${k}`);
console.log('\n-- linhas que seguram cartas em PARCIAL --');
for (const [k, n] of topPartial.slice(0, 40)) console.log(`${String(n).padStart(6)}  ${k}`);
