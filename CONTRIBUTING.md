# Contribuindo com o SlopMTG

A contribuição de maior impacto é **implementar cartas**. O sistema tem três
níveis, do mais simples ao mais poderoso:

## Tier 1 — DSL declarativa (comece aqui)

A maioria das cartas é só dados. Exemplo real do set demo
([`packages/engine/src/cards/demo-set.ts`](packages/engine/src/cards/demo-set.ts)):

```ts
export const lightningBolt = def({
  id: 'lightning-bolt',
  name: 'Lightning Bolt',
  manaCost: '{R}',
  types: ['Instant'],
  subtypes: [],
  colors: ['R'],
  text: 'Lightning Bolt deals 3 damage to any target.',
  spellTargets: [{ what: 'any' }],
  spellEffect: [{ op: 'damage', to: 'target:0', amount: 3 }],
  automation: 'full',
});
```

Uma habilidade desencadeada:

```ts
abilities: [{
  kind: 'triggered',
  trigger: { on: 'etb', self: true },          // quando entra no campo
  effect: [{ op: 'draw', who: 'controller', count: 1 }],
  text: 'Quando entra no campo de batalha, compre uma carta',
}],
```

### Primitivas disponíveis

Diretas: `draw · discardRandom · mill · damage · gainLife · loseLife ·
destroy · exile · returnToHand · tap · untap · counterSpell · pump (com
keywords até o fim do turno) · putCounters (+1/+1, -1/-1…) · attach ·
addMana · token · shuffle · fight · gainControl (com reversão no fim do
turno) · copySpell · preventCombatDamage`

Em massa (com `FilterSpec`): `damageEach · destroyEach · exileEach ·
pumpEach · tapEach · untapEach`

Com escolha do jogador (pausam a resolução e retomam sozinhas):
`discard · sacrifice · scry · search`

Além disso: quantidades dinâmicas (`amount: 'X'` ou `{ per: filtro }`),
custos com `{X}`, mágicas modais (`spellModes`), alvos no cemitério
(`zone: 'graveyard'`), permanentes que entram com marcadores
(`entersWithCounters`) e habilidades estáticas (`kind: 'static'` — anthems
e lords).

Gatilhos: `etb`/`dies` (de si ou de qualquer objeto casando um filtro) ·
`attacks` · `upkeep` · `endStep` · `youCastSpell` (destreza). Gatilhos
podem ter `targets` — o controlador escolhe quando a habilidade vai para a
pilha (Flametongue Kavu); sem alvo legal, o gatilho é removido.
Keywords automatizadas: `flying · reach · haste · vigilance · trample ·
lifelink · deathtouch · defender · menace · firstStrike · doubleStrike ·
indestructible · hexproof`.
Mecânicas de carta: `storm` (cópias na pilha por mágica conjurada antes no
turno) e `additionalCost` (sacrifício pago no cast, com `'sacrificedPower'`
como quantidade dinâmica — Fling).

Definições em [`packages/engine/src/cards/types.ts`](packages/engine/src/cards/types.ts).

### Checklist para PR de carta

1. Defina a carta com `automation: 'full'` e o texto oracle em `text`.
2. Adicione pelo menos um teste em `packages/engine/test/` provando o
   comportamento (veja os testes existentes — os helpers `makeGame`,
   `stackTop` e `passUntil` deixam isso curto).
3. `npm test` verde.
4. Se a carta precisa de uma primitiva que não existe, veja o Tier 2.

## Tier 2 — novas primitivas de efeito

Se a carta pede algo que a DSL não expressa (ex.: "olhe as 3 cartas do
topo"), adicione a primitiva:

1. Novo caso na union `EffectStep` (`cards/types.ts`).
2. Implementação em `effects.ts` — **sempre emitindo eventos** via `ops.ts`,
   nunca mutando estado silenciosamente.
3. Testes.

Primitivas devem ser genéricas (reutilizáveis por muitas cartas), não
específicas de uma carta.

## Tier 3 — modo manual

Cartas sem implementação continuam jogáveis: qualquer carta importada via
Scryfall entra na mesa em modo manual (mover, virar, marcadores), com toda
ação registrada no log. Isso é proposital — o jogo funciona com 100% do
cardpool desde o dia 1, e a automação cresce por demanda.

## Regras do projeto

- **Nunca** versione texto, imagem ou dado de carta no repositório — isso é
  propriedade da Wizards. Dados vêm do Scryfall em runtime.
- O servidor nunca confia em comportamento declarado pelo cliente: cartas
  externas são sempre rebaixadas a `automation: 'manual'`
  (`packages/server/src/index.ts`).
- Toda mudança de regra passa por teste. Ação inválida deve falhar com
  mensagem clara, nunca corromper o estado.
- Eventos são a única saída da engine: se algo aconteceu e não gerou evento,
  é bug.

## Outros jogos (Pokémon TCG, Yu-Gi-Oh!, …)

A separação kernel/ruleset ainda não está extraída — o plano é fazê-lo quando
o segundo jogo chegar, usando o MTG como prova. Se você quer portar um jogo,
abra uma issue primeiro para desenharmos o corte juntos.
