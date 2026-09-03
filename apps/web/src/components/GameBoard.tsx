import { useEffect, useMemo, useRef, useState } from 'react';
import type { CardView, GameView, PlayerAction, PlayerId } from '@sloptcg/protocol';
import type { Step, TargetChoice } from '@sloptcg/engine';

type CastMethodKind = NonNullable<CardView['card']['castMethods']>[number]['kind'];
import { CardFace, CardTile, HoverPreview } from './CardTile';
import { stepName } from '../logText';

const STEPS = [
  'untap', 'upkeep', 'draw', 'main1', 'combatBegin', 'declareAttackers',
  'declareBlockers', 'combatDamage', 'combatEnd', 'main2', 'end', 'cleanup',
] as const;

const STEP_SHORT: Record<string, string> = {
  untap: 'Desv.', upkeep: 'Manut.', draw: 'Compra', main1: 'Principal 1',
  combatBegin: 'Combate', declareAttackers: 'Atacantes', declareBlockers: 'Bloqueadores',
  combatDamage: 'Dano', combatEnd: 'Fim comb.', main2: 'Principal 2', end: 'Final', cleanup: 'Limpeza',
};

/** Steps a player can choose to stop on (untap/cleanup grant no priority). */
const STOPPABLE: Step[] = [
  'upkeep', 'draw', 'main1', 'combatBegin', 'declareAttackers',
  'declareBlockers', 'combatDamage', 'combatEnd', 'main2', 'end',
];

interface StopsConfig {
  myTurn: Step[];
  oppTurn: Step[];
}

/**
 * MTGO-style default: stop at EVERY step that grants priority, in both
 * turns. Auto-passing is opt-in — desmarque etapas no painel ⏱.
 */
const DEFAULT_STOPS: StopsConfig = { myTurn: [...STOPPABLE], oppTurn: [...STOPPABLE] };

function loadStops(): StopsConfig {
  try {
    const raw = localStorage.getItem('sloptcg-stops');
    if (!raw) return DEFAULT_STOPS;
    const parsed = JSON.parse(raw) as StopsConfig;
    return { myTurn: parsed.myTurn ?? DEFAULT_STOPS.myTurn, oppTurn: parsed.oppTurn ?? DEFAULT_STOPS.oppTurn };
  } catch {
    return DEFAULT_STOPS;
  }
}

/** One-shot auto-yield (MTGO F-keys): pass priority until the target moment. */
interface YieldState {
  kind: 'nextStep' | 'combat' | 'mainPhase' | 'endStep' | 'myTurn';
  step: Step;
  turn: number;
}

const YIELD_LABEL: Record<YieldState['kind'], string> = {
  nextStep: 'próxima etapa',
  combat: 'próximo combate',
  mainPhase: 'próxima fase principal',
  endStep: 'próxima etapa final',
  myTurn: 'meu próximo turno',
};

/** Transient card pop-up when a card lands in a relevant zone. */
interface ZoneToast {
  key: string;
  card: CardView;
  player: PlayerId;
  zone: 'graveyard' | 'exile';
  label: string;
}

interface Targeting {
  kind: 'spell' | 'ability' | 'trigger' | 'ninjutsu';
  objectId: number;
  abilityIndex?: number;
  specs: { what: string }[];
  chosen: TargetChoice[];
  label: string;
  /** Extras carried into the cast action (X spells, modal spells, kicker). */
  x?: number;
  mode?: number;
  kicked?: boolean;
  kickerTimes?: number;
  /** Leva 2: alternative casting method (evoke/dash/escape/foretold/…), face-down (morph), buyback. */
  method?: CastMethodKind;
  escapeExile?: number[];
  faceDown?: boolean;
  buyback?: boolean;
  /** First N picks are sacrifices for an additional cost (Fling). */
  sacCount?: number;
  /** Cast via alternative cost (Force of Will). */
  useAltCost?: boolean;
  /** Before sacrifices/targets: pick N cards from hand to exile (alt cost). */
  handPickCount?: number;
  handPickColor?: string;
  /** Retrace: the hand pick must be a land card. */
  handPickLand?: boolean;
  /** Hand picks are an additional-cost discard (not an alternative-cost exile). */
  handPickDiscard?: boolean;
  /** Leva 5b: the last sacrifice pick is the casualty creature; face/fuse of the cast. */
  casualtyPick?: boolean;
  face?: 'back';
  fuse?: boolean;
  /** Station: first pick (after hand picks) is the creature to tap. */
  tapPick?: boolean;
  /** Entwine: every mode. */
  entwine?: boolean;
  /** "Choose one or both": several modes. */
  modes?: number[];
  replicateTimes?: number;
}

/** A little menu of things a clicked card can do (cast / cycle / abilities…). */
interface ActionMenu {
  x: number;
  y: number;
  title: string;
  options: { label: string; run: () => void }[];
}

interface MenuState {
  x: number;
  y: number;
  card: CardView;
}

export interface GameBoardProps {
  view: GameView;
  syncSeq: number;
  log: string[];
  match: { wins: Record<PlayerId, number>; gameNumber: number } | null;
  onAction: (action: PlayerAction) => void;
  onExit: () => void;
}

