/** Render GameEvents as human-readable log lines (pt-BR source; traduzido via t()). */
import type { GameEvent, GameView } from '@sloptcg/protocol';
import { t } from './i18n';

const STEP_NAMES: Record<string, string> = {
  untap: 'Desvirar',
  upkeep: 'Manutenção',
  draw: 'Compra',
  main1: '1ª fase principal',
  combatBegin: 'Início do combate',
  declareAttackers: 'Declarar atacantes',
  declareBlockers: 'Declarar bloqueadores',
  combatDamage: 'Dano de combate',
  combatEnd: 'Fim do combate',
  main2: '2ª fase principal',
  end: 'Etapa final',
  cleanup: 'Limpeza',
};

export function stepName(step: string): string {
  const pt = STEP_NAMES[step];
  return pt ? t(pt) : step;
}

const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

export function eventText(ev: GameEvent, view: GameView | null): string | null {
  const name = (p: string) => view?.players[p as 'p1' | 'p2']?.name ?? p;
  switch (ev.type) {
    case 'gameStarted':
      return t('Partida iniciada — {players}.', { players: ev.players.map((p) => p.name).join(' vs ') });
    case 'startingRoll':
      return t('Sorteio: {p1} rolou {r1}, {p2} rolou {r2}{rerolls} — {winner} decide quem começa.', {
        p1: name('p1'),
        r1: ev.rolls.p1,
        p2: name('p2'),
        r2: ev.rolls.p2,
        rerolls: ev.rerolls > 0 ? t(' ({n} empate(s) rerolado(s))', { n: ev.rerolls }) : '',
        winner: name(ev.winner),
      });
    case 'starterChosen':
      return t('{by} decidiu: {first} começa.', { by: name(ev.by), first: name(ev.first) });
    case 'tapUndone':
      return t('{player} desfez a virada de {card}.', { player: name(ev.player), card: ev.cardName });
    case 'turnBegan':
      return t('— Turno {n}: {player} —', { n: ev.turn, player: name(ev.activePlayer) });
    case 'stepChanged':
      return null; // barra de fases já mostra; logar tudo poluiria
    case 'cardDrawn':
      return ev.cardName
        ? t('{player} comprou {card}.', { player: name(ev.player), card: ev.cardName })
        : t('{player} comprou uma carta.', { player: name(ev.player) });
    case 'landPlayed':
      return t('{player} jogou {card}.', { player: name(ev.player), card: ev.cardName });
    case 'spellCast':
      return t('{player} conjurou {card}.', { player: name(ev.player), card: ev.cardName });
    case 'abilityActivated':
      return t('{player} ativou {source}: {text}.', { player: name(ev.player), source: ev.sourceName, text: ev.text });
    case 'abilityTriggered':
      return t('Gatilho de {source}: {text}.', { source: ev.sourceName, text: ev.text });
    case 'stackResolved':
      return ev.description ? `${ev.description}.` : null;
    case 'spellCountered':
      return t('{card} foi anulada.', { card: ev.cardName });
    case 'fizzled':
      return `${ev.description}.`;
    case 'zoneChanged': {
      const card = ev.cardName ?? t('uma carta');
      switch (ev.reason) {
        case 'destroyed':
          return t('{card} foi destruída.', { card });
        case 'legendRule':
          return t('{card} foi para o cemitério (regra das lendárias).', { card });
        case 'sacrificed':
          return t('{card} foi sacrificada.', { card });
        case 'discarded':
          return null; // evento 'discarded' cobre
        case 'milled':
          return t('{card} foi para o cemitério da biblioteca.', { card });
        case 'exiled':
          return t('{card} foi exilada.', { card });
        case 'returned':
          return ev.to === 'hand'
            ? t('{card} voltou para a mão.', { card })
            : ev.to === 'battlefield'
              ? t('{card} voltou para o campo de batalha.', { card })
              : ev.to === 'library'
                ? t('{card} voltou para a biblioteca.', { card })
                : ev.to === 'graveyard'
                  ? t('{card} foi para o cemitério.', { card })
                  : ev.to === 'exile'
                    ? t('{card} foi para o exílio.', { card })
                    : t('{card} foi para {zone}.', { card, zone: ev.to });
        case 'manual':
          return null; // evento 'manualAction' cobre
        default:
          return null;
      }
    }
    case 'tappedChanged':
      return null; // visual no campo já comunica
    case 'manaAdded':
      return null;
    case 'manaPoolEmptied':
      return null;
    case 'lifeChanged':
      return ev.delta > 0
        ? t('{player} ganhou {n} de vida ({total}). [{reason}]', { player: name(ev.player), n: Math.abs(ev.delta), total: ev.total, reason: ev.reason })
        : t('{player} perdeu {n} de vida ({total}). [{reason}]', { player: name(ev.player), n: Math.abs(ev.delta), total: ev.total, reason: ev.reason });
    case 'damageDealt':
      return t('{source} causou {n} de dano a {target}.', { source: ev.sourceName, n: ev.amount, target: ev.targetName });
    case 'pumped':
      return t('{card} recebeu {power}/{toughness} até o fim do turno.', { card: ev.cardName, power: sign(ev.power), toughness: sign(ev.toughness) });
    case 'countersChanged':
      return t('{card}: {delta} marcador(es) de {counter} (total {total}).', { card: ev.cardName, delta: sign(ev.delta), counter: ev.counter, total: ev.total });
    case 'tokenCreated':
      return t('{player} criou uma ficha: {token}.', { player: name(ev.player), token: ev.name });
    case 'attached':
      return t('{source} foi anexada a {host}.', { source: ev.sourceName, host: ev.hostName });
    case 'phased':
      return ev.out ? t('{card} saiu de fase.', { card: ev.cardName }) : t('{card} voltou à fase.', { card: ev.cardName });
    case 'copiesCreated':
      return ev.reason === 'storm'
        ? t('Tempestade: {n} cópia(s) de {card} na pilha.', { n: ev.count, card: ev.cardName })
        : t('{card} foi copiada.', { card: ev.cardName });
    case 'controlChanged':
      return t('{player} assumiu o controle de {card}.', { player: name(ev.to), card: ev.cardName });
    case 'scried':
      return t('{player} olhou as {looked} carta(s) do topo e mandou {bottomed} para o fundo.', { player: name(ev.player), looked: ev.looked, bottomed: ev.bottomed });
    case 'searched': {
      const dest = ev.to === 'hand' ? t('mão') : ev.to === 'battlefield' ? t('campo de batalha') : ev.to === 'exile' ? t('exílio') : t('topo da biblioteca');
      return ev.found.length > 0
        ? t('{player} buscou {cards} (→ {dest}).', { player: name(ev.player), cards: ev.found.join(', '), dest })
        : t('{player} não encontrou nada na busca.', { player: name(ev.player) });
    }
    case 'damagePrevented':
      return t('{n} de dano de {source} a {target} foi prevenido (proteção).', { n: ev.amount, source: ev.sourceName, target: ev.targetName });
    case 'regenerated':
      return t('{card} regenerou.', { card: ev.cardName });
    case 'cycled':
      return t('{player} reciclou {card}.', { player: name(ev.player), card: ev.cardName });
    case 'mulliganTaken':
      return t('{player} fez mulligan ({n}º).', { player: name(ev.player), n: ev.taken });
    case 'handKept':
      return ev.bottomed > 0
        ? t('{player} manteve a mão, devolvendo {n} carta(s) para o fundo.', { player: name(ev.player), n: ev.bottomed })
        : t('{player} manteve a mão.', { player: name(ev.player) });
    case 'attackersDeclared':
      return ev.attackers.length === 0
        ? t('{player} não atacou.', { player: name(ev.player) })
        : t('{player} atacou com {cards}.', { player: name(ev.player), cards: ev.attackers.map((a) => a.cardName).join(', ') });
    case 'blockersDeclared':
      return ev.blocks.length === 0
        ? t('{player} não bloqueou.', { player: name(ev.player) })
        : ev.blocks.map((b) => t('{blocker} bloqueou {attacker}', { blocker: b.blockerName, attacker: b.attackerName })).join('; ') + '.';
    case 'discarded':
      return t('{player} descartou {card}.', { player: name(ev.player), card: ev.cardName });
    case 'cardNamed':
      return t('{player} nomeou "{named}".', { player: name(ev.player), named: ev.name });
    case 'poisonChanged':
      return t('{player} recebeu {n} marcador(es) de veneno ({total}).', { player: name(ev.player), n: ev.delta, total: ev.total });
    case 'crewed':
      return t('{player} tripulou {card}.', { player: name(ev.player), card: ev.cardName });
    case 'modeChosen':
      return t('{player} escolheu "{mode}" para {card}.', { player: name(ev.player), mode: ev.mode, card: ev.cardName });
    case 'turnedFaceUp':
      return t('{player} virou {card} para cima.', { player: name(ev.player), card: ev.cardName });
    case 'cascaded':
      return t('Cascata de {card}: {result}', {
        card: ev.cardName,
        result: ev.hit ? t('{player} conjurou {hit} de graça.', { player: name(ev.player), hit: ev.hit }) : t('nada encontrado.'),
      });
    case 'energyChanged':
      return ev.delta >= 0
        ? t('{player} ganhou {n} de energia ({total}).', { player: name(ev.player), n: Math.abs(ev.delta), total: ev.total })
        : t('{player} pagou {n} de energia ({total}).', { player: name(ev.player), n: Math.abs(ev.delta), total: ev.total });
    case 'explored':
      return ev.toHand
        ? t('{card} explorou: revelou {revealed} (terreno, para a mão).', { card: ev.cardName, revealed: ev.revealed })
        : t('{card} explorou: revelou {revealed} (marcador +1/+1).', { card: ev.cardName, revealed: ev.revealed });
    case 'exploited':
      return t('{card} explorou {sacrificed} (sacrificada).', { card: ev.cardName, sacrificed: ev.sacrificed });
    case 'loreAdded':
      return t('{card}: capítulo {n}.', { card: ev.cardName, n: ev.total });
    case 'miracleRevealed':
      return t('{player} comprou {card} — milagre disponível por {cost}.', { player: name(ev.player), card: ev.cardName, cost: ev.cost });
    case 'dredged':
      return t('{player} dragou {card} (moeu {n}).', { player: name(ev.player), card: ev.cardName, n: ev.milled });
    case 'monarchChanged':
      return t('{player} é o monarca.', { player: name(ev.player) });
    case 'initiativeChanged':
      return t('{player} tomou a iniciativa.', { player: name(ev.player) });
    case 'ventureRequested':
      return null;
    case 'ventured':
      return t('{player} entrou em {dungeon} — {room}{completed}{note}.', {
        player: name(ev.player),
        dungeon: ev.dungeon,
        room: ev.room,
        completed: ev.completed ? t(' (masmorra completada!)') : '',
        note: ev.note ? ` [${ev.note}]` : '',
      });
    case 'hauntExiled':
      return t('{card} agora assombra {haunted}.', { card: ev.cardName, haunted: ev.hauntedName });
    case 'encoded':
      return t('{card} foi codificada em {creature}.', { card: ev.cardName, creature: ev.creatureName });
    case 'hideawayExiled':
      return t('{player} escondeu uma carta com {source}.', { player: name(ev.player), source: ev.sourceName });
    case 'handRevealed':
      return t('{player} revelou a mão: {cards}.', { player: name(ev.player), cards: ev.cards.length > 0 ? ev.cards.join(', ') : t('(vazia)') });
    case 'shuffled':
      return t('{player} embaralhou a biblioteca.', { player: name(ev.player) });
    case 'priorityChanged':
      return null;
    case 'decisionRequired':
      return null;
    case 'gameEnded':
      return t('Fim de partida: {reason}. Vencedor: {winner}.', { reason: ev.reason, winner: ev.winner === 'draw' ? t('empate') : name(ev.winner) });
    case 'manualAction':
      return t('[manual] {player} {text}.', { player: name(ev.player), text: ev.text });
    case 'chat':
      return `${name(ev.player)}: ${ev.text}`;
    case 'error':
      return null;
    default:
      return null;
  }
}
