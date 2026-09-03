# Cobertura de cartas — plano de levas

Meta do projeto: **todo o pool atual de Magic 100% jogável com automação total**.
Este documento é o mapa vivo: estado atual, método e a divisão em levas.
Cada leva termina com a auditoria rodada e os números atualizados aqui.

## Método (roda em qualquer sessão)

```bash
node scripts/fetch-oracle-bulk.mjs   # baixa o dump oracle do Scryfall para data/ (gitignored)
node scripts/audit-cards.mjs         # compila as ~33k cartas jogáveis e SIMULA cada automatizada numa partida
node scripts/audit-tail.mjs          # curva "cartas prontas por top-N linhas" + data/tail-top1000.txt
node scripts/audit-mechanics.mjs     # ranking de keywords pendentes (data/tail-keywords.txt) e frases (data/tail-sentences.txt)
node scripts/audit-spells.mjs        # ranking do que derruba mágicas (tudo-ou-nada)
```

Regras do jogo: uma **mágica** só é automatizada se toda a resolução for
entendida; um **permanente** compila parcial quando alguma linha não é
entendida (jogável, com a nota no tooltip). Nunca automatizar errado —
uma automação incorreta é uma violação de regra que ninguém vê.

## Estado (2026-09-03, v0.14.1 — v0.14.0 + correções de partida: Urza's Saga, Doomsday; full 12.196)

| 33.085 cartas jogáveis | v0.5 | v0.6 | v0.7 | v0.8 (L1) | v0.9 (L2) | v0.10 (L3) | v0.11 (L3 completa) | v0.12 (Leva 4) | v0.13 (L5a · gramática 2) | **v0.14 (L5b · faces)** |
|---|---|---|---|---|---|---|---|---|---|---|
| Totalmente automatizadas | 1.804 | 5.011 | 5.554 | 6.275 | 6.696 | 7.062 | 7.136 | 10.296 | 11.800 | **12.170** |
| Parciais (jogáveis, alguma linha manual) | 21.602 | 20.566 | 20.873 | 20.182 | 19.788 | 19.464 | 19.400 | 16.960 | 15.772 | **15.620** |
| Manuais | 8.739 | 6.637 | 6.596 | 6.566 | 6.539 | 6.497 | 6.487 | 5.769 | 5.453 | **5.290** |
| Dupla-face manuais | 864 | 864 | 55 | 55 | 55 | 55 | 55 | 55 | 55 | **0** |

A Leva 5b modelou a segunda face de verdade: das 697 cartas que tinham
"outra face não modelada" restam 143 (versos cujo texto ainda não compila).
+370 full, 163 a menos no manual, zero problemas estruturais, 15 falhas de
simulação (criaturas de P/T variável que entram 0/0 no cenário vazio e
afins).

A Leva 4 foi a que virou a curva, como previsto: +3.160 full numa leva só,
e as frases pendentes distintas caíram de 20.669 para 17.855.

A Leva 2 rendeu +421 full (menos que as ≈1.000 estimadas): a keyword deixou
de bloquear, mas boa parte dessas cartas ainda tem outra frase pendente — que
cai na Leva 4. O ganho real da Leva 2 é de **jogabilidade**: as ≈1.000 cartas
com essas mecânicas agora são conjuradas do jeito certo (evoke, escape,
morph, ninjutsu, cascade…), mesmo quando outra linha continua manual.

Curva medida pelo auditor (cartas parciais que ficam 100% prontas ao
resolver as N linhas de texto mais frequentes): top 100 → +695 · top 500 →
+1.973 · top 1.000 → +2.900 · top 5.000 → +6.690 · todas (≈21k) → +20.182.
**90% das linhas pendentes aparecem numa única carta**: o caminho é uma
gramática composicional (sujeito × verbo × quantidade × condição × duração),
não regex por frase.

Das 20.182 parciais, **2.404 dependem de mecânica nomeada** (195 keywords;
ranking em `data/tail-keywords.txt`); as demais dependem de frases.

## Levas