export function GameBoard({ view, syncSeq, log, match, onAction, onExit }: GameBoardProps) {
  const you = view.you;
  const oppId: PlayerId = you === 'p1' ? 'p2' : 'p1';
  const me = view.players[you];
  const opp = view.players[oppId];

  const [targeting, setTargeting] = useState<Targeting | null>(null);
  const [attackSel, setAttackSel] = useState<Set<number>>(new Set());
  const [blockSel, setBlockSel] = useState<Map<number, number>>(new Map());
  const [selBlocker, setSelBlocker] = useState<number | null>(null);
  const [discardSel, setDiscardSel] = useState<Set<number>>(new Set());
  const [bottomSel, setBottomSel] = useState<Set<number>>(new Set());
  const [choiceSel, setChoiceSel] = useState<Set<number>>(new Set());
  const [modalPick, setModalPick] = useState<CardView | null>(null);
  const [modalSel, setModalSel] = useState<Set<number>>(new Set());
  const [loyaltyPick, setLoyaltyPick] = useState<CardView | null>(null);
  const [zonePick, setZonePick] = useState<{ player: PlayerId; zone: 'graveyard' | 'exile' } | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [actionMenu, setActionMenu] = useState<ActionMenu | null>(null);
  const [colorPick, setColorPick] = useState<{ objectId: number; abilityIndex: number; colors: string[]; name: string } | null>(null);
  const [nameText, setNameText] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [showStops, setShowStops] = useState(false);
  const [stops, setStops] = useState<StopsConfig>(loadStops);
  const [chatText, setChatText] = useState('');
  const [concedeArmed, setConcedeArmed] = useState(false);
  const [holdPriority, setHoldPriority] = useState(false);
  const [yieldUntil, setYieldUntil] = useState<YieldState | null>(null);
  const [zoneToasts, setZoneToasts] = useState<ZoneToast[]>([]);
  const concedeArmedRef = useRef(false);
  const prevViewRef = useRef<GameView | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const myPriority = view.priority === you && view.status === 'playing';
  const awaitingMyAttack = view.combatAwaiting === 'attackers' && view.activePlayer === you;
  const awaitingMyBlocks = view.combatAwaiting === 'blockers' && view.activePlayer === oppId;
  const myDiscard = view.pendingDecision?.type === 'discardToHandSize' && view.pendingDecision.player === you;
  const discardCount = myDiscard && view.pendingDecision?.type === 'discardToHandSize' ? view.pendingDecision.count : 0;
  const effectChoice = view.pendingDecision?.type === 'effectChoice' ? view.pendingDecision : null;
  const myChoice = effectChoice !== null && effectChoice.player === you ? effectChoice : null;
  const triggerTargets = view.pendingDecision?.type === 'chooseTargets' ? view.pendingDecision : null;
  const myMulligan = view.mulligan?.phase[you] === 'deciding';
  const mullTaken = view.mulligan?.taken[you] ?? 0;

  // Reset transient interaction state when the situation changes.
  useEffect(() => {
    setAttackSel(new Set());
    setBlockSel(new Map());
    setSelBlocker(null);
  }, [view.combatAwaiting, view.turn]);
  useEffect(() => setDiscardSel(new Set()), [myDiscard]);
  useEffect(() => setBottomSel(new Set()), [mullTaken, myMulligan]);
  useEffect(() => setChoiceSel(new Set()), [view.pendingDecision]);

  // Gatilho aguardando alvos meus → entra no modo de targeting automaticamente.
  useEffect(() => {
    if (triggerTargets && triggerTargets.player === you && !targeting) {
      setTargeting({
        kind: 'trigger',
        objectId: 0,
        specs: triggerTargets.specs,
        chosen: [],
        label: `${triggerTargets.cardName}: ${triggerTargets.text}`,
      });
    }
    if (!triggerTargets && targeting?.kind === 'trigger') setTargeting(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.pendingDecision, targeting]);
  useEffect(() => setTargeting(null), [view.turn, view.step]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log.length]);

  const saveStops = (next: StopsConfig) => {
    setStops(next);
    try {
      localStorage.setItem('sloptcg-stops', JSON.stringify(next));
    } catch {
      // localStorage indisponível: config só vale para a sessão
    }
  };

  // ---------------------------------------------------------- auto-yield
  // O jogo devolve o controle (cancela o yield) quando exige uma decisão.
  const yieldInterrupted = (v: GameView): boolean => {
    if (v.status !== 'playing' || v.mulligan) return true;
    const pd = v.pendingDecision;
    if (pd && 'player' in pd && pd.player === you) return true;
    if (v.combatAwaiting === 'attackers' && v.activePlayer === you) return true;
    if (v.combatAwaiting === 'blockers' && v.activePlayer === oppId) return true;
    return false;
  };

  const yieldReached = (v: GameView, y: YieldState): boolean => {
    const moved = v.step !== y.step || v.turn !== y.turn;
    switch (y.kind) {
      case 'nextStep': return moved;
      case 'combat': return moved && v.step === 'combatBegin';
      case 'mainPhase': return moved && (v.step === 'main1' || v.step === 'main2');
      case 'endStep': return moved && v.step === 'end';
      case 'myTurn': return v.activePlayer === you && v.turn !== y.turn;
    }
  };

  // Mantém o estado do yield honesto para a UI (botão aceso / prompt).
  useEffect(() => {
    if (yieldUntil && (yieldInterrupted(view) || yieldReached(view, yieldUntil))) setYieldUntil(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncSeq]);

  useEffect(() => {
    if (holdPriority) return; // hold priority: nunca passa sozinho
    const yielding = yieldUntil !== null && !yieldInterrupted(view) && !yieldReached(view, yieldUntil);
    if (!shouldAutoPass(view, stops, yielding)) return;
    const t = setTimeout(() => onAction({ type: 'passPriority' }), yielding ? 180 : 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncSeq, stops, yieldUntil, holdPriority]);

  const startYield = (kind: YieldState['kind']) => {
    if (yieldUntil?.kind === kind) {
      setYieldUntil(null); // clicar de novo cancela
      return;
    }
    setHoldPriority(false);
    setYieldUntil({ kind, step: view.step, turn: view.turn });
  };

  // ------------------------------------------- pop-ups de zona (toasts)
  useEffect(() => {
    const prev = prevViewRef.current;
    prevViewRef.current = view;
    if (!prev || view.status !== 'playing') return;
    const fresh: ZoneToast[] = [];
    for (const pid of ['p1', 'p2'] as PlayerId[]) {
      for (const zone of ['graveyard', 'exile'] as const) {
        const before = new Set(prev.players[pid][zone].map((c) => c.objectId));
        for (const c of view.players[pid][zone]) {
          if (!before.has(c.objectId)) {
            fresh.push({
              key: `${zone}-${c.objectId}-${view.turn}-${view.step}`,
              card: c,
              player: pid,
              zone,
              label: zone === 'graveyard' ? '→ cemitério' : '→ exílio',
            });
          }
        }
      }
      // Carta conjurada do cemitério (flashback): mostra de onde ela veio.
      const gravBefore = new Set(prev.players[pid].graveyard.map((c) => c.objectId));
      const stackBefore = new Set(prev.stack.map((s) => s.id));
      for (const item of view.stack) {
        if (!stackBefore.has(item.id) && gravBefore.has(item.sourceId)) {
          const cv = prev.players[pid].graveyard.find((c) => c.objectId === item.sourceId);
          if (cv) fresh.push({ key: `gcast-${item.id}`, card: cv, player: pid, zone: 'graveyard', label: '⚡ conjurada do cemitério' });
        }
      }
    }
    if (fresh.length === 0) return;
    setZoneToasts((t) => [...t, ...fresh].slice(-4));
    const keys = new Set(fresh.map((f) => f.key));
    // Sem cleanup: o timer precisa sobreviver aos próximos syncs.
    setTimeout(() => setZoneToasts((t) => t.filter((z) => !keys.has(z.key))), 6000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncSeq]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setTargeting(null);
        setMenu(null);
        setSelBlocker(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---------------------------------------------- attachments (empilhados)
  const allField = useMemo(() => [...opp.battlefield, ...me.battlefield], [opp.battlefield, me.battlefield]);
  const attachedIds = useMemo(
    () => new Set(allField.filter((c) => c.attachedTo !== null && allField.some((h) => h.objectId === c.attachedTo)).map((c) => c.objectId)),
    [allField],
  );
  const attachmentsOf = (hostId: number) => allField.filter((c) => c.attachedTo === hostId);
  const controllerOf = (id: number): PlayerId =>
    me.battlefield.some((c) => c.objectId === id) ? you : oppId;

  /** Row cards with each host followed by its attachments (cross-side too). */
  const rowCards = (cards: CardView[], lands: boolean): { card: CardView; attachment: boolean }[] =>
    cards
      .filter((c) => c.card.types.includes('Land') === lands)
      .filter((c) => !attachedIds.has(c.objectId))
      .flatMap((h) => [
        { card: h, attachment: false },
        ...attachmentsOf(h.objectId).map((a) => ({ card: a, attachment: true })),
      ]);

  // ------------------------------------------------------------ handlers

  const finishTargetingIfDone = (t: Targeting) => {
    if (t.chosen.length >= t.specs.length) {
      if (t.kind === 'trigger') {
        onAction({ type: 'chooseTargets', targets: t.chosen });
      } else if (t.kind === 'ninjutsu') {
        const atk = t.chosen[0];
        if (atk?.kind === 'object') {
          if (t.method === 'sneak') onAction({ type: 'castSpell', objectId: t.objectId, method: 'sneak', attackerId: atk.id });
          else onAction({ type: 'ninjutsu', objectId: t.objectId, attackerId: atk.id });
        }
      } else if (t.kind === 'spell') {
        // Ordem dos picks: cartas da mão (custo alternativo) → sacrifícios → alvos.
        const handPick = t.handPickCount ?? 0;
        const altExile = t.chosen.slice(0, handPick).flatMap((c) => (c.kind === 'object' ? [c.id] : []));
        const afterHand = t.chosen.slice(handPick);
        const sacCount = t.sacCount ?? 0;
        const sacrifices = afterHand
          .slice(0, sacCount)
          .flatMap((c) => (c.kind === 'object' ? [c.id] : []));
        const casualty = t.casualtyPick ? sacrifices.pop() : undefined;
        onAction({
          type: 'castSpell',
          objectId: t.objectId,
          targets: afterHand.slice(sacCount),
          x: t.x,
          mode: t.mode,
          kicked: t.kicked,
          sacrifices: sacrifices.length > 0 ? sacrifices : undefined,
          casualty,
          face: t.face,
          fuse: t.fuse,
          useAltCost: t.useAltCost,
          altExile: handPick > 0 && t.method !== 'retrace' && !t.handPickDiscard ? altExile : undefined,
          discards: t.method === 'retrace' || t.handPickDiscard ? altExile : undefined,
          method: t.method,
          escapeExile: t.escapeExile,
          faceDown: t.faceDown,
          buyback: t.buyback,
          kickerTimes: t.kickerTimes,
          entwine: t.entwine,
          modes: t.modes,
          replicateTimes: t.replicateTimes,
        });
      } else {
        // Ordem dos picks: cartas da mão (custo de descarte) → criatura a virar (station) → sacrifícios → alvos.
        const handPick = t.handPickCount ?? 0;
        const discards = t.chosen.slice(0, handPick).flatMap((c) => (c.kind === 'object' ? [c.id] : []));
        let afterHand = t.chosen.slice(handPick);
        let tapCreature: number | undefined;
        if (t.tapPick) {
          const tp = afterHand[0];
          tapCreature = tp?.kind === 'object' ? tp.id : undefined;
          afterHand = afterHand.slice(1);
        }
        const sacCount = t.sacCount ?? 0;
        const sacrifices = afterHand
          .slice(0, sacCount)
          .flatMap((c) => (c.kind === 'object' ? [c.id] : []));
        onAction({
          type: 'activateAbility',
          objectId: t.objectId,
          abilityIndex: t.abilityIndex ?? 0,
          targets: afterHand.slice(sacCount),
          sacrifices: sacCount > 0 ? sacrifices : undefined,
          discards: handPick > 0 ? discards : undefined,
          tapCreature,
        });
      }
      setTargeting(null);
    } else {
      setTargeting({ ...t });
    }
  };

  const addTarget = (choice: TargetChoice) => {
    if (!targeting) return;
    const t = { ...targeting, chosen: [...targeting.chosen, choice] };
    finishTargetingIfDone(t);
  };

  const clickHandCard = (cv: CardView, e?: React.MouseEvent) => {
    setMenu(null);
    setActionMenu(null);
    if (myMulligan) {
      if (mullTaken === 0) return;
      const next = new Set(bottomSel);
      if (next.has(cv.objectId)) next.delete(cv.objectId);
      else if (next.size < mullTaken) next.add(cv.objectId);
      setBottomSel(next);
      return;
    }
    if (myDiscard) {
      const next = new Set(discardSel);
      if (next.has(cv.objectId)) next.delete(cv.objectId);
      else if (next.size < discardCount) next.add(cv.objectId);
      setDiscardSel(next);
      return;
    }
    if (targeting) {
      // Custo alternativo: os primeiros picks são cartas da mão para exilar.
      const t = targeting;
      if (t.handPickCount && t.chosen.length < t.handPickCount) {
        if (cv.objectId === t.objectId) return;
        if (t.handPickColor && !cv.card.colors.includes(t.handPickColor as (typeof cv.card.colors)[number])) return;
        if (t.handPickLand && !cv.card.types.includes('Land')) return;
        addTarget({ kind: 'object', id: cv.objectId });
      }
      return;
    }
    if (!myPriority) return;
    const def = cv.card;
    const castable = def.automation !== 'manual';
    const opts: ActionMenu['options'] = [];
    if (def.types.includes('Land') && castable) {
      opts.push({ label: '⛰ Jogar terreno', run: () => onAction({ type: 'playLand', objectId: cv.objectId }) });
    }
    // Leva 5b: verso conjurável (MDFC, aventura, carta dividida).
    const back = def.backFace;
    if (back && (def.faceLayout === 'modal_dfc' || def.faceLayout === 'adventure' || def.faceLayout === 'split') && back.automation !== 'manual' && !back.aftermath) {
      if (back.types.includes('Land')) opts.push({ label: `⛰ Jogar terreno — verso: ${back.name}`, run: () => onAction({ type: 'playLand', objectId: cv.objectId, face: 'back' }) });
      else if (back.spellModes && back.spellModes.length > 0) opts.push({ label: `✨ Conjurar verso — ${back.name} ${back.manaCost ?? ''} (escolher modo)`, run: () => setModalPick({ ...cv, card: back }) });
      else opts.push({ label: `✨ Conjurar ${def.faceLayout === 'adventure' ? 'aventura' : 'verso'} — ${back.name} ${back.manaCost ?? ''}`, run: () => beginCast(cv, undefined, false, { face: 'back' }) });
    }
    if (!def.types.includes('Land') && castable) {
      if (def.spellModes && def.spellModes.length > 0)
        opts.push({ label: `✨ Conjurar ${def.manaCost ?? ''} (escolher modo)`, run: () => setModalPick(cv) });
      else opts.push({ label: `✨ Conjurar ${def.manaCost ?? ''}`, run: () => beginCast(cv, undefined) });
      if (def.altCost)
        opts.push({ label: `⚡ Conjurar — ${def.altCost.label}`, run: () => beginAltCast(cv) });
      // Leva 2: métodos alternativos de conjuração a partir da mão.
      for (const cm of def.castMethods ?? []) {
        if (cm.kind === 'escape' || cm.kind === 'foretold' || cm.kind === 'plotted' || cm.kind === 'mayhem' || cm.kind === 'retrace') continue;
        if (cm.kind === 'sneak') {
          if (view.step === 'declareBlockers' && view.activePlayer === you && me.battlefield.some((c) => c.attacking && !c.wasBlocked))
            opts.push({
              label: `🥷 Conjurar — ${cm.label}`,
              run: () => setTargeting({ kind: 'ninjutsu', objectId: cv.objectId, specs: [{ what: 'sua criatura atacante não bloqueada' }], chosen: [], label: `${def.name}: sneak — escolha o atacante`, method: 'sneak' }),
            });
          continue;
        }
        opts.push({ label: `⚡ Conjurar — ${cm.label}`, run: () => beginCast(cv, undefined, false, { method: cm.kind }) });
      }
      if (def.entwine && def.spellModes)
        opts.push({ label: `⚡ Conjurar — entwine ${def.entwine} (todos os modos)`, run: () => beginCast(cv, undefined, false, { entwine: true }) });
      if (def.fuse && def.backFace)
        opts.push({ label: `⚡ Fundir — ${def.name} + ${def.backFace.name} (${def.manaCost ?? ''}${def.backFace.manaCost ?? ''})`, run: () => beginCast(cv, undefined, false, { fuse: true }) });
      if (cv.miracleAvailable) {
        const mir = def.castMethods?.find((m) => m.kind === 'miracle');
        if (mir) opts.unshift({ label: `✨ Milagre! Conjurar por ${mir.cost}`, run: () => beginCast(cv, undefined, false, { method: 'miracle' }) });
      }
      if (def.morph)
        opts.push({ label: `🔒 Conjurar virada para baixo {3} (${def.morph.disguise ? 'disfarce' : 'metamorfose'} ${def.morph.cost})`, run: () => onAction({ type: 'castSpell', objectId: cv.objectId, faceDown: true }) });
      if (def.suspend)
        opts.push({ label: `⏳ Suspender ${def.suspend.count} — ${def.suspend.cost}`, run: () => onAction({ type: 'castSpell', objectId: cv.objectId, method: 'suspend' }) });
      if (def.ninjutsu && view.step === 'declareBlockers' && view.activePlayer === you) {
        const unblocked = me.battlefield.filter((c) => c.attacking && !c.wasBlocked);
        if (unblocked.length > 0)
          opts.push({
            label: `🥷 Ninjutsu ${def.ninjutsu} (troca por atacante não bloqueado)`,
            run: () => setTargeting({ kind: 'ninjutsu', objectId: cv.objectId, specs: [{ what: 'sua criatura atacante não bloqueada' }], chosen: [], label: `${def.name}: ninjutsu — escolha o atacante` }),
          });
      }
    }
    // Habilidades ativáveis da mão (prever, tramar).
    (def.abilities ?? []).forEach((a, i) => {
      if (a.kind === 'activated' && a.zone === 'hand')
        opts.push({ label: `🔮 ${a.text}`, run: () => onAction({ type: 'activateAbility', objectId: cv.objectId, abilityIndex: i }) });
    });
    if (def.cycling)
      opts.push({
        label: `♻ Reciclar (${def.cycling.mana ?? ''}${def.cycling.life ? `${def.cycling.life} vidas` : ''})`,
        run: () => onAction({ type: 'cycle', objectId: cv.objectId }),
      });
    if (!castable) {
      opts.push({ label: '⚠ Manual: → campo de batalha', run: () => onAction({ type: 'manualMove', objectId: cv.objectId, to: 'battlefield' }) });
      opts.push({ label: '⚠ Manual: → cemitério', run: () => onAction({ type: 'manualMove', objectId: cv.objectId, to: 'graveyard' }) });
    }
    if (opts.length === 0) return;
    if (opts.length === 1) {
      opts[0].run();
      return;
    }
    setActionMenu({
      x: Math.min(e?.clientX ?? 200, window.innerWidth - 280),
      y: Math.min(e?.clientY ?? 200, window.innerHeight - 60 - opts.length * 34),
      title: def.name,
      options: opts,
    });
  };

  /** Cast paying the alternative cost (Force of Will): exiles first, then targets. */
  const beginAltCast = (cv: CardView) => {
    const def = cv.card;
    const alt = def.altCost;
    if (!alt) return;
    const exCount = alt.exileFromHand?.count ?? 0;
    const exSpecs = Array.from({ length: exCount }, () => ({ what: 'carta da sua mão para exilar' }));
    const specs = [...exSpecs, ...(def.spellTargets ?? [])];
    if (specs.length === 0) {
      onAction({ type: 'castSpell', objectId: cv.objectId, useAltCost: true, altExile: [] });
      return;
    }
    setTargeting({
      kind: 'spell',
      objectId: cv.objectId,
      specs,
      chosen: [],
      label: `${def.name} (${alt.label})`,
      useAltCost: true,
      handPickCount: exCount,
      handPickColor: alt.exileFromHand?.filter.color,
    });
  };

  /** Start casting: asks for X/kicker, then sacrifices/targets, then sends. */
  const beginCast = (
    cv: CardView,
    mode: number | undefined,
    fromGraveyard = false,
    extra: { method?: CastMethodKind; escapeExile?: number[]; entwine?: boolean; modes?: number[]; face?: 'back'; fuse?: boolean } = {},
  ) => {
    // Leva 5b: conjurar o verso (MDFC, aventura, metade de carta dividida) usa a definição do verso.
    const def = (extra.face === 'back' || extra.method === 'disturb') && cv.card.backFace ? cv.card.backFace : cv.card;
    let x: number | undefined;
    if (def.manaCost && def.manaCost.includes('{X}')) {
      const raw = prompt(`${def.name}: escolha o valor de X`, '1');
      if (raw === null) return;
      x = parseInt(raw, 10);
      if (!Number.isInteger(x) || x < 0) return;
    }
    let kicked: boolean | undefined;
    let kickerTimes: number | undefined;
    if (def.kicker && def.multikicker) {
      const raw = prompt(`${def.name}: quantas vezes pagar ${def.kicker.cost}? (0 = nenhuma)`, '0');
      if (raw === null) return;
      kickerTimes = parseInt(raw, 10);
      if (!Number.isInteger(kickerTimes) || kickerTimes < 0) return;
      kicked = kickerTimes > 0;
    } else if (def.kicker) kicked = confirm(`${def.name}: ${def.kicker.label ? `${def.kicker.label}?` : `pagar o kicker ${def.kicker.cost}?`}`);
    let buyback: boolean | undefined;
    if (def.buyback && !extra.method) buyback = confirm(`${def.name}: pagar buyback ${def.buyback} (volta para a mão)?`);
    let replicateTimes: number | undefined;
    if (def.replicate && !extra.method) {
      const raw = prompt(`${def.name}: quantas vezes pagar replicar ${def.replicate}? (0 = nenhuma; cada uma cria uma cópia)`, '0');
      if (raw === null) return;
      replicateTimes = parseInt(raw, 10);
      if (!Number.isInteger(replicateTimes) || replicateTimes < 0) return;
    }
    // Custo adicional de sacrifício (Fling; flashback da Cabal Therapy; emerge; bargain):
    // escolhido como os primeiros "alvos".
    const fbSac = fromGraveyard ? def.flashback?.sacrifice : undefined;
    const bargainSac = kicked && def.kicker?.sacrifice ? 'artefato, encantamento ou ficha para sacrificar' : undefined;
    const emergeSac = extra.method === 'emerge' ? 'criatura para sacrificar (emergir)' : undefined;
    const sacCount = def.additionalCost?.sacrifice ? def.additionalCost.count ?? 1 : fbSac || bargainSac || emergeSac ? 1 : 0;
    const sacSpecs = Array.from({ length: sacCount }, () => ({
      what: def.additionalCost?.sacrifice?.what ?? fbSac?.what ?? emergeSac ?? bargainSac ?? 'permanent',
    }));
    // Custo adicional de vida (Leva 5): confirmação explícita.
    if (def.additionalCost?.payLife && !confirm(`${def.name}: pagar ${def.additionalCost.payLife} pontos de vida como custo adicional?`)) return;
    // Casualty N (Leva 5b): sacrifício opcional para copiar a mágica.
    const casualtyPick = def.casualty !== undefined && confirm(`${def.name}: casualty ${def.casualty} — sacrificar uma criatura com poder ${def.casualty} ou mais para copiar a mágica?`);
    if (casualtyPick) sacSpecs.push({ what: `criatura com poder ${def.casualty} ou mais para sacrificar (casualty)` });
    // Retrace: uma carta de terreno da mão para descartar, antes de tudo. Custo adicional de descarte: N cartas da mão.
    const discardCost = extra.method !== 'retrace' ? def.additionalCost?.discard ?? 0 : 0;
    const handPickCount = extra.method === 'retrace' ? 1 : discardCost;
    const handSpecs = extra.method === 'retrace' ? [{ what: 'carta de terreno da sua mão para descartar' }] : Array.from({ length: discardCost }, () => ({ what: 'carta da sua mão para descartar' }));
    const targetSpecs = extra.fuse
      ? [...(cv.card.spellTargets ?? []), ...(cv.card.backFace?.spellTargets ?? [])]
      : extra.entwine
      ? (def.spellModes ?? []).flatMap((m) => m.targets ?? [])
      : extra.modes
        ? extra.modes.flatMap((i) => def.spellModes?.[i]?.targets ?? [])
        : mode !== undefined
        ? def.spellModes?.[mode]?.targets ?? []
        : extra.method === 'bestow'
          ? [{ what: 'creature' }]
          : extra.method === 'overload'
            ? []
            : def.enchant
              ? [{ what: def.enchant.what }]
              : def.spellTargets ?? [];
    const specs = [...handSpecs, ...sacSpecs, ...targetSpecs];
    if (specs.length === 0) {
      onAction({ type: 'castSpell', objectId: cv.objectId, x, mode, modes: extra.modes, kicked, kickerTimes, buyback, method: extra.method, escapeExile: extra.escapeExile, entwine: extra.entwine, replicateTimes, face: extra.face, fuse: extra.fuse });
    } else {
      const base = mode !== undefined ? `${def.name} — ${def.spellModes?.[mode]?.label}` : extra.modes ? `${def.name} — ${extra.modes.map((i) => def.spellModes?.[i]?.label).join(' + ')}` : def.name;
      const label = handPickCount > 0 ? `${base} (escolha ${extra.method === 'retrace' ? 'o terreno' : 'a(s) carta(s)'} a descartar primeiro)` : sacCount > 0 ? `${base} (escolha o sacrifício primeiro)` : base;
      setTargeting({ kind: 'spell', objectId: cv.objectId, specs, chosen: [], label, x, mode, modes: extra.modes, kicked, kickerTimes, buyback, sacCount: sacSpecs.length, method: extra.method, escapeExile: extra.escapeExile, entwine: extra.entwine, handPickCount: handPickCount || undefined, handPickLand: extra.method === 'retrace' || undefined, handPickDiscard: discardCost > 0 || undefined, replicateTimes, casualtyPick: casualtyPick || undefined, face: extra.face, fuse: extra.fuse });
    }
  };

  /** Escape: exiles the N oldest other cards of the graveyard automatically. */
  const beginEscape = (cv: CardView) => {
    const cm = cv.card.castMethods?.find((m) => m.kind === 'escape');
    if (!cm) return;
    const others = me.graveyard.filter((c) => c.objectId !== cv.objectId).map((c) => c.objectId);
    const need = cm.exileFromGraveyard ?? 0;
    if (others.length < need) {
      alert(`Escapar precisa exilar ${need} outras cartas do cemitério (você tem ${others.length}).`);
      return;
    }
    beginCast(cv, undefined, false, { method: 'escape', escapeExile: others.slice(0, need) });
  };

  const clickFieldCard = (cv: CardView, owner: PlayerId, e?: React.MouseEvent) => {
    setMenu(null);
    if (targeting) {
      addTarget({ kind: 'object', id: cv.objectId });
      return;
    }
    if (awaitingMyAttack && owner === you && cv.card.types.includes('Creature')) {
      const next = new Set(attackSel);
      if (next.has(cv.objectId)) next.delete(cv.objectId);
      else next.add(cv.objectId);
      setAttackSel(next);
      return;
    }
    if (awaitingMyBlocks) {
      if (owner === you && cv.card.types.includes('Creature')) {
        setSelBlocker(cv.objectId === selBlocker ? null : cv.objectId);
        return;
      }
      if (owner === oppId && cv.attacking && selBlocker !== null) {
        const next = new Map(blockSel);
        next.set(selBlocker, cv.objectId);
        setBlockSel(next);
        setSelBlocker(null);
        return;
      }
      return;
    }
    if (owner === you) {
      // Undo de mana: clique na permanente virada enquanto a mana flutua.
      if (cv.tapped && cv.undoableTap) {
        onAction({ type: 'undoTap', objectId: cv.objectId });
        return;
      }
      const abilities = cv.card.abilities ?? [];
      // Planeswalker: pick one of the loyalty abilities from an overlay.
      if (cv.card.types.includes('Planeswalker') && abilities.some((a) => a.kind === 'loyalty')) {
        setLoyaltyPick(cv);
        return;
      }
      const activated = abilities
        .map((a, i) => ({ a, i }))
        .filter((x): x is { a: Extract<typeof x.a, { kind: 'activated' }>; i: number } => x.a.kind === 'activated');
      const opts: ActionMenu['options'] = activated
        .filter(({ a }) => (a.zone ?? 'battlefield') === 'battlefield' && !cv.faceDown)
        .map(({ a, i }) => ({ label: `⚙ ${a.text}`, run: () => startAbility(cv, i, a) }));
      if (cv.card.crew !== undefined && !cv.crewed)
        opts.unshift({ label: `🚗 Tripular ${cv.card.crew} (vira criatura até o fim do turno)`, run: () => crewVehicle(cv) });
      if (cv.faceDown && cv.card.morph)
        opts.unshift({ label: `🔓 Virar para cima — ${cv.card.morph.cost}`, run: () => onAction({ type: 'turnFaceUp', objectId: cv.objectId }) });
      if (opts.length === 0) return;
      if (opts.length === 1) {
        opts[0].run();
        return;
      }
      setActionMenu({
        x: Math.min(e?.clientX ?? 200, window.innerWidth - 280),
        y: Math.min(e?.clientY ?? 200, window.innerHeight - 60 - opts.length * 34),
        title: cv.card.name,
        options: opts,
      });
    }
  };

  /** Route an activated ability: color choice first when it produces "any color" mana. */
  const startAbility = (
    cv: CardView,
    idx: number,
    ability: Extract<NonNullable<CardView['card']['abilities']>[number], { kind: 'activated' }>,
  ) => {
    const choice = ability.effect.find((s) => s.op === 'addManaChoice');
    if (choice && choice.op === 'addManaChoice') {
      setColorPick({
        objectId: cv.objectId,
        abilityIndex: idx,
        colors: choice.colors ?? ['W', 'U', 'B', 'R', 'G'],
        name: cv.card.name,
      });
      return;
    }
    // Leva 5: "Add {C} or one mana of the chosen color" / "Add {R} or {G}" pela gramática.
    const opts = ability.effect.find((s) => s.op === 'addManaOptions');
    if (opts && opts.op === 'addManaOptions') {
      const colors = [...opts.options, ...(opts.chosenColor && cv.chosenColor ? [cv.chosenColor] : [])];
      if (colors.length === 1) { onAction({ type: 'activateAbility', objectId: cv.objectId, abilityIndex: idx, manaColor: colors[0] as 'C' }); return; }
      setColorPick({ objectId: cv.objectId, abilityIndex: idx, colors, name: cv.card.name });
      return;
    }
    beginAbility(cv, idx, ability);
  };

  /** Activate an ability, collecting sacrifice cost and targets by clicks. */
  const beginAbility = (
    cv: CardView,
    idx: number,
    ability: { targets?: { what: string }[]; text: string; cost?: number | { sacrifice?: { what?: string }; discard?: number; tapCreature?: boolean } },
  ) => {
    const sacFilter = typeof ability.cost === 'object' ? ability.cost.sacrifice : undefined;
    const discardCount = typeof ability.cost === 'object' ? ability.cost.discard ?? 0 : 0;
    const tapPick = typeof ability.cost === 'object' ? !!ability.cost.tapCreature : false;
    const sacCount = sacFilter ? 1 : 0;
    const discardSpecs = Array.from({ length: discardCount }, () => ({ what: 'carta da sua mão para descartar' }));
    const tapSpecs = tapPick ? [{ what: 'outra criatura sua desvirada para virar' }] : [];
    const sacSpecs = sacCount > 0 ? [{ what: sacFilter?.what ?? 'permanent' }] : [];
    const specs = [...discardSpecs, ...tapSpecs, ...sacSpecs, ...(ability.targets ?? [])];
    if (specs.length === 0) {
      onAction({ type: 'activateAbility', objectId: cv.objectId, abilityIndex: idx });
    } else {
      const label =
        discardCount > 0
          ? `${cv.card.name}: ${ability.text} (escolha o descarte primeiro)`
          : tapPick
            ? `${cv.card.name}: ${ability.text} (escolha a criatura a virar)`
            : sacCount > 0
              ? `${cv.card.name}: ${ability.text} (escolha o sacrifício primeiro)`
              : `${cv.card.name}: ${ability.text}`;
      setTargeting({ kind: 'ability', objectId: cv.objectId, abilityIndex: idx, specs, chosen: [], label, sacCount, handPickCount: discardCount || undefined, tapPick: tapPick || undefined });
    }
  };

  /** Crew: auto-pick the fewest untapped creatures whose power reaches the crew number. */
  const crewVehicle = (cv: CardView) => {
    const need = cv.card.crew ?? 0;
    const cands = me.battlefield
      .filter((c) => c.objectId !== cv.objectId && !c.tapped && (c.card.types.includes('Creature') || c.crewed) && c.power !== null)
      .sort((a, b) => (b.power ?? 0) - (a.power ?? 0));
    const picked: number[] = [];
    let total = 0;
    for (const c of cands) {
      if (total >= need) break;
      picked.push(c.objectId);
      total += c.power ?? 0;
    }
    if (total < need) {
      onAction({ type: 'chat', text: `(não há criaturas desviradas suficientes para tripular ${cv.card.name})` });
      return;
    }
    onAction({ type: 'crew', objectId: cv.objectId, creatures: picked });
  };

  const clickPlayer = (playerId: PlayerId) => {
    if (targeting) addTarget({ kind: 'player', player: playerId });
  };

  const clickStackItem = (itemIdx: number) => {
    // Alvo em mágica na pilha (counterspell): o sourceId é o objectId do card.
    const item = view.stack[itemIdx];
    if (targeting && item?.kind === 'spell') {
      addTarget({ kind: 'object', id: item.sourceId });
    }
  };

  const openMenu = (e: React.MouseEvent, cv: CardView) => {
    e.preventDefault();
    setMenu({ x: Math.min(e.clientX, window.innerWidth - 220), y: Math.min(e.clientY, window.innerHeight - 320), card: cv });
  };

  const confirmAttack = () => {
    let defendTarget: number | undefined;
    const enemyWalkers = opp.battlefield.filter((c) => c.card.types.includes('Planeswalker'));
    if (attackSel.size > 0 && enemyWalkers.length > 0) {
      const pw = enemyWalkers[0];
      if (confirm(`Atacar ${pw.card.name} em vez do jogador? (OK = planeswalker, Cancelar = jogador)`))
        defendTarget = pw.objectId;
    }
    // Exert: pergunta por atacante que permite ("you may exert ~ as it attacks").
    const exerted: number[] = [];
    for (const id of attackSel) {
      const c = me.battlefield.find((x) => x.objectId === id);
      if (c?.card.canExert && confirm(`Exert ${c.card.name}? (não desvira no seu próximo turno)`)) exerted.push(id);
    }
    onAction({ type: 'declareAttackers', attackers: [...attackSel], defendTarget, exerted: exerted.length > 0 ? exerted : undefined });
  };
  const confirmBlocks = () =>
    onAction({ type: 'declareBlockers', blocks: [...blockSel.entries()].map(([blocker, attacker]) => ({ blocker, attacker })) });

  // --------------------------------------------------------------- render

  const isTargetableCard = (cv: CardView): boolean => {
    if (!targeting) return false;
    const spec = targeting.specs[targeting.chosen.length];
    if (!spec) return false;
    if (spec.what === 'player') return false;
    if (spec.what === 'creature') return cv.card.types.includes('Creature');
    return true;
  };

  const promptText = (() => {
    if (view.status === 'finished') return null;
    if (view.mulligan) {
      if (myMulligan)
        return mullTaken > 0
          ? `Mulligan ${mullTaken}: mantenha escolhendo ${mullTaken} carta(s) para o fundo, ou compre 7 de novo`
          : 'Decida sua mão inicial';
      return 'Aguardando o oponente decidir a mão…';
    }
    if (view.pendingDecision?.type === 'chooseMode' && view.pendingDecision.player !== you) return 'Aguardando o oponente escolher um modo…';
    if (targeting) return `${targeting.label}: escolha o alvo (${targeting.chosen.length + 1}/${targeting.specs.length}) — Esc cancela`;
    if (myChoice) return myChoice.prompt;
    if (effectChoice) return 'Aguardando a escolha do oponente…';
    if (triggerTargets && triggerTargets.player !== you) return 'Aguardando o oponente escolher alvos…';
    if (myDiscard) return `Descarte ${discardCount} carta(s): selecione na mão e confirme`;
    if (awaitingMyAttack) return 'Escolha seus atacantes e confirme';
    if (awaitingMyBlocks) return 'Clique num bloqueador seu, depois no atacante; confirme';
    if (view.combatAwaiting) return 'Aguardando o oponente…';
    if (yieldUntil) return `⏭ Passando automaticamente até ${YIELD_LABEL[yieldUntil.kind]} — clique de novo para cancelar`;
    if (holdPriority && myPriority) return '📌 Segurando a prioridade — jogue mais mágicas ou passe manualmente';
    if (myPriority && view.stack.length > 0) return 'Responder à pilha ou resolver';
    if (myPriority && (view.step === 'main1' || view.step === 'main2') && view.activePlayer === you)
      return 'Sua fase principal — jogue cartas ou passe';
    if (myPriority) return 'Você tem a prioridade';
    return 'Aguardando o oponente…';
  })();

  return (
    <div className="table" onClick={() => { setMenu(null); setShowStops(false); setActionMenu(null); }}>
      {/* -------- oponente -------- */}
      <div className={`opp-bar player-bar ${view.priority === oppId ? 'priority-holder' : ''}`}>
        <div
          className={`life ${targeting ? 'targetable' : ''}`}
          onClick={() => clickPlayer(oppId)}
          title={targeting ? 'Escolher como alvo' : `${opp.name}`}
        >
          {opp.life}
        </div>
        <strong>{opp.name}</strong>
        {opp.poison > 0 && <span className="zone-pill" title="Marcadores de veneno (10 = derrota)">☠ {opp.poison}</span>}
        {opp.energy > 0 && <span className="zone-pill" title="Energia">⚡ {opp.energy}</span>}
        {view.monarch === oppId && <span className="zone-pill" title="Monarca: compra uma carta no fim do turno">👑 monarca</span>}
        {view.initiative === oppId && <span className="zone-pill" title="Iniciativa: aventura-se em Undercity na manutenção">🗡 iniciativa</span>}
        {opp.dungeon && <span className="zone-pill" title={opp.dungeon.name}>🏰 {opp.dungeon.room}</span>}
        {opp.completedDungeons > 0 && <span className="zone-pill" title="Masmorras completadas">🏆 {opp.completedDungeons}</span>}
        {view.activePlayer === oppId && <span className="zone-pill">turno dele</span>}
        <span className="zone-pill" title="Cartas na mão">✋ {opp.handSize}</span>
        <span className="zone-pill" title="Cartas na biblioteca">📚 {opp.librarySize}</span>
        <span
          className="zone-pill"
          style={{ cursor: 'pointer' }}
          title="Ver cemitério"
          onClick={(e) => { e.stopPropagation(); setZonePick({ player: oppId, zone: 'graveyard' }); }}
        >
          🪦 {opp.graveyard.length}
        </span>
        <span
          className="zone-pill"
          style={{ cursor: 'pointer' }}
          title="Ver exílio"
          onClick={(e) => { e.stopPropagation(); setZonePick({ player: oppId, zone: 'exile' }); }}
        >
          🌀 {opp.exile.length}
        </span>
        <ManaChips pool={opp.manaPool} />
      </div>

      <div className="opp-field battlefield">
        <div className="field-row">
          {rowCards(opp.battlefield, false).map(({ card: c, attachment }) => (
            <CardTile
              key={c.objectId}
              card={c}
              attachment={attachment}
              targetable={isTargetableCard(c)}
              selected={selBlocker !== null && c.attacking}
              onClick={(e) => { e.stopPropagation(); clickFieldCard(c, controllerOf(c.objectId), e); }}
            />
          ))}
        </div>
        <div className="field-row">
          {rowCards(opp.battlefield, true).map(({ card: c, attachment }) => (
            <CardTile key={c.objectId} card={c} attachment={attachment} targetable={isTargetableCard(c)}
              onClick={(e) => { e.stopPropagation(); clickFieldCard(c, controllerOf(c.objectId), e); }} />
          ))}
        </div>
      </div>

      {/* -------- barra de fases -------- */}
      <div className="phase-bar phase-strip">
        {STEPS.map((s) => (
          <span key={s} className={`phase-step ${view.step === s ? 'current' : ''}`} title={stepName(s)}>
            {STEP_SHORT[s]}
          </span>
        ))}
        <div className="phase-actions">
          {promptText && <span className="prompt-banner">{promptText}</span>}
          {targeting && <button onClick={() => setTargeting(null)}>Cancelar</button>}
          {awaitingMyAttack && (
            <button className="primary" onClick={confirmAttack}>
              {attackSel.size > 0 ? `Atacar com ${attackSel.size}` : 'Não atacar'}
            </button>
          )}
          {awaitingMyBlocks && (
            <button className="primary" onClick={confirmBlocks}>
              {blockSel.size > 0 ? `Confirmar ${blockSel.size} bloqueio(s)` : 'Não bloquear'}
            </button>
          )}
          {myDiscard && (
            <button className="primary" disabled={discardSel.size !== discardCount}
              onClick={() => onAction({ type: 'chooseDiscard', objectIds: [...discardSel] })}>
              Descartar {discardSel.size}/{discardCount}
            </button>
          )}
          {myPriority && !view.combatAwaiting && !myDiscard && !view.mulligan && (
            <button onClick={() => onAction({ type: 'passPriority' })}>
              {view.stack.length > 0 ? 'Resolver' : 'Passar'}
            </button>
          )}
          {view.status === 'playing' && !view.mulligan && (
            <div className="yield-group" title="Auto-yield: passa a prioridade sozinho até o momento escolhido">
              <button
                className={yieldUntil?.kind === 'nextStep' ? 'yield-on' : ''}
                title="Passar até a próxima etapa"
                onClick={(e) => { e.stopPropagation(); startYield('nextStep'); }}
              >
                ⏭ Etapa
              </button>
              <button
                className={yieldUntil?.kind === 'combat' ? 'yield-on' : ''}
                title="Passar até o próximo combate"
                onClick={(e) => { e.stopPropagation(); startYield('combat'); }}
              >
                ⏭ Combate
              </button>
              <button
                className={yieldUntil?.kind === 'mainPhase' ? 'yield-on' : ''}
                title="Passar até a próxima fase principal"
                onClick={(e) => { e.stopPropagation(); startYield('mainPhase'); }}
              >
                ⏭ Main
              </button>
              <button
                className={yieldUntil?.kind === 'endStep' ? 'yield-on' : ''}
                title="Passar até a próxima etapa final"
                onClick={(e) => { e.stopPropagation(); startYield('endStep'); }}
              >
                ⏭ Final
              </button>
              <button
                className={yieldUntil?.kind === 'myTurn' ? 'yield-on' : ''}
                title="Passar até o meu próximo turno"
                onClick={(e) => { e.stopPropagation(); startYield('myTurn'); }}
              >
                ⏭ Meu turno
              </button>
              <button
                className={holdPriority ? 'yield-on' : ''}
                title="Segurar a prioridade: nada é passado automaticamente — empilhe várias mágicas antes de resolver"
                onClick={(e) => { e.stopPropagation(); setYieldUntil(null); setHoldPriority(!holdPriority); }}
              >
                📌
              </button>
            </div>
          )}
          <button
            title="Paradas automáticas"
            onClick={(e) => { e.stopPropagation(); setShowStops(!showStops); }}
          >
            ⏱
          </button>
        </div>
      </div>

      {/* -------- meu campo -------- */}
      <div className="my-field battlefield">
        <div className="field-row">
          {rowCards(me.battlefield, false).map(({ card: c, attachment }) => (
            <CardTile
              key={c.objectId}
              card={c}
              attachment={attachment}
              targetable={isTargetableCard(c)}
              selected={attackSel.has(c.objectId) || selBlocker === c.objectId || blockSel.has(c.objectId)}
              onClick={(e) => { e.stopPropagation(); clickFieldCard(c, controllerOf(c.objectId), e); }}
              onContextMenu={(e) => openMenu(e, c)}
            />
          ))}
        </div>
        <div className="field-row">
          {rowCards(me.battlefield, true).map(({ card: c, attachment }) => (
            <CardTile
              key={c.objectId}
              card={c}
              attachment={attachment}
              targetable={isTargetableCard(c)}
              onClick={(e) => { e.stopPropagation(); clickFieldCard(c, controllerOf(c.objectId), e); }}
              onContextMenu={(e) => openMenu(e, c)}
            />
          ))}
        </div>
      </div>

      {/* -------- minha barra + mão -------- */}
      <div className={`my-bar player-bar ${myPriority ? 'priority-holder' : ''}`}>
        <div className={`life ${targeting ? 'targetable' : ''}`} onClick={() => clickPlayer(you)}>
          {me.life}
        </div>
        {me.poison > 0 && <span className="zone-pill" title="Marcadores de veneno (10 = derrota)">☠ {me.poison}</span>}
        {me.energy > 0 && <span className="zone-pill" title="Energia">⚡ {me.energy}</span>}
        {view.monarch === you && <span className="zone-pill" title="Monarca: você compra uma carta no fim do seu turno">👑 monarca</span>}
        {view.initiative === you && <span className="zone-pill" title="Iniciativa: você se aventura em Undercity na sua manutenção">🗡 iniciativa</span>}
        {me.dungeon && <span className="zone-pill" title={me.dungeon.name}>🏰 {me.dungeon.room}</span>}
        {me.completedDungeons > 0 && <span className="zone-pill" title="Masmorras completadas">🏆 {me.completedDungeons}</span>}
        {me.dredgeArmed && <span className="zone-pill" title="A próxima compra será substituída por dragar">♻ {me.dredgeArmed}</span>}
        <span className="zone-pill" title="Cartas na biblioteca">📚 {me.librarySize}</span>
        {me.libraryTop && <span className="zone-pill" title="Topo da sua biblioteca (revelado para você)">🔝 {me.libraryTop.card.name}</span>}
        <span
          className="zone-pill"
          style={{ cursor: 'pointer' }}
          title="Ver cemitério"
          onClick={(e) => { e.stopPropagation(); setZonePick({ player: you, zone: 'graveyard' }); }}
        >
          🪦 {me.graveyard.length}
        </span>
        <span
          className="zone-pill"
          style={{ cursor: 'pointer' }}
          title="Ver exílio"
          onClick={(e) => { e.stopPropagation(); setZonePick({ player: you, zone: 'exile' }); }}
        >
          🌀 {me.exile.length}
        </span>
        <ManaChips pool={me.manaPool} />
        <div className="hand-row">
          {(me.hand ?? []).map((c) => (
            <CardTile
              key={c.objectId}
              card={c}
              size="hand"
              selected={discardSel.has(c.objectId) || bottomSel.has(c.objectId)}
              dimmed={myDiscard && !discardSel.has(c.objectId) && discardSel.size >= discardCount}
              onClick={(e) => { e.stopPropagation(); clickHandCard(c, e); }}
              onContextMenu={(e) => openMenu(e, c)}
            />
          ))}
        </div>
        <button onClick={(e) => { e.stopPropagation(); setShowManual(!showManual); }} title="Ações manuais (Tier 3)">
          🛠
        </button>
      </div>

      {/* -------- painel lateral -------- */}
      <div className="side-panel">
        <div className="phase-strip" style={{ justifyContent: 'space-between' }}>
          <span className="panel-title">
            {match ? `Jogo ${match.gameNumber} (${match.wins[you]}–${match.wins[oppId]}) · ` : ''}
            Turno {view.turn} · {stepName(view.step)}
          </span>
          <button
            className="danger"
            onClick={(e) => {
              e.stopPropagation();
              // Ref evita o clique-duplo ler estado velho (stale closure).
              if (concedeArmedRef.current) {
                concedeArmedRef.current = false;
                setConcedeArmed(false);
                onAction({ type: 'concede' });
              } else {
                concedeArmedRef.current = true;
                setConcedeArmed(true);
                setTimeout(() => {
                  concedeArmedRef.current = false;
                  setConcedeArmed(false);
                }, 3000);
              }
            }}
          >
            {concedeArmed ? 'Confirmar?' : 'Conceder'}
          </button>
        </div>
        {showManual && (
          <div className="stack-panel">
            <div className="panel-title">Modo manual — tudo fica no log</div>
            <div className="manual-drawer">
              <button onClick={() => onAction({ type: 'manualDraw', count: 1 })}>Comprar carta</button>
              <button onClick={() => onAction({ type: 'manualLife', player: you, delta: 1 })}>+1 vida</button>
              <button onClick={() => onAction({ type: 'manualLife', player: you, delta: -1 })}>-1 vida</button>
              <button onClick={() => onAction({ type: 'manualUntapAll' })}>Desvirar tudo</button>
              <button onClick={() => onAction({ type: 'manualShuffle' })}>Embaralhar</button>
              <button
                onClick={() => {
                  const name = prompt('Nome da ficha:', 'Goblin');
                  if (!name) return;
                  const pt = prompt('Poder/resistência (ex.: 1/1):', '1/1') ?? '1/1';
                  const m = pt.match(/(\d+)\s*\/\s*(\d+)/);
                  onAction({ type: 'manualToken', name, power: m ? parseInt(m[1], 10) : 1, toughness: m ? parseInt(m[2], 10) : 1 });
                }}
              >
                Criar ficha
              </button>
            </div>
          </div>
        )}
        <div className="log-panel" ref={logRef}>
          {log.map((line, i) => (
            <div key={i} className={i >= log.length - 6 ? 'recent' : ''}>{line}</div>
          ))}
        </div>
        <div className="row">
          <input
            placeholder="chat…"
            value={chatText}
            onChange={(e) => setChatText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && chatText.trim()) {
                onAction({ type: 'chat', text: chatText.trim() });
                setChatText('');
              }
            }}
          />
        </div>
      </div>

      {/* -------- pilha (pop-up com as cartas, estilo MTGO) -------- */}
      {view.stack.length > 0 && (
        <div className="stack-popup" onClick={(e) => e.stopPropagation()}>
          <div className="panel-title">Pilha — a da esquerda resolve primeiro</div>
          <div className="stack-cards">
            {[...view.stack].reverse().map((item, i) => (
              <div
                key={item.id}
                className={`stack-card ${item.controller === you ? 'mine' : 'theirs'}`}
                onClick={() => clickStackItem(view.stack.length - 1 - i)}
                style={targeting ? { cursor: 'crosshair' } : undefined}
                title={item.description}
              >
                <CardFace def={item.card} name={item.cardName} badge={i === 0 ? 'próxima' : undefined} title={item.description} />
                <div className="stack-desc">
                  {item.kind === 'copy' ? '⧉ cópia — ' : item.kind === 'ability' ? '⚙ ' : ''}
                  {item.description}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* -------- pop-ups de zona (carta foi para cemitério/exílio) -------- */}
      {zoneToasts.length > 0 && (
        <div className="zone-toasts">
          {zoneToasts.map((t) => (
            <div
              key={t.key}
              className="zone-toast"
              title="Clique para abrir a zona"
              onClick={(e) => { e.stopPropagation(); setZonePick({ player: t.player, zone: t.zone }); }}
            >
              <CardFace def={t.card.card} />
              <div className="zone-toast-label">
                <strong>{t.card.card.name}</strong>
                <span>{t.label} de {view.players[t.player].name}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* -------- paradas automáticas -------- */}
      {showStops && (
        <div className="context-menu stops-panel" style={{ right: 12, top: 60 }} onClick={(e) => e.stopPropagation()}>
          <div className="panel-title" style={{ padding: '4px 10px' }}>Parar automaticamente em:</div>
          <div className="stops-grid">
            <span />
            <span className="muted">meu turno</span>
            <span className="muted">oponente</span>
            {STOPPABLE.map((s) => (
              <StopRow key={s} step={s} stops={stops} onChange={saveStops} />
            ))}
          </div>
          <button onClick={() => saveStops(DEFAULT_STOPS)}>Restaurar padrão</button>
        </div>
      )}

      {/* -------- menu de ações da carta (conjurar / reciclar / habilidades) -------- */}
      {actionMenu && (
        <div className="context-menu" style={{ left: actionMenu.x, top: actionMenu.y }} onClick={(e) => e.stopPropagation()}>
          <div className="panel-title" style={{ padding: '4px 10px' }}>{actionMenu.title}</div>
          {actionMenu.options.map((opt, i) => (
            <button key={i} onClick={() => { setActionMenu(null); opt.run(); }}>
              {opt.label}
            </button>
          ))}
          <button className="danger" onClick={() => setActionMenu(null)}>Cancelar</button>
        </div>
      )}

      {/* -------- escolha da cor de mana ("any color") -------- */}
      {colorPick && (
        <div className="mulligan-overlay" onClick={() => setColorPick(null)}>
          <div className="mulligan-box" onClick={(e) => e.stopPropagation()}>
            <h2>{colorPick.name}</h2>
            <div className="muted">Escolha a cor da mana:</div>
            <div className="row" style={{ justifyContent: 'center' }}>
              {colorPick.colors.map((c) => (
                <button
                  key={c}
                  className="color-pick-btn"
                  style={{ background: MANA_COLORS[c] }}
                  title={`{${c}}`}
                  onClick={() => {
                    const pick = colorPick;
                    setColorPick(null);
                    onAction({
                      type: 'activateAbility',
                      objectId: pick.objectId,
                      abilityIndex: pick.abilityIndex,
                      manaColor: c as 'W' | 'U' | 'B' | 'R' | 'G' | 'C',
                    });
                  }}
                >
                  {c}
                </button>
              ))}
            </div>
            <button className="danger" onClick={() => setColorPick(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {/* -------- escolha de modo de gatilho ("ao entrar, escolha um") -------- */}
      {view.pendingDecision?.type === 'chooseMode' && view.pendingDecision.player === you && (
        <div className="mulligan-overlay">
          <div className="mulligan-box">
            <h2>{view.pendingDecision.cardName}</h2>
            <div className="muted">Escolha um modo:</div>
            {view.pendingDecision.modes.map((label, i) => (
              <button key={i} onClick={() => onAction({ type: 'chooseMode', mode: i })}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* -------- sim/não (Mana Leak: pagar ou deixar anular) -------- */}
      {myChoice && myChoice.mode === 'confirm' && (
        <div className="mulligan-overlay">
          <div className="mulligan-box">
            <h2>Decisão</h2>
            <div className="muted">{myChoice.prompt}</div>
            <div className="row">
              <button className="primary" onClick={() => onAction({ type: 'effectChoice', picks: [], text: 'yes' })}>
                Sim
              </button>
              <button onClick={() => onAction({ type: 'effectChoice', picks: [], text: 'no' })}>
                Não
              </button>
            </div>
          </div>
        </div>
      )}

      {/* -------- escolher cor ("as enters, choose a color") -------- */}
      {myChoice && myChoice.mode === 'chooseColor' && (
        <div className="mulligan-overlay">
          <div className="mulligan-box">
            <h2>Escolha uma cor</h2>
            <div className="muted">{myChoice.prompt}</div>
            <div className="row" style={{ justifyContent: 'center' }}>
              {['W', 'U', 'B', 'R', 'G'].map((c) => (
                <button key={c} className="color-pick-btn" style={{ background: MANA_COLORS[c] }} onClick={() => onAction({ type: 'effectChoice', picks: [], text: c })}>
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* -------- escolher tipo de criatura -------- */}
      {myChoice && myChoice.mode === 'chooseType' && (
        <div className="mulligan-overlay">
          <div className="mulligan-box">
            <h2>Escolha um tipo de criatura</h2>
            <div className="muted">{myChoice.prompt}</div>
            <input
              autoFocus
              placeholder="ex.: Goblin"
              value={nameText}
              onChange={(e) => setNameText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && nameText.trim()) {
                  onAction({ type: 'effectChoice', picks: [], text: nameText.trim() });
                  setNameText('');
                }
              }}
              style={{ width: 'min(300px, 80vw)' }}
            />
            <button className="primary" disabled={!nameText.trim()} onClick={() => { onAction({ type: 'effectChoice', picks: [], text: nameText.trim() }); setNameText(''); }}>
              Confirmar
            </button>
          </div>
        </div>
      )}

      {/* -------- nomear uma carta (Cabal Therapy) -------- */}
      {myChoice && myChoice.mode === 'nameCard' && (
        <div className="mulligan-overlay">
          <div className="mulligan-box">
            <h2>Nomear carta</h2>
            <div className="muted">{myChoice.prompt}</div>
            <input
              autoFocus
              placeholder="ex.: Lightning Bolt"
              value={nameText}
              onChange={(e) => setNameText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && nameText.trim()) {
                  onAction({ type: 'effectChoice', picks: [], text: nameText.trim() });
                  setNameText('');
                }
              }}
              style={{ width: 'min(360px, 80vw)' }}
            />
            <button
              className="primary"
              disabled={!nameText.trim()}
              onClick={() => {
                onAction({ type: 'effectChoice', picks: [], text: nameText.trim() });
                setNameText('');
              }}
            >
              Confirmar
            </button>
          </div>
        </div>
      )}

      {/* -------- menu de contexto (modo manual) -------- */}
      {menu && (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <div className="panel-title" style={{ padding: '4px 10px' }}>{menu.card.card.name} (manual)</div>
          {menu.card.card.cycling && (me.hand ?? []).some((c) => c.objectId === menu.card.objectId) && (
            <MenuItem
              label={`♻ Reciclar (${menu.card.card.cycling.mana ?? ''}${menu.card.card.cycling.life ? `${menu.card.card.cycling.life} vidas` : ''})`}
              onPick={() => onAction({ type: 'cycle', objectId: menu.card.objectId })}
            />
          )}
          <MenuItem label="→ campo de batalha" onPick={() => moveTo(menu.card, 'battlefield')} />
          <MenuItem label="→ cemitério" onPick={() => moveTo(menu.card, 'graveyard')} />
          <MenuItem label="→ exílio" onPick={() => moveTo(menu.card, 'exile')} />
          <MenuItem label="→ mão" onPick={() => moveTo(menu.card, 'hand')} />
          <MenuItem label="→ topo da biblioteca" onPick={() => moveTo(menu.card, 'library', 'top')} />
          <MenuItem label="→ fundo da biblioteca" onPick={() => moveTo(menu.card, 'library', 'bottom')} />
          <MenuItem label={menu.card.tapped ? 'desvirar' : 'virar'} onPick={() => onAction({ type: 'manualTap', objectId: menu.card.objectId, tapped: !menu.card.tapped })} />
          <MenuItem label="+1/+1" onPick={() => onAction({ type: 'manualCounter', objectId: menu.card.objectId, counter: '+1/+1', delta: 1 })} />
          <MenuItem label="-1 marcador +1/+1" onPick={() => onAction({ type: 'manualCounter', objectId: menu.card.objectId, counter: '+1/+1', delta: -1 })} />
        </div>
      )}

      {/* -------- mulligan -------- */}
      {view.mulligan && view.status === 'playing' && (
        <div className="mulligan-overlay">
          <div className="mulligan-box">
            <h2>Mão inicial{mullTaken > 0 ? ` — mulligan ${mullTaken}` : ''}</h2>
            <div className="mulligan-hand">
              {(me.hand ?? []).map((c) => (
                <CardTile
                  key={c.objectId}
                  card={c}
                  size="hand"
                  selected={bottomSel.has(c.objectId)}
                  onClick={(e) => { e.stopPropagation(); clickHandCard(c, e); }}
                />
              ))}
            </div>
            {myMulligan ? (
              <>
                {mullTaken > 0 && (
                  <div className="muted">
                    Para manter, escolha {mullTaken} carta(s) para o fundo da biblioteca ({bottomSel.size}/{mullTaken}).
                  </div>
                )}
                <div className="row">
                  <button
                    className="primary"
                    disabled={bottomSel.size !== mullTaken}
                    onClick={() => onAction({ type: 'keepHand', bottom: [...bottomSel] })}
                  >
                    Manter mão
                  </button>
                  <button disabled={mullTaken >= 7} onClick={() => onAction({ type: 'mulligan' })}>
                    Mulligan (comprar 7 de novo)
                  </button>
                </div>
              </>
            ) : (
              <div className="muted">Mão mantida. Aguardando o oponente…</div>
            )}
            <div className="muted">
              Oponente: {view.mulligan.phase[oppId] === 'kept' ? 'manteve' : `decidindo (mulligan ${view.mulligan.taken[oppId]})`}
            </div>
          </div>
        </div>
      )}

      {/* -------- escolha de efeito (descarte, sacrifício, vidência, busca) -------- */}
      {myChoice && (myChoice.mode === 'cards' || myChoice.mode === 'scry') && myChoice.options && (
        <div className="mulligan-overlay">
          <div className="mulligan-box">
            <h2>{myChoice.mode === 'scry' ? 'Vidência' : 'Escolha'}</h2>
            <div className="muted">{myChoice.prompt}</div>
            <div className="mulligan-hand choice-hand">
              {myChoice.options.map((c) => (
                <CardTile
                  key={c.objectId}
                  card={c}
                  size="hand"
                  selected={choiceSel.has(c.objectId)}
                  onClick={(e) => {
                    e.stopPropagation();
                    const next = new Set(choiceSel);
                    if (next.has(c.objectId)) next.delete(c.objectId);
                    else if (next.size < myChoice.max) next.add(c.objectId);
                    setChoiceSel(next);
                  }}
                />
              ))}
            </div>
            {myChoice.mode === 'scry' && (
              <div className="muted">Selecionadas vão para o fundo; as demais continuam no topo, na mesma ordem.</div>
            )}
            <button
              className="primary"
              disabled={choiceSel.size < myChoice.min || choiceSel.size > myChoice.max}
              onClick={() => onAction({ type: 'effectChoice', picks: [...choiceSel] })}
            >
              Confirmar ({choiceSel.size}
              {myChoice.min === myChoice.max ? `/${myChoice.max}` : ` de até ${myChoice.max}`})
            </button>
          </div>
        </div>
      )}

      {/* -------- escolha de modo (mágicas modais) -------- */}
      {modalPick && (
        <div className="mulligan-overlay" onClick={() => { setModalPick(null); setModalSel(new Set()); }}>
          <div className="mulligan-box" onClick={(e) => e.stopPropagation()}>
            <h2>{modalPick.card.name}</h2>
            {modalPick.card.spellModeChoice ? (
              <>
                <div className="muted">
                  Escolha {modalPick.card.spellModeChoice.min === modalPick.card.spellModeChoice.max ? modalPick.card.spellModeChoice.min : `de ${modalPick.card.spellModeChoice.min} a ${Math.min(modalPick.card.spellModeChoice.max, modalPick.card.spellModes?.length ?? 0)}`} modo(s):
                </div>
                {(modalPick.card.spellModes ?? []).map((m, i) => (
                  <button
                    key={i}
                    className={modalSel.has(i) ? 'primary' : ''}
                    onClick={() => {
                      const next = new Set(modalSel);
                      if (next.has(i)) next.delete(i);
                      else if (next.size < (modalPick.card.spellModeChoice?.max ?? 1)) next.add(i);
                      setModalSel(next);
                    }}
                  >
                    {modalSel.has(i) ? '☑ ' : '☐ '}{m.label}
                  </button>
                ))}
                <button
                  className="primary"
                  disabled={modalSel.size < modalPick.card.spellModeChoice.min}
                  onClick={() => {
                    const cv = modalPick;
                    const modes = [...modalSel].sort((a, b) => a - b);
                    setModalPick(null);
                    setModalSel(new Set());
                    beginCast(cv, undefined, false, { modes });
                  }}
                >
                  Conjurar com {modalSel.size} modo(s)
                </button>
              </>
            ) : (
              <>
                <div className="muted">Escolha um modo:</div>
                {(modalPick.card.spellModes ?? []).map((m, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      const cv = modalPick;
                      setModalPick(null);
                      beginCast(cv, i);
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </>
            )}
            <button className="danger" onClick={() => { setModalPick(null); setModalSel(new Set()); }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* -------- habilidades de lealdade -------- */}
      {loyaltyPick && (
        <div className="mulligan-overlay" onClick={() => setLoyaltyPick(null)}>
          <div className="mulligan-box" onClick={(e) => e.stopPropagation()}>
            <h2>{loyaltyPick.card.name}</h2>
            <div className="muted">Lealdade: {loyaltyPick.counters['loyalty'] ?? 0}</div>
            {(loyaltyPick.card.abilities ?? []).map((a, i) =>
              a.kind === 'loyalty' ? (
                <button
                  key={i}
                  onClick={() => {
                    const cv = loyaltyPick;
                    setLoyaltyPick(null);
                    beginAbility(cv, i, a);
                  }}
                >
                  {a.text}
                </button>
              ) : null,
            )}
            <button className="danger" onClick={() => setLoyaltyPick(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {/* -------- cemitério/exílio (estilo MTGO; flashback no próprio) -------- */}
      {zonePick && (
        <div className="mulligan-overlay" onClick={() => setZonePick(null)}>
          <div className="mulligan-box" onClick={(e) => e.stopPropagation()}>
            <h2>
              {zonePick.zone === 'graveyard' ? 'Cemitério' : 'Exílio'} de {view.players[zonePick.player].name}
            </h2>
            <div className="mulligan-hand choice-hand">
              {view.players[zonePick.player][zonePick.zone].length === 0 && <div className="muted">vazio</div>}
              {view.players[zonePick.player][zonePick.zone].map((c) => (
                <div key={c.objectId} style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                  <CardTile card={c} size="hand" onContextMenu={(e) => openMenu(e, c)} />
                  {zonePick.zone === 'graveyard' && zonePick.player === you && c.card.flashback && (
                    <button
                      onClick={() => {
                        setZonePick(null);
                        beginCast(c, undefined, true);
                      }}
                    >
                      ⚡ Flashback {c.card.flashback.cost ?? (c.card.flashback.sacrifice ? `(sacrifique ${c.card.flashback.sacrifice.what === 'creature' ? 'uma criatura' : 'uma permanente'})` : '')}
                    </button>
                  )}
                  {zonePick.zone === 'graveyard' && zonePick.player === you && c.card.castMethods?.some((m) => m.kind === 'escape') && (
                    <button onClick={() => { setZonePick(null); beginEscape(c); }}>
                      ⚡ {c.card.castMethods.find((m) => m.kind === 'escape')?.label}
                    </button>
                  )}
                  {zonePick.zone === 'graveyard' && zonePick.player === you &&
                    (c.card.castMethods ?? []).filter((m) => m.kind === 'mayhem' || m.kind === 'retrace' || m.kind === 'disturb').map((m) => (
                      <button key={m.kind} onClick={() => { setZonePick(null); beginCast(c, undefined, false, { method: m.kind }); }}>
                        ⚡ {m.label}
                      </button>
                    ))}
                  {zonePick.zone === 'graveyard' && zonePick.player === you && c.card.backFace?.aftermath && myPriority && (
                    <button onClick={() => { setZonePick(null); beginCast(c, undefined, false, { face: 'back' }); }}>
                      ⚡ Aftermath — conjurar {c.card.backFace.name} {c.card.backFace.manaCost ?? ''} (do cemitério)
                    </button>
                  )}
                  {zonePick.zone === 'graveyard' && zonePick.player === you &&
                    (c.card.abilities ?? []).map((a, i) =>
                      a.kind === 'activated' && a.zone === 'graveyard' ? (
                        <button key={i} onClick={() => { setZonePick(null); beginAbility(c, i, a); }}>
                          ⚙ {a.text}
                        </button>
                      ) : null,
                    )}
                  {zonePick.zone === 'exile' && zonePick.player === you && c.playableNow && myPriority && (
                    c.card.types.includes('Land') ? (
                      <button onClick={() => { setZonePick(null); onAction({ type: 'playLand', objectId: c.objectId }); }}>⛰ Jogar terreno (do exílio, este turno)</button>
                    ) : (
                      <button onClick={() => { setZonePick(null); beginCast(c, undefined, false); }}>✨ Conjurar {c.card.manaCost ?? ''} (do exílio, este turno)</button>
                    )
                  )}
                  {zonePick.zone === 'exile' && zonePick.player === you && c.exiledAs === 'adventure' && myPriority && (
                    <button onClick={() => { setZonePick(null); beginCast(c, undefined, false); }}>✨ Conjurar {c.card.name} {c.card.manaCost ?? ''} (de volta da aventura)</button>
                  )}
                  {zonePick.zone === 'exile' && zonePick.player === you && c.exiledAs && (c.exiledAs === 'foretold' || c.exiledAs === 'plotted' || c.exiledAs === 'warped') && (
                    <button onClick={() => { setZonePick(null); beginCast(c, undefined, false, { method: c.exiledAs as CastMethodKind }); }}>
                      ⚡ Conjurar ({c.exiledAs === 'foretold' ? `prever ${c.card.castMethods?.find((m) => m.kind === 'foretold')?.cost ?? ''}` : c.exiledAs === 'plotted' ? 'tramada, de graça' : 'warp, de graça'})
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button onClick={() => setZonePick(null)}>Fechar</button>
          </div>
        </div>
      )}

      {/* -------- roll inicial / escolha de quem começa -------- */}
      {view.starter && !view.starter.chosen && (
        <div className="mulligan-overlay">
          <div className="mulligan-box">
            <h2>Quem começa?</h2>
            {view.starter.rolls[you] > 0 ? (
              <>
                <div className="roll-row">
                  <div className={`roll-die ${view.starter.winner === you ? 'winner' : ''}`}>
                    <div className="muted">Você</div>
                    <strong>{view.starter.rolls[you]}</strong>
                  </div>
                  <div className={`roll-die ${view.starter.winner === oppId ? 'winner' : ''}`}>
                    <div className="muted">{opp.name}</div>
                    <strong>{view.starter.rolls[oppId]}</strong>
                  </div>
                </div>
                {view.starter.rerolls > 0 && (
                  <div className="muted">({view.starter.rerolls} empate(s) rerolado(s) automaticamente)</div>
                )}
              </>
            ) : (
              <div className="muted">Quem perdeu o jogo anterior decide quem começa.</div>
            )}
            {view.starter.winner === you ? (
              <div className="row">
                <button className="primary" onClick={() => onAction({ type: 'chooseStarter', first: you })}>
                  Eu começo
                </button>
                <button onClick={() => onAction({ type: 'chooseStarter', first: oppId })}>
                  {opp.name} começa
                </button>
              </div>
            ) : (
              <div className="muted">Aguardando {opp.name} decidir…</div>
            )}
          </div>
        </div>
      )}

      <HoverPreview />

      {view.status === 'finished' && (
        <div className="game-over-overlay">
          <div>
            {view.winner === 'draw'
              ? 'Empate!'
              : view.winner === you
                ? '🏆 Você venceu este jogo!'
                : `${opp.name} venceu este jogo.`}
          </div>
          {match && (
            <div style={{ fontSize: 18 }}>
              Placar: você {match.wins[you]} × {match.wins[oppId]} {opp.name}
            </div>
          )}
          {(!match || match.wins[you] >= 2 || match.wins[oppId] >= 2) && (
            <button className="primary" onClick={onExit}>Voltar ao início</button>
          )}
          {match && match.wins[you] < 2 && match.wins[oppId] < 2 && (
            <div className="muted">Preparando o sideboard…</div>
          )}
        </div>
      )}
    </div>
  );

  function moveTo(card: CardView, to: 'battlefield' | 'graveyard' | 'exile' | 'hand' | 'library', position?: 'top' | 'bottom') {
    onAction({ type: 'manualMove', objectId: card.objectId, to, position });
    setMenu(null);
  }

  function MenuItem({ label, onPick }: { label: string; onPick: () => void }) {
    return <button onClick={() => { onPick(); setMenu(null); }}>{label}</button>;
  }
}

function StopRow({ step, stops, onChange }: { step: Step; stops: StopsConfig; onChange: (s: StopsConfig) => void }) {
  const toggle = (side: 'myTurn' | 'oppTurn') => {
    const list = stops[side];
    const next = list.includes(step) ? list.filter((s) => s !== step) : [...list, step];
    onChange({ ...stops, [side]: next });
  };
  return (
    <>
      <span className="stops-label">{STEP_SHORT[step]}</span>
      <input type="checkbox" checked={stops.myTurn.includes(step)} onChange={() => toggle('myTurn')} />
      <input type="checkbox" checked={stops.oppTurn.includes(step)} onChange={() => toggle('oppTurn')} />
    </>
  );
}

const MANA_COLORS: Record<string, string> = { W: '#e8e2d0', U: '#5b9bd5', B: '#9b8fb0', R: '#d5745b', G: '#6bbf7e', C: '#b0b0b0' };

function ManaChips({ pool }: { pool: Record<string, number> }) {
  const COLORS = MANA_COLORS;
  const chips = Object.entries(pool).filter(([, n]) => n > 0);
  if (chips.length === 0) return null;
  return (
    <div className="mana-pool" title="Mana flutuante">
      {chips.map(([sym, n]) => (
        <span key={sym} className="mana-chip" style={{ background: COLORS[sym] }}>{n}</span>
      ))}
    </div>
  );
}

function shouldAutoPass(view: GameView, stops: StopsConfig, yielding: boolean): boolean {
  if (view.status !== 'playing') return false;
  if (view.mulligan) return false;
  if (view.priority !== view.you) return false;
  if (view.pendingDecision) return false;
  if (view.combatAwaiting) return false;
  if (view.stack.length > 0) {
    // Yield ativo passa sobre tudo; senão só sobre a própria mágica (Arena).
    return yielding || view.stack[view.stack.length - 1].controller === view.you;
  }
  if (yielding) return true;
  const myTurn = view.activePlayer === view.you;
  const stopList = myTurn ? stops.myTurn : stops.oppTurn;
  return !stopList.includes(view.step);
}
