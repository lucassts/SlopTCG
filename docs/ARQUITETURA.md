# SlopTCG — Arquitetura

> Webapp open source para jogar card games no navegador, instalável como PWA.
> Primeiro jogo: Magic: The Gathering. A engine é genérica o bastante para a
> comunidade portar outros jogos (Pokémon TCG, Yu-Gi-Oh!, etc.).

## Princípios

1. **Roda em qualquer coisa.** Navegador puro, sem plugin, sem instalador. "Instalar" = PWA (atalho + offline shell).
2. **Servidor autoritativo, cliente burro.** Toda regra roda na engine; o cliente só envia intenções (`PlayerAction`) e renderiza eventos (`GameEvent`). Impossível trapacear editando o cliente.
3. **Automação progressiva (a decisão mais importante).** Nenhuma carta "não funciona":
   - **Tier 1 — DSL declarativa**: a maioria das cartas descrita como dados (gatilho + passos de efeito). Comunidade contribui sem saber programar a engine.
   - **Tier 2 — script TS**: cartas complexas ganham função TypeScript registrada por `oracle_id`.
   - **Tier 3 — modo manual**: carta sem implementação ainda é jogável estilo Cockatrice/Untap.in (mover, virar, marcar). A engine loga tudo; os jogadores adjudicam. É o que permite lançar com 100% das cartas "jogáveis" desde o dia 1 e automatizar por demanda.
4. **Tudo é evento.** O estado só muda via eventos (`CardDrawn`, `ZoneChanged`, `DamageDealt`...). O log da partida é o fluxo de eventos renderizado em linguagem humana — requisito do projeto: "ser bem claro o que está ocorrendo".
5. **Determinismo.** RNG com seed (embaralhamento), reducer puro. Mesmo seed + mesmas ações = mesma partida. Habilita replay, reconexão e testes.
6. **Zero dado da Wizards no repositório.** Texto, custo e imagem de carta vêm do [Scryfall](https://scryfall.com/docs/api) em runtime (bulk data ou API), sob a Fan Content Policy. O repo versiona apenas *implementações de mecânica* (a DSL/scripts), como XMage e Forge fazem há anos.

## Monorepo

```
packages/engine     Regras do jogo. TypeScript puro, zero dependências, roda em Node e no browser.
packages/protocol   Tipos de mensagem cliente↔servidor (compartilhado).
packages/server     Node + ws. Salas por código, engine autoritativa, redação de estado.
apps/web            Vite + React + PWA. Lobby, deck builder, mesa de jogo.
```

## Engine (`packages/engine`)

### Modelo de dados

- `GameState`: jogadores (vida, mana pool, contadores), zonas por jogador
  (`library`, `hand`, `battlefield`, `graveyard`, `exile`) + `stack` global,
  estrutura de turno (fase/etapa), jogador ativo, prioridade.
- `GameObject`: instância de carta em jogo — `instanceId`, definição, dono,
  controlador, virada, dano marcado, contadores, modificações até fim do turno.
- `CardDefinition`: identidade (nome, custo, tipos, P/T) + automação
  (`spellEffect`, `abilities[]`, keywords) + `automation: 'full' | 'manual'`.

### Loop de jogo

Máquina de estados fiel ao MTG: `untap → upkeep → draw → main1 → combate
(begin/attackers/blockers/damage/end) → main2 → end → cleanup`. Prioridade
alterna entre jogadores; pilha LIFO; ações baseadas em estado (SBA) checadas
a cada resolução: dano letal, resistência ≤ 0, vida ≤ 0, comprar de biblioteca
vazia. O cliente implementa auto-yield (estilo Arena): passa prioridade
automaticamente em etapas sem decisão.

### DSL de efeitos (Tier 1)

```ts
// Lightning Bolt
{ targets: [{ what: 'any', count: 1 }],
  effect: [{ op: 'damage', target: 'target:0', amount: 3 }] }

// "Quando entra no campo de batalha, compre uma carta."
{ kind: 'triggered', trigger: { on: 'etb', self: true },
  effect: [{ op: 'draw', who: 'controller', count: 1 }] }
```

Primitivas do MVP: `draw · damage · gainLife · loseLife · destroy · exile ·
tap · untap · pump · counterSpell · discard · mill · returnToHand · token ·
addMana · sacrifice`. Cada primitiva emite eventos; nunca muta estado direto.

### API

```ts
const game = new Game(config);           // decks, seed, jogadores
const result = game.apply(playerId, action);  // valida → executa → GameEvent[]
game.viewFor(playerId);                  // estado redigido (mão do oponente oculta)
```

## Servidor (`packages/server`)

- WebSocket puro (`ws`). Sala = código de 5 letras. Host cria, convidado entra.
- Servidor instancia a `Game`, valida cada ação, faz broadcast de
  `{ events, view }` redigido por jogador.
- Reconexão: cliente guarda token da sala; ao reconectar recebe o view atual.
- Futuro: lobby público, matchmaking, espectador, servidores federados
  (qualquer um roda o seu — é um binário Node).

## Web (`apps/web`)

- React + Vite + `vite-plugin-pwa` (manifest + service worker → instalável).
- Telas: **Home** (criar/entrar em sala) · **Deck** (colar decklist, resolve
  via Scryfall com cache em IndexedDB) · **Mesa** (campo, mão, pilha, log,
  barra de fases, botões de prioridade).
- Imagens de carta: URIs do Scryfall, carregadas sob demanda, cacheadas pelo
  service worker.

## Dados de carta

1. `scripts/fetch-cards.mjs` baixa o bulk `oracle-cards` do Scryfall (~150 MB,
   roda local, nunca versionado).
2. Em runtime o cliente resolve decklists via `POST /cards/collection` do
   Scryfall + cache IndexedDB — funciona sem o bulk local.
3. `atlas-data.json` (Endless Atlas, CC BY 4.0) entra depois como camada de
   descoberta: "cartas similares" via posições nas lentes, join por `oracle_id`.

## Multi-jogo (visão)

A engine separa **kernel** (zonas, turnos, pilha de eventos, prioridade,
DSL de efeitos) de **ruleset** (fases do MTG, SBAs, mana). Um novo jogo =
novo ruleset + novo adaptador de dados de carta. O MVP não abstrai à força —
extraímos o kernel quando o segundo jogo chegar, com o MTG como prova real.

## Roadmap

- **M0 (este commit)**: engine MVP (turnos, mana, combate, pilha, DSL, ~25
  cartas demo full-auto, modo manual universal), servidor de salas, mesa
  jogável, PWA, testes da engine.
- **M1**: mais primitivas (auras, equipamentos, first strike, deathtouch...),
  mulligan londrino, importar deck por URL (Moxfield/Archidekt), i18n.
- **M2**: lobby público, espectadores, replay, ranking informal.
- **M3**: segundo jogo pela comunidade (provável Pokémon TCG), editor visual
  de DSL para contribuidores.
