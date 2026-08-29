import { useEffect, useMemo, useRef, useState } from 'react';
import type { CardView, GameView, PlayerAction, PlayerId } from '@slopmtg/protocol';
import type { Step, TargetChoice } from '@slopmtg/engine';
import { CardTile } from './CardTile';
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

const DEFAULT_STOPS: StopsConfig = { myTurn: ['main1', 'main2'], oppTurn: ['end'] };

function loadStops(): StopsConfig {
  try {
    const raw = localStorage.getItem('slopmtg-stops');
    if (!raw) return DEFAULT_STOPS;
    const parsed = JSON.parse(raw) as StopsConfig;
    return { myTurn: parsed.myTurn ?? DEFAULT_STOPS.myTurn, oppTurn: parsed.oppTurn ?? DEFAULT_STOPS.oppTurn };
  } catch {
    return DEFAULT_STOPS;
  }
}

interface Targeting {
  kind: 'spell' | 'ability' | 'trigger';
  objectId: number;
  abilityIndex?: number;
  specs: { what: string }[];
  chosen: TargetChoice[];
  label: string;
  /** Extras carried into the cast action (X spells, modal spells). */
  x?: number;
  mode?: number;
  /** First N picks are sacrifices for an additional cost (Fling). */
  sacCount?: number;
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
  onAction: (action: PlayerAction) => void;
  onExit: () => void;
}