### Leva 1 — feita (v0.8.0)
Linhas de formato (Commander/draft/ante) como no-op; escolha de cor/tipo ao
entrar (+ mana da cor escolhida, "creatures of the chosen type");
contadores genéricos na entrada; kicker de permanente; "pague ou sacrifique"
(upkeep, Echo, Cumulative upkeep); Vanishing/Fading; sacrifício/retorno no
fim do turno; exílio até sair (Banisher Priest/O-Ring); estáticas
condicionais (seu turno, atacando, virada/desvirada, Threshold, Metalcraft,
Delirium, marcador); hexproof de jogador; "players can't gain life"; terreno
extra; topo revelado; restrições de bloqueio (mais de um, N ou mais,
bloqueia N extras, poder ≥ N); gatilhos becomes blocked / becomes targeted /
you draw; Persist, Undying, Modular, Evolve, Renown, Mentor, Afflict,
Rampage, Flanking, Skulk, Bloodthirst, Devour, Fabricate, Unleash, Riot,
Afterlife, Living weapon; Monstrosity/Adapt.

### Leva 2 — feita (v0.9.0): mecânicas de conjuração
Feito: Morph / Megamorph / Disguise (carta virada para baixo 2/2 por {3},
virar por custo), Multikicker, Unearth, Ninjutsu, Evoke, Madness, Warp,
Cascade, Suspend, Encore, Plot, Escape, Dash, Offspring, Foretell, Blitz,
Myriad (no-op em 2 jogadores), Buyback, Squad, Embalm/Eternalize, Scavenge,
Convoke / Delve / Improvise / Affinity for artifacts de verdade (auto-ajuda
no pagamento), Rebound, Surge, Prowl, Spectacle.
Infra: `castMethods` com zona de origem (mão/cemitério/exílio), habilidades
ativadas com `zone` (mão/cemitério) e `exileSelf`, cartas viradas para
baixo (redação no view para o oponente), gatilhos atrasados
(`state.delayed`: fim do turno / próxima manutenção), `castCardFree`
(cascade, suspend, rebound), cópias-ficha parametrizadas (`tokenCopy`).
Cliente: menus de conjuração alternativa na mão, botões no cemitério
(escape, unearth, scavenge, embalm…) e no exílio (prever/tramar/warp),
virar para cima no campo, ninjutsu no passo de bloqueadores.

Ficou para a Leva 3 (são keywords de campo, não de conjuração): Mutate,
Reconfigure, Bestow, Emerge, Dredge, Split second, Retrace, Cipher,
Entwine, Overload, Replicate, Miracle.

### Leva 3 — feita (v0.10.0): keywords de campo e famílias estruturais
Feito: **Sagas** (196 cartas: capítulos I–V, marcador de lore ao entrar e
na fase principal, sacrifício após o último capítulo, Read ahead),
**energia** (144: `{E}` como recurso do jogador, custo de ativação, "you
get {E}", "you may pay {E}"), **Level up** + bandas LEVEL (P/T e keywords
por nível), **Classes** ("{custo}: Level N" com habilidades por nível),
**Station** / Spacecraft (marcadores de carga, vira criatura no limiar),
explore, Extort, Exploit (+ gatilho "exploits"), Soulshift, Backup (só as
keywords), Bestow, Emerge, Mayhem, Retrace, Freerunning, Overload
("alvo" → "cada" por transformação do efeito), Sneak, Entwine, Bargain,
Gift (card/Food/Treasure/Clue/Fish), Reconfigure, Transmute, Outlast,
Umbra armor, Split second, Annihilator, Mobilize, Battle cry, Melee,
Training, Dethrone, Ingest, Firebending (mana até o fim do combate),
Ravenous, Sunburst, Graft, Tribute, Amplify, Job select, For Mirrodin!,
Leylines (mão inicial), Ward—Pay N life, Assist (no-op), "if it was kicked /
the gift was promised" em gatilhos de entrada, "dies → volta para a mão".
Infra: `subjectId` nos gatilhos (o objeto que disparou, `'triggering'` no
DSL), habilidades com faixa de nível, `payOrElse.then`, mayDo do oponente.

