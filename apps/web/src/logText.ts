/** Render GameEvents as human-readable PT-BR log lines. */
import type { GameEvent, GameView } from '@sloptcg/protocol';

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
  return STEP_NAMES[step] ?? step;
}

export function eventText(ev: GameEvent, view: GameView | null): string | null {
  const name = (p: string) => view?.players[p as 'p1' | 'p2']?.name ?? p;
  switch (ev.type) {
    case 'gameStarted':
      return `Partida iniciada — ${ev.players.map((p) => p.name).join(' vs ')}.`;
    case 'startingRoll':
      return `Sorteio: ${name('p1')} rolou ${ev.rolls.p1}, ${name('p2')} rolou ${ev.rolls.p2}${
        ev.rerolls > 0 ? ` (${ev.rerolls} empate(s) rerolado(s))` : ''
      } — ${name(ev.winner)} decide quem começa.`;
    case 'starterChosen':
      return `${name(ev.by)} decidiu: ${name(ev.first)} começa.`;
    case 'tapUndone':
      return `${name(ev.player)} desfez a virada de ${ev.cardName}.`;
    case 'turnBegan':
      return `— Turno ${ev.turn}: ${name(ev.activePlayer)} —`;
    case 'stepChanged':
      return null; // barra de fases já mostra; logar tudo poluiria
    case 'cardDrawn':
      return ev.cardName
        ? `${name(ev.player)} comprou ${ev.cardName}.`
        : `${name(ev.player)} comprou uma carta.`;
    case 'landPlayed':
      return `${name(ev.player)} jogou ${ev.cardName}.`;
    case 'spellCast':
      return `${name(ev.player)} conjurou ${ev.cardName}.`;
    case 'abilityActivated':
      return `${name(ev.player)} ativou ${ev.sourceName}: ${ev.text}.`;
    case 'abilityTriggered':
      return `Gatilho de ${ev.sourceName}: ${ev.text}.`;
    case 'stackResolved':
      return ev.description ? `${ev.description}.` : null;
    case 'spellCountered':
      return `${ev.cardName} foi anulada.`;
    case 'fizzled':
      return `${ev.description}.`;
    case 'zoneChanged': {
      const card = ev.cardName ?? 'uma carta';
      switch (ev.reason) {
        case 'destroyed':
          return `${card} foi destruída.`;
        case 'sacrificed':
          return `${card} foi sacrificada.`;
        case 'discarded':
          return null; // evento 'discarded' cobre
        case 'milled':
          return `${card} foi para o cemitério da biblioteca.`;
        case 'exiled':
          return `${card} foi exilada.`;
        case 'returned':
          return `${card} voltou para a mão.`;
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
      return `${name(ev.player)} ${ev.delta > 0 ? 'ganhou' : 'perdeu'} ${Math.abs(ev.delta)} de vida (${ev.total}). [${ev.reason}]`;
    case 'damageDealt':
      return `${ev.sourceName} causou ${ev.amount} de dano a ${ev.targetName}.`;
    case 'pumped':
      return `${ev.cardName} recebeu ${ev.power >= 0 ? '+' : ''}${ev.power}/${ev.toughness >= 0 ? '+' : ''}${ev.toughness} até o fim do turno.`;
    case 'countersChanged':
      return `${ev.cardName}: ${ev.delta > 0 ? '+' : ''}${ev.delta} marcador(es) de ${ev.counter} (total ${ev.total}).`;
    case 'tokenCreated':
      return `${name(ev.player)} criou uma ficha: ${ev.name}.`;
    case 'attached':
      return `${ev.sourceName} foi anexada a ${ev.hostName}.`;
    case 'copiesCreated':
      return ev.reason === 'storm'
        ? `Tempestade: ${ev.count} cópia(s) de ${ev.cardName} na pilha.`
        : `${ev.cardName} foi copiada.`;
    case 'controlChanged':
      return `${name(ev.to)} assumiu o controle de ${ev.cardName}.`;
    case 'scried':
      return `${name(ev.player)} olhou as ${ev.looked} carta(s) do topo e mandou ${ev.bottomed} para o fundo.`;
    case 'searched': {
      const dest = ev.to === 'hand' ? 'mão' : ev.to === 'battlefield' ? 'campo de batalha' : 'topo da biblioteca';
      return ev.found.length > 0
        ? `${name(ev.player)} buscou ${ev.found.join(', ')} (→ ${dest}).`
        : `${name(ev.player)} não encontrou nada na busca.`;
    }
    case 'damagePrevented':
      return `${ev.amount} de dano de ${ev.sourceName} a ${ev.targetName} foi prevenido (proteção).`;
    case 'regenerated':
      return `${ev.cardName} regenerou.`;
    case 'cycled':
      return `${name(ev.player)} reciclou ${ev.cardName}.`;
    case 'mulliganTaken':
      return `${name(ev.player)} fez mulligan (${ev.taken}º).`;
    case 'handKept':
      return ev.bottomed > 0
        ? `${name(ev.player)} manteve a mão, devolvendo ${ev.bottomed} carta(s) para o fundo.`
        : `${name(ev.player)} manteve a mão.`;
    case 'attackersDeclared':
      return ev.attackers.length === 0
        ? `${name(ev.player)} não atacou.`
        : `${name(ev.player)} atacou com ${ev.attackers.map((a) => a.cardName).join(', ')}.`;
    case 'blockersDeclared':
      return ev.blocks.length === 0
        ? `${name(ev.player)} não bloqueou.`
        : ev.blocks.map((b) => `${b.blockerName} bloqueou ${b.attackerName}`).join('; ') + '.';
    case 'discarded':
      return `${name(ev.player)} descartou ${ev.cardName}.`;
    case 'cardNamed':
      return `${name(ev.player)} nomeou "${ev.name}".`;
    case 'poisonChanged':
      return `${name(ev.player)} recebeu ${ev.delta} marcador(es) de veneno (${ev.total}).`;
    case 'crewed':
      return `${name(ev.player)} tripulou ${ev.cardName}.`;
    case 'modeChosen':
      return `${name(ev.player)} escolheu "${ev.mode}" para ${ev.cardName}.`;
    case 'handRevealed':
      return `${name(ev.player)} revelou a mão: ${ev.cards.length > 0 ? ev.cards.join(', ') : '(vazia)'}.`;
    case 'shuffled':
      return `${name(ev.player)} embaralhou a biblioteca.`;
    case 'priorityChanged':
      return null;
    case 'decisionRequired':
      return null;
    case 'gameEnded':
      return `Fim de partida: ${ev.reason}. Vencedor: ${ev.winner === 'draw' ? 'empate' : name(ev.winner)}.`;
    case 'manualAction':
      return `[manual] ${name(ev.player)} ${ev.text}.`;
    case 'chat':
      return `${name(ev.player)}: ${ev.text}`;
    case 'error':
      return null;
    default:
      return null;
  }
}