export function GameBoard({ view, syncSeq, log, onAction, onExit }: GameBoardProps) {
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
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [showStops, setShowStops] = useState(false);
  const [stops, setStops] = useState<StopsConfig>(loadStops);
  const [chatText, setChatText] = useState('');
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
      localStorage.setItem('slopmtg-stops', JSON.stringify(next));
    } catch {
      // localStorage indisponível: config só vale para a sessão
    }
  };

  // ---------------------------------------------------------- auto-yield
  useEffect(() => {
    if (!shouldAutoPass(view, stops)) return;
    const t = setTimeout(() => onAction({ type: 'passPriority' }), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncSeq, stops]);

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
      } else if (t.kind === 'spell') {
        const sacCount = t.sacCount ?? 0;
        const sacrifices = t.chosen
          .slice(0, sacCount)
          .flatMap((c) => (c.kind === 'object' ? [c.id] : []));
        onAction({
          type: 'castSpell',
          objectId: t.objectId,
          targets: t.chosen.slice(sacCount),
          x: t.x,
          mode: t.mode,
          sacrifices: sacCount > 0 ? sacrifices : undefined,
        });
      } else {
        onAction({ type: 'activateAbility', objectId: t.objectId, abilityIndex: t.abilityIndex ?? 0, targets: t.chosen });
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

  const clickHandCard = (cv: CardView) => {
    setMenu(null);
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
    if (targeting) return;
    if (!myPriority) return;
    const def = cv.card;
    if (def.types.includes('Land')) {
      onAction({ type: 'playLand', objectId: cv.objectId });
      return;
    }
    if (def.automation === 'manual') return; // menu de contexto cuida
    if (def.spellModes && def.spellModes.length > 0) {
      setModalPick(cv);
      return;
    }
    beginCast(cv, undefined);
  };

  /** Start casting: asks for X if needed, then sacrifices/targets, then sends. */
  const beginCast = (cv: CardView, mode: number | undefined) => {
    const def = cv.card;
    let x: number | undefined;
    if (def.manaCost && def.manaCost.includes('{X}')) {
      const raw = prompt(`${def.name}: escolha o valor de X`, '1');
      if (raw === null) return;
      x = parseInt(raw, 10);
      if (!Number.isInteger(x) || x < 0) return;
    }
    // Custo adicional de sacrifício (Fling): escolhido como os primeiros "alvos".
    const sacCount = def.additionalCost ? def.additionalCost.count ?? 1 : 0;
    const sacSpecs = Array.from({ length: sacCount }, () => ({
      what: def.additionalCost?.sacrifice.what ?? 'permanent',
    }));
    const targetSpecs = mode !== undefined
      ? def.spellModes?.[mode]?.targets ?? []
      : def.enchant
        ? [{ what: def.enchant.what }]
        : def.spellTargets ?? [];
    const specs = [...sacSpecs, ...targetSpecs];
    if (specs.length === 0) {
      onAction({ type: 'castSpell', objectId: cv.objectId, x, mode });
    } else {
      const base = mode !== undefined ? `${def.name} — ${def.spellModes?.[mode]?.label}` : def.name;
      const label = sacCount > 0 ? `${base} (escolha o sacrifício primeiro)` : base;
      setTargeting({ kind: 'spell', objectId: cv.objectId, specs, chosen: [], label, x, mode, sacCount });
    }
  };

  const clickFieldCard = (cv: CardView, owner: PlayerId) => {
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
      const abilities = cv.card.abilities ?? [];
      const idx = abilities.findIndex((a) => a.kind === 'activated');
      if (idx >= 0) {
        const ability = abilities[idx];
        if (ability.kind !== 'activated') return;
        const specs = ability.targets ?? [];
        if (specs.length === 0) {
          onAction({ type: 'activateAbility', objectId: cv.objectId, abilityIndex: idx });
        } else {
          setTargeting({
            kind: 'ability',
            objectId: cv.objectId,
            abilityIndex: idx,
            specs,
            chosen: [],
            label: `${cv.card.name}: ${ability.text}`,
          });
        }
      }
    }
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

  const confirmAttack = () => onAction({ type: 'declareAttackers', attackers: [...attackSel] });
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
    if (targeting) return `${targeting.label}: escolha o alvo (${targeting.chosen.length + 1}/${targeting.specs.length}) — Esc cancela`;
    if (myChoice) return myChoice.prompt;
    if (effectChoice) return 'Aguardando a escolha do oponente…';
    if (triggerTargets && triggerTargets.player !== you) return 'Aguardando o oponente escolher alvos…';
    if (myDiscard) return `Descarte ${discardCount} carta(s): selecione na mão e confirme`;
    if (awaitingMyAttack) return 'Escolha seus atacantes e confirme';
    if (awaitingMyBlocks) return 'Clique num bloqueador seu, depois no atacante; confirme';
    if (view.combatAwaiting) return 'Aguardando o oponente…';
    if (myPriority && view.stack.length > 0) return 'Responder à pilha ou resolver';
    if (myPriority && (view.step === 'main1' || view.step === 'main2') && view.activePlayer === you)
      return 'Sua fase principal — jogue cartas ou passe';
    if (myPriority) return 'Você tem a prioridade';
    return 'Aguardando o oponente…';
  })();

  return (
    <div className="table" onClick={() => { setMenu(null); setShowStops(false); }}>
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
        {view.activePlayer === oppId && <span className="zone-pill">turno dele</span>}
        <span className="zone-pill">✋ {opp.handSize}</span>
        <span className="zone-pill" title={opp.graveyard.map((c) => c.card.name).join('\n') || 'cemitério vazio'}>
          🪦 {opp.graveyard.length}
        </span>
        <span className="zone-pill">📚 {opp.librarySize}</span>
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
              onClick={(e) => { e.stopPropagation(); clickFieldCard(c, controllerOf(c.objectId)); }}
            />
          ))}
        </div>
        <div className="field-row">
          {rowCards(opp.battlefield, true).map(({ card: c, attachment }) => (
            <CardTile key={c.objectId} card={c} attachment={attachment} targetable={isTargetableCard(c)}
              onClick={(e) => { e.stopPropagation(); clickFieldCard(c, controllerOf(c.objectId)); }} />
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
              onClick={(e) => { e.stopPropagation(); clickFieldCard(c, controllerOf(c.objectId)); }}
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
              onClick={(e) => { e.stopPropagation(); clickFieldCard(c, controllerOf(c.objectId)); }}
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
        <span className="zone-pill" title={me.graveyard.map((c) => c.card.name).join('\n') || 'cemitério vazio'}>
          🪦 {me.graveyard.length}
        </span>
        <span className="zone-pill">📚 {me.librarySize}</span>
        <ManaChips pool={me.manaPool} />
        <div className="hand-row">
          {(me.hand ?? []).map((c) => (
            <CardTile
              key={c.objectId}
              card={c}
              size="hand"
              selected={discardSel.has(c.objectId) || bottomSel.has(c.objectId)}
              dimmed={myDiscard && !discardSel.has(c.objectId) && discardSel.size >= discardCount}
              onClick={(e) => { e.stopPropagation(); clickHandCard(c); }}
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
          <span className="panel-title">Turno {view.turn} · {stepName(view.step)}</span>
          <button className="danger" onClick={() => { if (confirm('Conceder a partida?')) onAction({ type: 'concede' }); }}>
            Conceder
          </button>
        </div>
        {view.stack.length > 0 && (
          <div className="stack-panel">
            <div className="panel-title">Pilha (resolve de baixo para cima)</div>
            {[...view.stack].reverse().map((item, i) => (
              <div
                key={item.id}
                className={`stack-item ${item.controller === you ? 'mine' : ''}`}
                onClick={() => clickStackItem(view.stack.length - 1 - i)}
                style={targeting ? { cursor: 'crosshair' } : undefined}
              >
                {item.description}
                {i === 0 ? ' ← próxima' : ''}
              </div>
            ))}
          </div>
        )}
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

      {/* -------- menu de contexto (modo manual) -------- */}
      {menu && (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <div className="panel-title" style={{ padding: '4px 10px' }}>{menu.card.card.name} (manual)</div>
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
                  onClick={(e) => { e.stopPropagation(); clickHandCard(c); }}
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
      {myChoice && myChoice.options && (
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
        <div className="mulligan-overlay" onClick={() => setModalPick(null)}>
          <div className="mulligan-box" onClick={(e) => e.stopPropagation()}>
            <h2>{modalPick.card.name}</h2>
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
            <button className="danger" onClick={() => setModalPick(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {view.status === 'finished' && (
        <div className="game-over-overlay">
          <div>
            {view.winner === 'draw'
              ? 'Empate!'
              : view.winner === you
                ? '🏆 Você venceu!'
                : `${opp.name} venceu.`}
          </div>
          <button className="primary" onClick={onExit}>Voltar ao início</button>
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

function ManaChips({ pool }: { pool: Record<string, number> }) {
  const COLORS: Record<string, string> = { W: '#e8e2d0', U: '#5b9bd5', B: '#9b8fb0', R: '#d5745b', G: '#6bbf7e', C: '#b0b0b0' };
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

function shouldAutoPass(view: GameView, stops: StopsConfig): boolean {
  if (view.status !== 'playing') return false;
  if (view.mulligan) return false;
  if (view.priority !== view.you) return false;
  if (view.pendingDecision) return false;
  if (view.combatAwaiting) return false;
  if (view.stack.length > 0) {
    // Auto-passa apenas sobre a própria mágica (estilo Arena).
    return view.stack[view.stack.length - 1].controller === view.you;
  }
  const myTurn = view.activePlayer === view.you;
  const stopList = myTurn ? stops.myTurn : stops.oppTurn;
  return !stopList.includes(view.step);
}