Fechamento (v0.11.0): **Hideaway** (esconde uma das N do topo; "{custo},
{T}: jogue a carta escondida de graça se <condição>" com biblioteca ≤ N /
atacou com N criaturas / controla N permanentes / completou masmorra / é o
monarca), **Miracle** (janela ao comprar a primeira carta do turno, fecha
ao fazer qualquer outra coisa), **Dredge** (arma-se do cemitério e
substitui a próxima compra), **Replicate** (N cópias por N pagamentos),
**Cipher** (codifica numa criatura; cópia grátis ao causar dano de
combate), **Haunt** (criatura e mágica; gatilho "a criatura que ela
assombra morre"), **Monarca** (compra no fim do turno; passa por dano de
combate; "se você for o monarca"), **Iniciativa** (aventura em Undercity na
manutenção; passa por dano de combate), **Masmorras** (as quatro — Lost
Mine of Phandelver, Tomb of Annihilation, Dungeon of the Mad Mage,
Undercity — com todas as salas, escolha de caminho, "completou uma
masmorra"), **impulso** ("exile o topo, pode jogar neste turno" — 95
cartas), goad. Quatro salas são aproximadas e o log avisa: Fungi Cavern e
Twisted Caverns duram até o fim do turno, Mad Wizard's Lair compra três sem
a conjuração grátis, Throne of the Dead Three busca na biblioteca inteira.

Ficou de fora de verdade (rules-heavy ou Alchemy): Soulbond, Mutate,
Phasing, Banding, Provoke, Enlist, Batalhas, Daybound, Double team /
Specialize / Starting intensity. Voltam na Leva 5 como script por carta.

### Leva 4 — feita (v0.12.0): gramática composicional
Feito, tudo de uma vez (4a+4b+4c), em `packages/engine/src/cards/grammar.ts`,
usada como fallback de cada frase depois dos padrões escritos à mão:
- **sujeitos**: `~`, `it`/`that X`, `target X` com qualificadores compostos
  (nontoken, cor, non-cor, non-Subtipo, subtipo, "artifact or enchantment",
  poder/resistência/valor de mana N ou mais/menos, com/sem keyword, com
  marcador, virada, atacante, lendária), `up to N target X` (alvos opcionais,
  verbo aplicado a cada um), `each/all X` (forEach), `another X you control`,
  `enchanted/equipped creature`, jogadores (`you`, `each opponent`, `each
  player`, `target player`, `that player`, `its controller`, `defending
  player`);
- **verbos**: destruir, exilar, virar/desvirar, devolver à mão/ao campo,
  marcadores (N, X, "for each"), +N/+N com keywords, +X/+X "where X is",
  "for each" dinâmico, não pode atacar/bloquear/ser bloqueada, luta, dano
  (inclusive "N ao alvo e M a outro"), ganho de controle, anexar, anular,
  blink, regenerar, goad, explorar, conspirar, comprar/descartar/moer/
  sacrificar/perder e ganhar vida/energia/veneno, fichas (P/T, cores,
  subtipos, keywords, viradas e atacando, "for each"), vidência, vigiar,
  proliferar, bolster, support, amass, investigar, povoar, "olhe as N do
  topo … uma para a mão e o resto para o fundo/cemitério", "revele o topo …
  se for X, para a mão", "exile o topo, pode jogar neste turno";
- **quantidades**: N, X, "that much", "equal to its power/toughness/mana
  value", "the number of X you control", cartas na mão/cemitério, total de
  vida, domínio, marcadores, "twice", "for each";
- **condições** (efeitos, gatilhos com "if" interveniente, estáticas "as
  long as", "Activate only if"): você controla N ou mais/nenhum X, oponente
  controla, vida ≤/≥, mão vazia/N cartas, cemitério N+ (com filtro), delirium,
  morbid, raid, revolt, celebration, "cast another spell", ganhou vida,
  pack tactics, formidable, coven, corrupted, "it's your turn", monarca,
  iniciativa, masmorra, "if it's a creature card", and/or/not;
- **durações**: até o fim do turno, "this turn", "until your next turn";
- **"unless"**: "unless you/they pay {custo}", "unless you discard/sacrifice";
- **gatilhos atrasados** genéricos ("at the beginning of the next end step /
  your next upkeep, X") e flicker;
- **substituição e prevenção**: "prevent the next N damage", "prevent all
  damage to X this turn", "If ~ would die, exile it instead", "creatures an
  opponent controls would die → exile", "you gain twice/plus N life", fichas
  em dobro;
- **custos**: "X spells you cast cost {N} less/more", "spells your opponents
  cast (that target ~) cost more", "~ costs {N} less for each X";
- **cópias**: Clone ("enter as a copy of any creature"), "token that's a
  copy of target creature", povoar;
- **modais**: "choose one or both / two / up to N / any number" (cliente com
  seleção múltipla), gatilhos modais em qualquer cabeçalho;
- **gatilhos novos**: início de combate, primeira/segunda fase principal,
  manutenção/fim de turno do oponente, virada para cima, "is dealt damage",
  "deals damage", "deals combat damage to a creature", "attacks and isn't
  blocked", "when you cast ~", hospedeiro de aura/equipamento (morre,
  ataca, dano de combate, é ferido), "a player casts a spell", "a creature
  you control deals combat damage to a player", exert, segunda compra/
  segundo feitiço por turno, "cast a <Subtipo> spell", heroic, "you
  sacrifice", "a player discards", "~ blocks a creature with flying",
  valiant (uma vez por turno);
- **estáticas**: anthems por subtipo/qualificador ("Other Elves you control
  get +1/+1", "creature tokens you control have…"), "~ gets +1/+1 for each
  X" (campo, cemitério, mão), "enchanted creature gets +1/+1 for each X",
  ward em equipamento, "must be blocked", "can't attack unless defending
  player controls an Island", "can't be blocked by artifact creatures/
  Walls/black creatures", "creatures with power less than ~'s can't block
  it", skip draw, "Activate only once/twice each turn", Prototype,
  Reinforce, "you may exert", "as though it had flash", raid/converge ao
  entrar.

O plano original desta leva, para referência:
Reescrever `parseEffectText` como gramática recursiva:
- sujeitos: `~`, `it`/`that X`, `target X` (com **até N alvos** e
  qualificadores compostos), `each X`, `all X`, `another X you control`,
  `enchanted/equipped X`, jogadores (`you`, `each opponent`, `target player`,
  `that player`, `its controller`);
- verbos: os ~30 atuais + `becomes`, `copy`, `attach`, `exile … then return`,
  `look at`, `reveal`, `choose`, `prevent`, `regenerate`, `phase out`,
  `goad`, `exert`, `explore`, `connive`, `amass`, `support`, `bolster`,
  `proliferate`, `clash`, `learn`, `venture`, `manifest`;
- quantidades: `equal to the number of X`, `that much`, `twice`, `X`, `for each X`;
- condições: `if <cond>,` prefixos, `unless`, `as long as` (reuso das
  estáticas condicionais), `if you do`, `otherwise`;
- durações: `until end of turn`, `this turn`, `until your next turn`,
  `for as long as`;
- **efeitos de substituição** ("If X would …, instead …"), prevenção de dano
  (escudos), redução/aumento de custo, cópias (Clone, "enter as a copy"),
  gatilhos atrasados, "escolha um ou ambos / dois".
Cada regra nova aqui destrava centenas de frases distintas de uma vez — é
aqui que a curva vira.

### Leva 5a — feita (v0.13.0): gramática 2
Guiada pela cauda de `data/tail-full.txt` (frases completas, sem truncar):
- **custos adicionais genéricos** (descartar, pagar vida, exilar do
  cemitério, sacrificar qualquer substantivo — "an artifact or creature");
- **Spree** (cada modo soma o próprio custo);
- **custos de ativação**: remover marcadores, exilar cartas do cemitério,
  virar uma criatura desvirada, devolver um terreno, exilar ~, descartar ~;
- **habilidades do cemitério** ("Return this card from your graveyard to
  your hand / the battlefield tapped");
- **Enchant generalizado** ("artifact or creature", "nonland permanent",
  "creature you control"); "Enchant player" continua fora;
- "return the exiled card(s)" (Banishing Light e família), `bounceOwn`,
  `learn`, mover marcadores, fundo da biblioteca, exilar cemitério, revelar
  mão, "deals damage equal to X to Y", "blocks ~ this turn if able",
  "if that creature would die this turn, exile it instead";
- **busca genérica** pela gramática de substantivos ("Rebel permanent card
  with mana value 3 or less", "instant or sorcery card");
- condições de turno novas (ganhou N vida, conjurou não-criatura, oponente
  perdeu vida, permanente saiu, atacou sozinha, N atacantes);
- estáticas: entra virado a menos que / se `<condição>`, atribui dano como
  se não bloqueada, jogar terrenos do cemitério, conjurar do topo, prevenir
  dano removendo marcador, não ataca sozinha, embaralhar em vez de ir ao
  cemitério, criaturas do oponente entram viradas, uma mágica por turno,
  "During your turn, <estática>" genérico;
- gatilhos: becomes untapped, enters or dies, constellation genérica,
  attacks alone / with N others, each upkeep, multicolored spell, cycle
  trigger, hospedeiro causa dano, criatura ferida por ~ morre, upkeep do
  controlador do hospedeiro;
- mana: `Add {C} or one mana of the chosen color`, `{R} or {G}` pela
  gramática, habilidade genérica marcada como de mana quando só produz mana.

### Leva 5b — feita (v0.14.0): faces, P/T variável e rules-heavy
- **Segunda face compilada** como carta própria (`backFace`): transform,
  MDFC (verso como terreno ou mágica), aventura (exílio e volta), carta
  dividida (cada metade, **Fuse**, **Aftermath**), flip, **batalhas** (Siege:
  atacada pelo controlador, defesa em marcadores, derrotada vira o verso) e
  **prepare** (cópia da mágica enquanto preparada). Ao sair do campo a carta
  volta para a frente; imagem do verso no cliente.
- **Transformar**: "transform ~", "Exile ~, then return it transformed"
  (Sagas), "When this creature transforms into ~", **Disturb** (do cemitério,
  transformada, exílio em vez de cemitério), **Daybound/Nightbound** com
  dia/noite de verdade (conta as mágicas do turno anterior), lobisomens
  antigos ("if no spells were cast last turn").
- **P/T variável** (`*`): "~'s power and toughness are each equal to…",
  "power is equal to X and toughness is equal to that number plus N".
- **Rules-heavy**: Soulbond (par com bônus estático), Provoke, Enlist,
  Casualty, Kinship, "When you control no X, sacrifice ~" (gatilho de
  estado), "Cast ~ only during the declare attackers step…", "Choose three,
  same mode more than once", "Choose one (commander: both)".

### Leva 6 — o que sobra
Mutate (34), Phasing (12), Banding (14), Ward—Discard (12), Conspire, Splice,
Strive, Companion, Meld (21), os 143 versos que ainda não compilam, Alchemy
(Starting intensity, Teamwork, Specialize, Double team) e a cauda de frases
únicas do `data/tail-full.txt` — script por carta (Tier 2) é o mais barato
daqui em diante.

## Regras de trabalho por leva
1. `node scripts/audit-cards.mjs` no começo (baseline) e no fim (medida).
2. Zero crash, zero problema estrutural, e cada nova mecânica com teste em
   `packages/engine/test/`.
3. Toda mecânica que envolva escolha do jogador precisa do overlay no
   cliente (`GameBoard.tsx`) — sem UI, a engine trava esperando resposta.
4. Atualizar a tabela acima e a nota do projeto no vault.
