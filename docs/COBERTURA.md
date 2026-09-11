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

## Estado (2026-09-10, v0.38.0 — Sheltered by Ghosts, Chancellor of the Annex, Call Forth the Tempest, Curie, Abhorrent Oculus; Legacy a 99,1%)

| 33.085 cartas jogáveis | v0.5 | v0.6 | v0.7 | v0.8 (L1) | v0.9 (L2) | v0.10 (L3) | v0.11 (L3 completa) | v0.12 (Leva 4) | v0.13 (L5a) | v0.14 (L5b · faces) | v0.15 (L6a · Legacy) | v0.16 (L6a·3 · sideboard) | v0.17 (L6a·4) | v0.18 (L6a·5) | v0.19 (L6a·6) | v0.21.1 (L6a·7) | v0.22 (L6a·8) | v0.23 (L6a·9) | v0.24 | v0.25 | v0.27 (L13) | v0.28 (L14) | v0.30 | v0.35 (pesada) | v0.36 (top 30) | v0.37 | **v0.38** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Totalmente automatizadas | 1.804 | 5.011 | 5.554 | 6.275 | 6.696 | 7.062 | 7.136 | 10.296 | 11.800 | 12.170 | 12.787 | 13.022 | 13.110 | 13.175 | 13.250 | 13.288 | 13.344 | 13.534 | 13.600 | 13.690 | 13.790 | 13.795 | 13.795 | 13.801 | 13.857 | 13.876 | **13.890** |
| Parciais (jogáveis, alguma linha manual) | 21.602 | 20.566 | 20.873 | 20.182 | 19.788 | 19.464 | 19.400 | 16.960 | 15.772 | 15.620 | 15.275 | 15.101 | 15.034 | 14.971 | 14.909 | 14.883 | 14.849 | 14.719 | 14.670 | 14.605 | 14.525 | 14.522 | 14.522 | 14.516 | 14.495 | 14.480 | **14.471** |
| Manuais | 8.739 | 6.637 | 6.596 | 6.566 | 6.539 | 6.497 | 6.487 | 5.769 | 5.453 | 5.290 | 5.018 | 4.957 | 4.936 | 4.934 | 4.921 | 4.909 | 4.887 | 4.827 | 4.811 | 4.786 | 4.766 | 4.764 | 4.764 | 4.764 | 4.729 | 4.725 | **4.720** |
| Dupla-face manuais | 864 | 864 | 55 | 55 | 55 | 55 | 55 | 55 | 55 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **0** |

**Métrica nova (Leva 6): cobertura ponderada pelo metagame** — `node
scripts/meta-gap.mjs --format <formato>` baixa o metagame do MTGGoldfish e
mede quanto do que se joga já é full (META% × cópias). Legacy: **43,7% →
67,1%** na v0.15.0, **78,8%** na v0.15.1, **86,0%** na v0.16.0, **88,6%** na v0.17.0, **90,5%** na v0.18.0, **92,0%** na v0.19.0, **92,4%** na v0.21.0, **92,8%** na v0.22.0, **94,9%** na v0.23.0, **95,1%** na v0.24.0, **95,4%** na v0.25.0, **97,3%** na v0.27.0, **97,5%** na v0.28.0, **97,8%** na v0.35.0, **98,9%** na v0.36.0, **99,0%** na v0.37.0 e **99,1%** na v0.38.0. Relatórios em `data/meta/<formato>-gap.md`.

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

### Leva 6 — metagame, formato a formato
A partir daqui a prioridade vem do que as pessoas jogam: o relatório
`scripts/meta-gap.mjs` ranqueia as cartas com lacuna pelo peso no meta e
lista as linhas de texto que as seguram. Ordem combinada com o Lucas:
**Legacy → Vintage → Standard → Pauper → Premodern → o resto**.

**6a — Legacy, feita (v0.15.0)**: 43,7% → 67,1% ponderado. Famílias:
filtro "nonbasic"; condições sobre o alvo ("if it has mana value 2 or less",
"if it's red", "… instead if <condição>"); alvos de linhas anteriores valem
nas seguintes; custos alternativos condicionais (Daze, Snuff Out, Force of
Negation, Once Upon a Time, Mindbreak Trap); Brainstorm; Show and Tell;
turno extra; Green Sun's Zenith; proteção contra tudo (The One Ring); Rest in
Peace / Leyline; Pithing Needle; Stony Silence; Deafening Silence; Voice of
Victory; Tron; Delver; Bowmasters; Murktide; Goyfs; Evoke por exílio; LED;
Spirit Guides; Aether Vial; Stock Up / Flow State / Malevolent Rumble.

**6a parte 2 (v0.15.1)**: as 17 cartas que seguravam o topo do ranking —
Moonshadow, Bilbo, Tamiyo (verso), Atraxa, Consign to Memory, Stifle
(habilidades na pilha como alvo), Phelia, Kozilek's Command, Petrified
Hamlet, Karn, Planar Nexus, Chalice of the Void, Containment Priest, Animate
Dead, Chrome Mox, Mox Diamond, Shallow Grave, Nethergoyf — todas full.
Legacy ponderado 67,1% → **78,8%**.

**6a parte 3 (v0.16.0)**: o **sideboard virou zona do jogo** ("fora do
jogo"): Burning/Cunning/Living/Death/Glittering Wish e o −2 do Karn buscam
nele (Karn também no exílio com a face para cima); o dono vê a pilha no
cliente. Depois, os 15 pesos seguintes — Quantum Riddler, Murktide (gatilho
de carta saindo do cemitério, com LKI de fichas para gatilhos de morte),
Barrowgoyf, Ugin (−11 com conjuração de graça do exílio), Sink into Stupor
(mágica na pilha ou permanente), Amped Raptor (conjurar pagando energia),
Guide of Souls (marcador de voar, vira Anjo), Ajani (morte em lote, volta
transformado com lealdade, −4 "fica um de cada tipo"), Ocelot Pride (Ascend
e bênção da cidade), Disruptor Flute, Eldrazi Confluence, Veil of Summer
(hexproof por cor para jogador e permanentes, mágicas não anuláveis),
Boseiju (Channel com desconto e busca pelo controlador do alvo), Omniscience
e Aluren — todos full. Legacy ponderado 78,8% → **86,0%**.

**6a parte 4 (v0.17.0)**: Wrath of the Skies (energia X e **escolha
numérica** no cliente), Overlord of the Balemurk (**Impending**: custo
alternativo, marcadores de tempo, não é criatura enquanto os tiver, perde um
no fim do turno), Sand Scout (condição "oponente controla mais terrenos",
Deserto como substantivo, "triggers only once each turn"), Bloodchief's
Thirst (**alvo alternativo quando kickado**), Acererak (nome curto
"Acererak" → ~, masmorra nomeada, "cria ficha a menos que o oponente
sacrifique"), Leyline Binding (**Domain** no custo), Up the Beanstalk
(gatilho combinado "enters and whenever"), Archon of Cruelty (lista de
verbos do jogador-alvo e cauda imperativa "and gain 3 life"), Summon:
Bahamut (palavra de habilidade no capítulo, "total mana value of"),
Surgical Extraction (exílio por nome em cemitério, mão e biblioteca).
Legacy ponderado 86,0% → **88,6%**.

**6a parte 5 (v0.18.0)**: Sneak Attack (carta da mão entra com ímpeto e é
sacrificada no fim do turno), Dark Depths (**gatilho de estado "sem
marcadores"**, ficha lendária nomeada Marit Lage), Thespian's Stage
(**permanente vira cópia** de outro terreno mantendo a habilidade — o combo
com Dark Depths funciona), Glaring Fleshraker (ficha com habilidade entre
aspas em linha de gatilho), Yavimaya (**todo terreno é Floresta**: concessão
de subtipo e habilidade de mana a todos os terrenos, revogada quando ela
sai; pagamento escolhe entre as produções do terreno), Stronghold Gambit
(escolha escondida de cada jogador e revelação), Carpet of Flowers (gatilho
nas duas fases principais, uso único por turno, X mana da cor escolhida),
Raph & Mikey (revela até criatura, entra virada e atacando, resto no fundo
em ordem aleatória), Emry (carta-alvo conjurável do cemitério neste turno),
Endurance (cemitério do jogador-alvo para o fundo da biblioteca).
Legacy ponderado 88,6% → **90,5%**.

**6a parte 6 (v0.19.0)**: Gaea's Will (a pedido do Lucas: não funcionava —
agora suspende, joga terrenos e conjura do cemitério até o fim do turno, e
o que iria para o cemitério é exilado; de quebra, **carta sem custo de mana
não é mais conjurável da mão**), Mindbreak Trap (custo alternativo
condicional "oponente conjurou 3+ mágicas", **qualquer número de alvos**,
exílio de mágica na pilha), Prismatic Ending (**Converge**: cores de mana
gastas), Emrakul (proteção contra mágicas coloridas, gatilho "posta no
cemitério de qualquer lugar" que embaralha o cemitério na biblioteca),
Fable of the Mirror-Breaker (II descarta até dois e compra; verso copia
criatura não lendária com ímpeto e sacrifica no fim do turno), Wight of the
Reliquary (+1/+1 por carta de criatura no cemitério), Phlage ("unless it
escaped"), Lazotep Quarry (**{X} em custo de habilidade**, cópia com
P/T, cor e subtipo trocados), Red Elemental Blast (alvo de mágica por cor),
Sewer-veillance Cam (gatilho "enters or leaves", virar ou desvirar),
Broadside Bombardiers (**Boast**: só se atacou, uma vez por turno; dano
igual a 2 mais o valor de mana do sacrificado). Legacy ponderado 90,5% →
**92,0%**. **v0.19.1**: Beseech the Mirror (busca para o exílio; com
bargain, conjura a carta exilada de graça se valor de mana ≤ 4, senão vai
para a mão) — confirmado a pedido do Lucas: Gaea's Will conjurada assim
vai direto para a pilha, sem suspender. **v0.19.2**: conjuração de graça
com alvos — a carta que precisa de alvo (Tendrils of Agony via Beseech,
cascade em queimadura, suspend de Lightning…) abre a escolha de alvos e é
conjurada com eles, por zero, contando para o Storm e com as cópias.

**v0.20.0 — mana manual e preview no painel lateral** (pedido do Lucas):
o pagamento automático de mana foi desligado nas partidas. A mágica ou
habilidade é escolhida primeiro; o engine para com a decisão `payMana`
("pague {1}{G} para X"), o jogador vira as fontes que quiser (habilidades de
mana continuam permitidas durante a espera), e quando o pool cobre o custo a
conjuração completa sozinha. "Cancelar pagamento" desiste e deixa a mana
flutuando. A opção `manualMana` do `Game` liga o modo (o servidor liga; os
testes e o auditor seguem no automático). No cliente, a carta grande do
hover passou para um slot fixo no topo do painel lateral, acima do log/chat.

**Parte 7 (v0.21.0)** — pedido do Lucas: Ad Nauseam, Infernal Tutor,
Wishclaw Talisman, Street Wraith, Thassa's Oracle, mais três correções.
Novidades na engine: `reorderTop` (Ponder e "look at the top N… put them
back in any order" deixam de ser vidência: o jogador clica as cartas na
ordem, modo `order` no cliente); `adNauseam` (escolha que se repete
enquanto o jogador disser sim); `revealFromHandRemember` + filtro de busca
`sameNameAsRevealed` e a linha "If <cond>, instead <efeito>" em mágicas
(Hellbent); `winGame`, condição `compare` e quantidades `devotion` /
`librarySize` (Thassa's Oracle: `digTop` com contagem dinâmica, escolhidas
ficam no topo, resto no fundo em ordem aleatória); `gainControl` para o
oponente (Wishclaw); "Cycling—Pay N life"; "Activate only …" no fim de
habilidade deixava ".." e derrubava a linha (Wishclaw e mais cinco cartas
de cemitério com "Activate only if"). **Derrota por compra com biblioteca
vazia** virou ação baseada em estado (regra 704.5b: marca o jogador, perde
na próxima verificação) e Laboratory Maniac / Jace vencem em vez disso.
**Bargain em conjuração de graça** (Beseech the Mirror buscando outro
Beseech): a engine pergunta ao controlador qual artefato, encantamento ou
ficha sacrificar (ou nenhum) antes de pôr a mágica na pilha — escolha
`freeCastBargain`, interna. No cliente, todas as perguntas de conjuração e
ataque (X, kicker, barganha, buyback, replicar, vida, casualty,
planeswalker, exert) saíram do `confirm()`/`prompt()` do navegador para o
modal padrão das decisões; a coluna principal do tabuleiro ficou
`minmax(0, 1fr)` (o painel lateral não sai mais da tela quando a faixa de
fases é larga). Próximos pesos: Hexing Squelcher, Goblin Welder, Goblin
Engineer, Thundertrap Trainer, Magus of the Moon, Pinnacle Emissary,
Damping Sphere, Eye of Ugin, Eldrazi Linebreaker, Thought-Knot Seer.

**v0.21.1** (pedido do Lucas): Edge of Autumn e Peer into the Abyss. "If
<cond>, <frase>" em que a frase só o `parseEffectText` conhece (busca de
terreno) passou a ser tentada quando a gramática falha; "Cycling—Sacrifice
a <permanente>" (custo de reciclar com sacrifício, escolhido na ação
`cycle`, com o cliente pedindo a permanente antes). `halfLifeOf` /
`halfLibraryOf` aceitam `WhoSel` — "target player loses half their life"
descontava a vida do controlador, corrigido. Legacy: 204 cartas ainda com
lacuna (305 de 509 full), 92,4% ponderado.

**Parte 8 (v0.22.0)** — pedido do Lucas. **Regra das lendárias** (704.5j):
ação baseada em estado em `sba.ts` — duas ou mais permanentes lendárias
com o mesmo nome sob o mesmo controlador abrem uma decisão (`effectChoice`
com a operação interna `legendRuleKeep`); o controlador escolhe a que fica
e as outras vão para o cemitério (não é sacrifício: gatilhos de "sacrifice"
não disparam). **Terrenos que entram virados por efeito**: as regras de
entrada (entersTapped, checklands, fastlands, shocklands) saíram do
`Game` para `effects.applyEnterTapRules`, registrada como hook em
`ops.moveWithEvent` — fetch land buscando surveil land entra virada, shock
land pergunta pelos 2 de vida; `enterTapDone` no objeto evita aplicar duas
vezes; movimentos manuais ficam de fora. Cartas: **Debt to the Deathless**
("<n> times X", `lifeLostThisWay` acumulado pelos `loseLife` do mesmo
script), **Damping Sphere** (taxa `perSpellsCastThisTurn` no cálculo de
custo; terreno virado para 2+ manas produz {C}, hook `dampingMana` em
`addMana`/`addManaChoice`), **Force of Vigor** ("and/or" normalizado para
"or"), **Badgermole Cub** (earthbend N: o terreno vira criatura 0/0 com
ímpeto via `printedCard`, ganha marcadores e volta virado se morrer ou for
exilado — `earthbendReturn` em `moveWithEvent`; "whenever you tap a creature
for mana" em `doActivateAbility`). Cliente: decisões de sim/não e de número
usam o modal leve (`.mulligan-overlay.light`), sem escurecer a tela nem
bloquear a mão e o chat (Ad Nauseam: dá para rolar a mão enquanto responde);
fim de cada jogo mostra "você venceu/perdeu o jogo N" com botão "Ir para o
sideboard" (o sideboard só abre depois), e o fim da série mostra quem venceu
a partida com o placar. Legacy: 199 cartas com lacuna (310 de 509 full),
92,8% ponderado.

**v0.22.1** (pedido do Lucas: Leyline of the Void e Tamiyo, Inquisitive
Student). As duas já compilavam full; o que faltava era o "you may" das
cartas de efeito pré-jogo: ao manter a mão, o cliente pergunta, para cada
carta com `openingHand`, se ela começa no campo, e manda
`keepHand.beginOnBattlefield` (sem a lista, todas começam — testes e
auditor); o log registra "X começa o jogo com Y no campo de batalha".
Tamiyo: a mão inicial contava como sete compras "do turno" (a terceira
compra nunca chegava no turno 1) — `drawsThisTurn` zera ao começar o
primeiro turno. Verificado no navegador (duas Leylines na mão: uma no campo,
outra na mão).

**Parte 9 (v0.23.0)** — pedido do Lucas. **Dragar como substituição de
compra**: a operação `draw` virou escolha (`ChoiceStep`): sempre que um único
jogador compraria e tem carta com dredge no cemitério (biblioteca com N
cartas ou mais), o engine pergunta "comprar ou dragar?" (modo `cards`, min 0,
com `skipLabel` "Comprar a carta"), carta a carta — Brainstorm faz três
perguntas se houver o que dragar em cada uma; a etapa de compra usa a mesma
decisão (`effectChoice` com `draw` em `resume.current`); o Quantum Riddler
segue no caminho de compra em lote; dragar não conta como compra
(`drawsThisTurn` só sobe na compra real). **Tamiyo com Brainstorm**: o
ordinal da compra passou a viajar no evento `cardDrawn.nth` (era lido depois
da resolução inteira, quando a contagem já estava em 4 — só a Divination
"funcionava" por coincidência); miracle e "primeira compra da etapa" usam o
mesmo campo. **Cliente**: clicar no nome de uma etapa na barra central
passa automaticamente até ela começar (`yieldUntil.kind = 'step'`, próxima
ocorrência em qualquer turno); os botões Etapa/Combate/Main/Final saíram —
ficou só "⏭ Meu turno" e o pino de segurar prioridade na ponta direita.
Cartas (18 de 19 full): Hexing Squelcher (`yourSpellsUncounterable`,
`grantWardLifeOthers`), Goblin Welder (`welderSwap`, dois alvos: artefato no
campo + carta de artefato no cemitério do mesmo jogador), Goblin Engineer
(busca para o cemitério), Thundertrap Trainer (substantivo com vírgula no
"look at the top N"), Magus of the Moon / Blood Moon
(`nonbasicLandsAreMountains`: `syncBloodMoon` no SBA troca `card` por uma
Mountain com "{T}: Add {R}" e guarda `moonPrinted`; restaura ao sair do
campo ou quando a Moon some), Pinnacle Emissary (ficha com "flying and
'<quoted>'"), Eye of Ugin ("Colorless Eldrazi spells"), Eldrazi Linebreaker
("gains haste and gets +X/+0 … where X is" reordenado; "the number of
Eldrazi you control" com caixa preservada), Thought-Knot Seer (`discard.exile`),
Fury (`divideDamage`: pergunta o dano alvo a alvo em modo `number`, o
último leva o resto), Price of Progress (`damageEachPlayerPer`), Portent of
Calamity (`portentReveal` + `portentCast`), Triumph of Saint Katherine
(`exileSelfAndTopShuffleBack`; palavra de habilidade com duas palavras
capitalizadas), Seasoned Dungeoneer (keyword `protectionFromCreatures`:
não pode ser bloqueado, dano de criaturas prevenido; "It explores" mira o
alvo anterior), Sundering Eruption ("Creatures without flying can't block
this turn" → `forEach` + `cantBlock`), Grafdigger's Cage (`cageNoEnterFrom…`
em `moveWithEvent`, `cageNoCastFrom…` na conjuração normal e de graça),
Narcomoeba (`toGraveyardFromAnywhere.fromZone = 'library'`), Dread Return
(`flashback.sacrificeCount`). Plural irregular de subtipo (Elves → Elf,
Wolves → Wolf, Zombies → Zombie, Allies → Ally…) corrigido — "Heedless One"
estava virando 0/0. **Fora**: Wastescape Battlemage (kicker duplo com custos
diferentes e gatilhos por kicker: exige um modelo de kicker com opções, fica
para depois). Legacy: 180 cartas com lacuna (329 de 509 full), 94,9%
ponderado.

**v0.24.0 — listas do Lucas** (Turbo Doomsday, Black Saga Storm e Blue
Dredge do Moxfield: 81 cartas distintas, todas full agora; as duas do
MTGGoldfish ficaram atrás do anti-bot da Cloudflare). **Gatilhos do
cemitério**: `TriggeredAbility.zone = 'graveyard'` — o parser marca quando o
corpo começa com "if this card is in your graveyard, " ou é "return this
card from your graveyard to the battlefield"; a engine varre cemitérios em
`fireZoneTriggers` (morte/entrada) e no despacho de "whenever you cast"
(Bridge from Below, Poxwalkers; Bloodghast de brinde). Novos:
`youCastSpell.notFromHand`, `discard.exile` já existia, `gainControlSpell`
(Commandeer, com custo alternativo de duas cartas azuis),
`helmOfObedience`, `payLifeDrawThatMany` + `maxHandSize` +
`exileInsteadOfGraveyardFor: 'self'` (Necrodominance), `strive` (custo por
alvo extra, somado antes do pagamento — Kiora's Dismissal),
`flashback.payLife` (Deep Analysis), `additionalCost.either` (Bone Shards:
sacrifica OU descarta, o cliente pergunta), `triggeringManaSpentAtLeast`
com `obj.manaSpent` gravado na conjuração (Exhibition Tidecaller),
`entersWithCounters` com quantidade dinâmica (Golgari Grave-Troll), "if
your library has no cards in it, you win the game" (Jace −8), e "reveal it,
then shuffle and put that card on top" normalizado (Personal/Mystical
Tutor). Legacy: 174 cartas com lacuna (335 de 509 full), 95,1% ponderado.

**v0.25.0 — listas do Lucas, parte 2** (as duas do MTGGoldfish, coladas:
Jund/Goyf e Lands — 67 cartas distintas, 14 corrigidas; as 137 cartas das
cinco listas estão full). Novos: `colorAnyOf` / `keywordAnyOf` no
FilterSpec e `colorAnyOf` no TargetSpec ("black or red permanent", "spell
that's white, blue, black, or red", "creature with trample or haste");
substantivo `planeswalker`; `noUntapLandType` (Choke, na etapa de desvirar);
`revealTopToHandLoseMv` (Dark Confidant); Thoughtseize com "with mana value
3 or less" (Inquisition); `pileSplit` + `pileSacrifice` (Liliana −6: o
controlador separa, o alvo escolhe a pilha); `fight.exileIfDies` (Mawloc);
`preventCombatToAndBy` + `preventCombatThisTurn` checado em
`dealDamageToObject/Player` com `opts.combat` (Maze of Ith); Minsc & Boo
(cabeçalho "When ~ enters and at the beginning of your upkeep", ficha
legendária nomeada, −2 com `sacrificedPower`/`sacrificedWasSubtype`
guardados pela escolha de sacrifício); Molten Collapse (`spellModeChoiceIf`
com cond `descended`, contador `permanentCardsToGraveyardThisTurn`, a view
já entrega o máximo de modos certo ao cliente); `destroyEachCmcAtMostX`
(Pernicious Deed); Questing Druid (lista de cores no cabeçalho do gatilho
normalizada para "or"; `impulse.untilNextEndStep`); Riftstone Portal
(`riftstoneGrant` sincronizado no SBA: seus terrenos ganham a habilidade
enquanto ele está no cemitério); Uro ("…, then you may put a land card…"
dentro de compostos vira `mayDo`). **Moxfield por URL**: `/api/deck` aceita
`moxfield.com/decks/<id>` (API v2, via `https` do Node — o `fetch` leva 403
do anti-bot). 8 falhas de simulação novas são criaturas que devolvem "uma
criatura azul ou preta que você controla" à mão e, sozinhas, devolvem a si
mesmas (Cavern Harpy, Marsh Crocodile…): comportamento correto.
Legacy: 167 cartas com lacuna (342 de 509 full), 95,4% ponderado.

**v0.26.0 — link público** (sem mudança na engine; auditor e cobertura
iguais à v0.25.0). Servidor: `/api/tunnel` (GET estado, POST liga, DELETE
desliga; só aceita pedidos diretos por localhost e sem `cf-connecting-ip`)
sobe um Cloudflare quick tunnel (`cloudflared tunnel --url
http://localhost:PORT --no-autoupdate`) e lê a URL `https://….trycloudflare.com`
da saída. O binário é procurado (`SLOPTCG_CLOUDFLARED`, ao lado do exe, cwd,
pasta de dados do usuário, PATH) e, se faltar, baixado do release oficial
com versão fixa (`CLOUDFLARED_VERSION`) para a pasta de dados. Cliente: no
lobby do host aparece "Jogar pela internet" com o botão, o link
`…/?sala=CÓDIGO` (copiável) e "Desligar o link"; a Home lê `?sala=` e
preenche o código. Verificado de ponta a ponta no navegador (download,
túnel em ~10 s, oponente entrando pelo link, 403 para quem tenta controlar
o túnel pelo próprio túnel).

**v0.27.0 — Leva 13** (relatos do Lucas + 29 cartas Legacy). **Nomear
carta com autocomplete**: o modal `nameCard` consulta
`api.scryfall.com/cards/autocomplete` enquanto se digita (debounce 250 ms)
e lista os nomes; clicar envia o nome exato. **Nome normalizado**:
`sameName()` (acentos, caixa, espaços, face da frente de "//") em Pithing
Needle, Meddling Mage, Peacekeeper e afins — o relato "nomeei Scalding Tarn
e o fetch passou" era um erro de digitação/caixa. **ETB de quem entra por
efeito**: `applyEnterTapRules` virou hook registrado em `moveWithEvent`
(ops.ts), então Mox Diamond buscado por Urza's Saga III ainda pede o
descarte do terreno, e terrenos que entram por busca respeitam
"enters tapped"/shock/check lands (reason `manual` continua fora).
Cartas: Echo of Eons, Unholy Heat (delirium), Golgari Thug, Cephalid
Illusionist, Archon of Emeria, Ensnaring Bridge, Gaddock Teeg, Trinisphere
(piso de três antes do `planPayment`), Clarion Conqueror
(`lockAbilitiesOfTypes`), Silent Gravestone (`noGraveyardTargets` em
`validateTargets`), Apex Devastator (`cascadeCount`), Sandstone Needle,
Mystic Sanctuary, Urza's Workshop (`addMana.times`), Eumidian Hatchery,
Skyclave Apparition (`tokenForExiledByThis`), Unlicensed Hearse, Lion Sash
(`powerPerCounterOnSelf`), Mox Diamond, Pithing Needle, Planar Genesis
(escolhas `planarPick`/`planarHand`), Trumpeting Carnosaur (`discover`
como escolha: exila até o acerto, conjura de graça ou põe na mão), The
Tabernacle at Pendrell Vale (gatilho de manutenção `tabernacleTax`, uma
criatura por vez, paga {1} via `planPayment` ou destrói), Sejiri Steppe
(`protectionUntilEot` no objeto, lido em dano, bloqueio e alvos), Quirion
Ranger (custo `returnToHand`, escolhido como o sacrifício no cliente e no
auditor), Anointed Peacekeeper (revela a mão do oponente ao entrar,
`costModifiers.chosenName` + `activationTaxChosenName`), Collective
Brutality (`escalate`: um descarte por modo além do primeiro, cliente e
engine), Scythecat Cub (`markResolved`/`resolvedNthThisTurn` +
`doubleCounters`), Hogaak ("Convoke, delve" numa linha, `noManaToCast`
converte o custo todo em genérico pago só por convoke/delve,
`castFromGraveyardSelf`). Regressões pegas pela suíte e corrigidas:
"Cascade" simples perdeu a flag com o `cascadeCount`; a regra genérica
"Activated abilities of X can't be activated" engolia Stony Silence e
Karn. Auditor: 13.790 full / 14.525 parciais / 4.766 manuais, 0
estruturais, 39 falhas de simulação. Legacy 95,4% → 97,3% (374 de 509
full, 135 com lacuna; o MTGGoldfish reamostrou o meta em 2026-09-05).
Ficam de fora: Wastescape Battlemage (kicker duplo), Loki (alvo de
habilidade), Talon Gates (phasing), Chain Lightning (cadeia de cópias).

**v0.28.0 — Leva 14** (as três que sobraram da 13). **Loki, God of
Mischief**: evento `abilityTargeted {by}` emitido quando uma habilidade
ativada (`doActivateAbility`) ou um gatilho (`doChooseTargets`) entra na
pilha com ≥ 1 alvo; gatilho `on: 'yourAbilityTargets'` + `oncePerTurn`
(a regra "This ability triggers only once each turn." já existia).
**Talon Gates of Madara — phasing**: `phaseOutObject` tira a permanente
(e o que está anexado a ela) da lista `zones.battlefield` sem mudar
`obj.zone`, guarda o id em `player.phasedOut` e marca `obj.phasedOut`;
`phaseInAll` devolve tudo no início do untap step do controlador (antes de
desvirar, sem eventos de entrada, sem enjoo de invocação). Como toda a
engine itera `zones.battlefield`, a permanente some de SBA, combate,
contagens e view; `targetMatchesSpec`/`objectAlive` recusam alvos fora de
fase. Op `phaseOut`; frase "up to one target creature phases out";
`{4}: Put this card from your hand onto the battlefield` vira habilidade
ativada com `zone: 'hand'` + op `selfToBattlefield` (passa pelo hook de
entrada; não conta como terreno jogado). **Chain Lightning**: op de
escolha `chainCopy {cost, damage}` — depois do dano, o jogador alvo (ou o
controlador da permanente alvo) recebe um confirm "pagar {R}{R} para
copiar?" (auto-não se não conseguir pagar); pagando, entra em
`triggerQueue` uma "cópia — escolha o novo alvo" com os mesmos passos
(dano + chainCopy), então a cadeia continua enquanto alguém pagar. Evento
`phased` no log. Auditor: 13.795 full / 14.522 parciais / 4.764
manuais, 0 estruturais, 39 falhas de simulação. Legacy 97,3% → 97,5%
(377 de 509 full, 132 com lacuna). Próximo peso: Wastescape Battlemage
(kicker com duas opções de custo e gatilho condicional a qual kicker).

**v0.28.1 — responder ao próprio gatilho de capítulo** (relato do Lucas:
com o capítulo III da Urza's Saga na pilha ele não conseguia gerar o
Constructo do capítulo II antes da busca). Causa: o cliente passa a
prioridade sozinho sempre que o topo da pilha é do próprio jogador
(comportamento Arena, em `shouldAutoPass`), o que engolia os gatilhos de
capítulo. Correção: `StackItemView.chapter` exposto pela view; quando o
topo é um gatilho de capítulo seu e não há yield ativo, o cliente segura a
prioridade e o prompt vira "Capítulo N de X na pilha — ative habilidades em
resposta ou passe para resolver" (botão "Resolver"). Mágicas e demais
gatilhos próprios continuam passando sozinhos. Verificado no navegador com
Urza's Saga no turno 1. Skateboard conferida: compila full (gatilho de
entrada vira alvo, +1/+0 e ímpeto ao equipado, equipar {1}).

**v0.29.0 — cinco relatos do Lucas.** (1) **Daze com Tundra**: a engine já
aceitava qualquer terreno com subtipo Island (`matchFilter` por
`subtype`), mas escolhia sozinha o terreno devolvido (virado primeiro,
senão o primeiro); agora o cliente pede qual terreno devolver como o
primeiro pick (`Targeting.altReturnPick`) e manda `altReturnLand` na
ação; a engine valida contra o filtro e cai no automático se não vier.
(2) **Mão revelada** (Duress, Thoughtseize, Peacekeeper): a escolha
`discard` com `chooser: 'caster'` passa a emitir `handRevealed` com a mão
inteira antes de filtrar, então a revelação acontece mesmo sem carta que
sirva; o cliente (`App` guarda o último `handRevealed` de outro jogador e
passa `reveal` ao `GameBoard`) mostra um painel flutuante `.reveal-panel`
com as cartas por nome (`CardFace name=`), que não bloqueia o jogo e fica
aberto até o ✕. (3) **Alvo no cemitério** (Dread Return, Reanimate): a
engine já distinguia `ownedBy: 'you'` (Dread Return só no próprio
cemitério) de "from a graveyard" (Reanimate em qualquer um), mas o
cliente não tinha como clicar numa carta do cemitério: agora o visor de
zona marca as cartas `targetable`, o clique vira `addTarget`, e quando o
próximo spec tem `zone: 'graveyard'` o cemitério certo abre sozinho
(`ownedBy` decide de quem). O relato "as três criaturas não são
sacrificadas" era consequência: sem alvo, a conjuração nunca completava;
o custo já era validado pela engine (`flashback.sacrificeCount`). Rótulo
do botão de flashback agora diz "sacrifique 3 criaturas"; log "voltou
para a mão" corrigido por destino (`ev.to`). (4) **Textos curtos**:
"⏭ Passando até: <etapa>" e "Capítulo N de X na pilha". (5) **Yield
"Próxima ação"**: `YieldState.kind 'action'` guarda o maior id da pilha
ao começar; qualquer item novo na pilha (mágica, habilidade ou gatilho de
qualquer jogador) interrompe; nunca "chega" sozinho. Verificado no
navegador: Duress contra mão de sete Islands (painel com as sete cartas,
sem alvo, fechado no ✕) e Dread Return por flashback (três Bears
sacrificadas, cemitério aberto sozinho, alvo clicado, criatura de volta ao
campo, carta exilada). Daze e o yield novo: só testes/inspeção. 469
testes (m39 novo).

**v0.30.0 — lista "Blue Dredge" do Lucas** (Moxfield
`AL2eAedrEH68hH4yJOXBlw`, 30 cartas distintas, 60 + 15). Todas já
compilavam full; o simulador do auditor passou em todas (Hogaak "falha"
porque o auditor tenta pagar com mana, o que a carta proíbe — correto).
Testes de comportamento novos (m40) para as oito que não tinham: Cephalid
Coliseum, Otherworldly Gaze, Stern Dismissal, Ashen Rider, Unmask, Careful
Study, Life from the Loam, Hedge Maze. O teste pegou um erro real:
**habilidade de mana com efeito colateral** ("{T}: Add {U}. This land
deals 1 damage to you") não era marcada `isManaAbility`, então ia para a
pilha e não pagava custo automaticamente. Correção em três pontos:
`manaOnly` no parser aceita `damage`/`loseLife` sobre o controlador como
efeito colateral (vale para Ancient Tomb, painlands, City of Brass…);
`tapForMana` (effects.ts) centraliza o tap de um plano de pagamento e
roda esses efeitos colaterais (antes o `payWithPlan` e os quatro pagamentos
internos só somavam mana — Ancient Tomb pagava sem os 2 de dano);
`manaProduction` marca `painful` e o `planPayment` deixa essas fontes por
último (o teste do Price of Progress pegou o planejador preferindo a Tomb
a uma Mountain).

**v0.31.0 — interface** (seis pedidos do Lucas; engine só ganhou dois
campos na view). **Gaea's Will / conjurar do cemitério**: a engine já
tinha a permissão (`graveyardCastPermission`, com `keep` e `lands`), mas
o cliente não oferecia nada; agora `CardView.castableFromGraveyard` e
`playableFromGraveyard` (só para o dono, calculados em `viewFor` com a
mesma regra do `doCastSpell`/`doPlayLand`: permissão do turno, Emry,
Hogaak, Crucible) e o visor do cemitério mostra "⚡ Conjurar do cemitério"
e "🏞 Jogar terreno do cemitério". **Idioma pt-BR/en-US**:
`apps/web/src/i18n.ts` (`t(pt, vars)`, `useLang()`, chave = texto pt-BR,
dicionários por arquivo em `apps/web/src/i18n/en-*.ts`, {KEYS} chaves);
todos os textos do cliente (GameBoard, Lobby, Home, Sideboard, App, log)
passam por `t()`. **Limite conhecido**: textos gerados pela engine
(prompts das escolhas — "escolha 1 carta…", rótulos de habilidade —
"Adicionar {{G}}", descrições de eventos `fizzled`) continuam em
português mesmo em en-US; traduzi-los exige um dicionário na engine ou
chaves estruturadas nos eventos — próximo passo se o Lucas quiser.
**Configurações**: engrenagem ao lado da caixa do chat abre painel com
idioma e as paradas automáticas (o ⏱ saiu da barra). **Layout**: yields
na ordem "⏭ Próxima ação · ⏭ Meu turno · 📌 Prioridade"; contadores de
zona em duas linhas (`.zone-stack`) para os dois jogadores, com ✋ da
própria mão; painel da mão revelada é janela arrastável (cabeçalho com
`pointerdown`) e nasce à direita, sobre a coluna do chat/carta ampliada.

**v0.32.0 — cinco relatos.** **Barrowgoyf**: a CDA compilava certo
(`cdaToughness {plus: 1, of: cardTypesInGraveyard}`), mas
`effectiveToughness` preferia `card.toughness` quando definido — e o
importador transforma "1+*" em 1, então a resistência ficava fixa em 1
(Tarmogoyf idem). Agora a CDA vence o valor impresso em poder e
resistência. **Aventura com mana manual** (Questing Druid → Seek the
Beast): `doCastSpell` troca a face antes de `doCastSpellInner`; com
`manualMana` o pagamento é adiado (`deferPayment` devolve true) e a carta
ficava virada para o verso; ao pagar, o pedido inteiro é reexecutado e
caía em "a carta já está mostrando o verso" — a conjuração falhava e a
mana ficava no pool, o que o Lucas leu como "cobrou os dois custos". A
face agora volta para a frente quando a conjuração é adiada. **Revelação
para o oponente**: evento `cardsRevealed {player, cards, source}` emitido
por Ad Nauseam, Dark Confidant (`revealTopToHandLoseMv`), reveal do
topo N, `revealFromHandRemember` e o gambit; o cliente acumula revelações
seguidas da mesma fonte (Ad Nauseam carta a carta, janela de 20 s) no
mesmo painel arrastável, com título "X revelou — fonte (n)" e ✕. **Mana
com modal aberto**: o fundo de todo `.mulligan-overlay` passou a
`pointer-events: none` (só a caixa captura) e `clickFieldCard`, com uma
decisão aberta (escolha, pergunta, cemitério, lealdade, cor), aceita só o
undo do tap e as habilidades de mana da permanente (menu se houver mais
de uma; `.context-menu` acima dos modais). **Ko-fi**: linha discreta no
rodapé do pop-up de fim de jogo/partida com link para
`https://ko-fi.com/cathar1no`. Verificado no navegador: undo/tap da
Mountain com o cemitério aberto e o rodapé no pop-up de vitória. 482
testes (m41: Barrowgoyf, aventura automática e com mana manual,
Ad Nauseam emitindo `cardsRevealed`).

**v0.33.0 — olhar é diferente de revelar.** Urza's Bauble
(`lookRandomHand`), "look at the top card of target player's library"
(`lookAtTop`) e "look at target player's hand" (Peek, Gitaxian Probe —
antes mapeado para `revealHand`, que revelava para os dois) agora emitem
`cardsLooked {viewer, player, zone, cards, source, hiddenFrom}`; o
`redactEvent` do servidor esvazia `cards` para o outro jogador, então só
quem olhou vê os nomes (no log e no painel). O cliente abre o mesmo painel
arrastável com ✕ para quem olhou ("Urza's Bauble: mão de X (1)" / "…:
topo de X (n)"); o log do outro lado diz apenas "X olhou a mão de Y".
Op novo `lookAtHand`. Verificado no navegador em duas abas com Urza's
Bauble. 483 testes (m41: Bauble e Peek, evento privado e redação).

**v0.34.0 — oito pedidos.** (1) **Formatos de lista**: o `parseDecklist`
só tirava o sufixo `(SET) 123` com código em maiúsculas; o export do
Moxfield/Arena vem `(m3c) 322` — agora qualquer caixa, mais `Nome x4`,
categoria `[Land]` do Archidekt, e o upload aceita `.mwdeck/.cod/.csv`
além de `.txt/.dec/.dek`. O arquivo do Lucas ("Deck - Bant lands") lê 52
+ 15. (2) **Deck apto**: servidor (`buildPool`) e cliente (Lobby) exigem
60+ no principal e sideboard com 15 ou vazio (antes: 20+ e side ≤ 15).
Decisão minha: side vazio continua aceito, para partidas casuais — o
Lucas pediu "menos de 15 não"; se quiser 15 obrigatório, é uma linha.
(3) **Cache de imagens**: o service worker já guarda Scryfall em
CacheFirst por 30 dias (`vite.config.ts`); agora o cliente pré-carrega as
imagens do **próprio** deck (principal + side, 120 ms entre pedidos)
quando a partida começa. O deck do oponente não é pré-carregado de
propósito: a lista dele é informação escondida e apareceria na aba de
rede. Política: o Scryfall recomenda cache local e pede só para não
martelar a API; a Fan Content Policy da Wizards não muda com cache
temporário no navegador. (4) **README**: seção "Como jogar" (só o host
instala; o oponente entra pelo navegador), "Windows e Linux" e "macOS
passo a passo" (Node pelo `.pkg`, Terminal, clone/ZIP, `npm install`,
`npm run build`, `npm start`, firewall, `npm run package` + Gatekeeper).
(5) **Modo lista nos modais**: `DeckModeToggle` (mesma preferência
`sloptcg-deckmode` do sideboard) no visor de cemitério/exílio/sideboard
e no modal de escolha; `CardRow` (nome, custo, tipo, P/T) com o mesmo
clique, alvo e hover da carta. (6) **Pop-ups pequenos** (`.zone-toasts`)
na coluna da direita, sobre a carta ampliada. (7) **Todo modal arrastável
pelo título**: listener delegado de `pointerdown` em `.mulligan-box > h2`
e no título do painel de configurações, movendo por `transform`.
(8) **Vidência/vigiar**: modo `surveil` próprio (texto certo: "vão para o
cemitério") e, quando sobram 2+ cartas no topo, uma segunda escolha
`reorderTop` (`ctx.reorderNext` + `branchOf`) para a ordem — vale para
scry e surveil. Verificado no navegador: recusa do arquivo do Lucas (52
cartas), lista importada, toast à direita, modal em lista e arrastado.
485 testes (m41: vigiar 3 + ordem, vidência 2 + ordem; m17 e m40
ajustados à etapa nova).

**v0.35.0 — leva pesada** (os quatro conceitos grandes que o Lucas pediu
primeiro, mais a carta mais pesada do meta). **Kicker duplo** (Wastescape
Battlemage): `Kicker {G} and/or {1}{U}` → `kicker` + `kicker2`; ação
`castSpell.kickers: number[]`; `obj.kickersPaid`; gatilhos "When you cast
this spell, if it was kicked with its {X} kicker" viram `youCastThis` com
`requiresKicked` + `kickerIndex`, filtrados em `fireCastTriggers`; o
cliente pergunta cada kicker. **Mycosynth Lattice / Painter's Servant**:
`syncGlobalCardMods` no SBA reescreve `types` (Artifact em toda
permanente) e `colors` (incolor / cor escolhida) de **todo objeto em toda
zona**, guardando a definição impressa em `obj.globalPrinted` e marcando
`card.globalMod` (chave do efeito ativo) para reaplicar/reverter; "spend
mana as though it were mana of any color" = `planPayment({anyColor})`
converte as partes coloridas em genérico ({C} continua incolor).
**Opposition Agent**: `searchAgentFor` — na escolha `search`, quem decide
é o controlador do Agent; o que ele achar vai para o exílio com
`exiledAs: 'agent'` e `playableBy`; `doCastSpell`/`doPlayLand` aceitam
carta do oponente nessa condição, com `anyColor`, e a permanente entra
sob o controle de quem conjurou (`obj.controller = item.controller` na
resolução — antes sempre coincidia com o dono). **Companions**: parser
reconhece as duas regras (Yorion: deck com 80+; Jegantha: nenhum símbolo
repetido no custo) — a linha "Companion — …" estava sendo engolida pelo
removedor de palavra de habilidade e pela lista de linhas ignoradas;
`Game.start()` marca `player.companion` se a carta do sideboard cumpre a
regra contra a biblioteca inicial; ação `takeCompanion` ({3}, fase
principal própria, pilha vazia, mana manual via `deferPayment`); botão
"🤝 Nome {3}" na barra do jogador. Yorion: escolha `yorionBlink` (exila
qualquer número de outras não-terreno suas; `state.delayed` devolve no
fim do turno). Jegantha: `addMana.noGeneric` alimenta
`player.manaPoolRestricted`; `planPayment` consome o pool restrito só em
partes coloridas (`fromRestricted`), `consumePlanPools` centraliza os
cinco pontos de pagamento; o pool restrito zera junto com o normal; chip
com 🔒 no cliente. Verificado no navegador: companion detectado no
início, botão pagou {3} em mana manual e trouxe Yorion; os dois prompts
de kicker do Battlemage. Auditor: 13.801 full / 14.516 parciais / 4.764
manuais, 0 estruturais, 39 de simulação. Legacy 97,5% → 97,8% (383 de
509 full, 126 com lacuna). 492 testes (m42).

**v0.36.0 — as 30 mais pesadas do Legacy + Karn × Lattice.** Lucas pediu
para confirmar a interação Karn, the Great Creator + Mycosynth Lattice
(todas as permanentes do oponente viram artefatos e perdem as habilidades
ativadas, terrenos inclusive) e para fechar as 30 cartas de maior peso
restantes de uma vez. **Karn × Lattice**: a ativação manual já era
bloqueada; faltavam dois caminhos — o pagamento automático
(`planPayment` agora filtra fontes com `manaAbilityLocked`: trava de
artefato do Karn/Stony Silence, trava por tipo, Dress Down) e o
movimento manual para o campo, que não rodava a sincronização de tipos
da Lattice (`manualMove` para/do campo agora chama
`checkStateBasedActions`). Verificado no navegador: Forest do oponente
responde "habilidades ativadas de artefatos não podem ser ativadas".
**As 30**: Cloak and Dagger (`cloakExile` — exila carta da mão ou a
criatura escolhida até sair; carta da mão volta para a mão,
`exiledUntilLeavesToHand`), Invasion Submersible (custo `waterbend` vira
artefatos/criaturas; `Exhaust` = `oncePerGame`), Tezzeret, Cruel Captain
(emblema em `player.emblems`, gatilho no início do combate com fonte −1),
Kaito, Bane of Nightmares (`conditionalCreature` sincronizado no SBA;
emblema anthem de Ninjas), Grist (`creatureOffBattlefield`; `gristMill`
repete enquanto moer Inseto), Pact of Negation (`payOrElse` na
manutenção → `loseGame`), Creative Technique (`demonstrate` + discover
sem limite), Throes of Chaos (só cascade — auditor aceita mágica sem
efeito com cascade), Nomads en-Kor (`redirectNextDamage`, loop em
`dealDamageToObject`), Allosaurus Shepherd (`uncounterableColors` +
`setBaseUntilEot` Elfos 5/5 Dinossauro), Goryo's Vengeance (Splice
ignorado), Putrid Imp (regra de threshold antes da gramática "As long
as"), Arena of Glory (`exertSelf` + `addMana.hasteIfCreature`), Phyrexian
Dragon Engine (`etb.fromGraveyard` via `enteredFrom`), Agatha's Soul
Cauldron (`reflexiveTargeted`; `syncCauldron` concede habilidades das
criaturas exiladas a quem tem marcador +1/+1; mana de qualquer cor para
habilidades de criaturas), Boomerang Basics (`targetControlledByYou`),
Prismari Charm (dano a um ou dois alvos), It That Heralds the End
(redução para incolor 7+), Mistrise Village (`nextSpellUncounterable`),
Tibalt's Trickery (`tibaltTrickery`: mói 1–3 ao acaso, exila até
não-terreno de nome diferente, controlador conjura de graça, resto no
fundo), Back to Basics (`noUntapNonbasicLands` no desvirar), Teferi, Time
Raveler (`opponentsSorcerySpeedOnly`; +1 `sorceriesFlashUntilNextTurn`),
Dress Down (`creaturesLoseAbilities` — `losesAllAbilities` em keywords,
estáticas, gatilhos, ativadas e mana), Witherbloom Command (moer +
`returnFromGraveyardChoice`), Brotherhood's End (dano em criaturas e
planeswalkers), Cling to Dust (`targetIsCreatureCard`), Breakthrough
(`keepXDiscardRest`), Snapcaster Mage (`grantFlashbackUntilEot` — o
flashback concedido é aplicado antes de ler `card` em `doCastSpell`),
Sheoldred, the Apocalypse (`opponentDrawsCard`). Auditor: 13.857 full /
14.495 parciais / 4.729 manuais, 0 estruturais, 39 de simulação. Legacy
97,8% → 98,9% (414 de 509 full, 95 com lacuna). 521 testes (m43: 29).

**v0.37.0 — Manamorphose, Borne Upon a Wind, Undermountain Adventurer,
Lavinia, Void Mirror.** Os cinco próximos pesos do Legacy. **Mana gasta
por mágica**: `obj.manaSpent` (símbolos do custo, descontando phyrexianos
pagos com vida) e `obj.colorsSpent` (cores distintas gastas) são zerados
no início de toda conjuração e em `castCardFree`, para que "if no mana was
spent" / "if no colored mana was spent" enxerguem conjuração de graça,
custo {0} e pagamento só com incolor. Condições `triggeringNoManaSpent` e
`triggeringNoColoredManaSpent` são intervenientes: `pushTrigger` avalia
com o sujeito do gatilho (o gatilho nem entra na pilha se a condição
falha). **Lavinia**: `laviniaCap` em `doCastSpell` (não-criatura com valor
de mana, X incluído, maior que os terrenos do conjurador) + gatilho
`opponentCastsSpell` que anula (`counterSpell` em `triggering`). **Void
Mirror**: `anyCastsSpell` com a condição de cor. **Manamorphose**: "Add
two mana in any combination of colors" vira dois `addManaChoice`, cada um
com o seu `chooseColor`. **Borne Upon a Wind**: `spellsFlashThisTurn` →
`player.spellsAsFlashTurn`, lido junto de `flashSorcery` no timing de
conjuração (pré-passe em `parseEffectText`, porque "You may cast…" era
tratado como permissão estática). **Undermountain Adventurer**: habilidade
de mana `addMana {G}{G}` + `if completedDungeon` com mais quatro {G} (o
auditor exige `addMana` no nível de cima da habilidade de mana). Verificado
no navegador: Void Mirror anulou Ornithopter {0}; Lightning Bolt pago com
Mountain resolveu sem gatilho. Auditor: 13.876 full / 14.480 parciais /
4.725 manuais, 0 estruturais, 39 de simulação. Legacy 98,9% → 99,0% (419
de 509 full, 90 com lacuna). 529 testes (m44: 7).

**v0.38.0 — Sheltered by Ghosts, Chancellor of the Annex, Call Forth the
Tempest, Curie, Abhorrent Oculus.** **Manifestar pavor** (Oculus): op de
escolha `manifestDread` — olha as duas do topo, a escolhida entra virada
para baixo como 2/2 (`obj.faceDown` + `obj.manifested`), a outra vai para
o cemitério; `turnFaceUp` aceita carta manifestada que seja criatura,
pagando o custo de mana (morph continua pelo custo de morph); a carta
volta a ficar virada para cima ao sair do campo (`moveWithEvent`);
`pushTrigger` ignora permanentes viradas para baixo (sem habilidades);
`CardView.manifested` e botão "🔓 Virar para cima" no cliente.
**Chancellor**: `card.chancellor = { cost }`; ao manter a mão inicial, a
carta é revelada automaticamente (`obj.chancellorRevealed`, evento
`cardsRevealed`) e a primeira mágica do oponente recebe o gatilho
`counterUnlessPay` a partir da carta na mão (`chancellorUsed`); a linha
"Whenever an opponent casts a spell, counter it unless that player pays"
virou regra explícita — a gramática antiga anulava a própria Chancellor
(pronome "it" resolvido como `self`) e pedia o pagamento ao controlador
errado. **Call Forth the Tempest**: `player.mvCastThisTurn` acumula o
valor de mana de cada mágica conjurada (paga ou de graça, X incluído) e
zera na limpeza; `DynAmount.mvOtherSpellsCastThisTurn` desconta a própria.
**Curie**: custo `exile` em habilidade ativada (escolhido como sacrifício;
`StackItem.costExiledId` → `ctx.costExiledId`); `becomeCopy` com
`fromCostExile` + `keep: 'triggered'` (mantém o gatilho de compra, não a
ativada); `DynAmount.basePowerOf` usa `basePowerOf()` extraído de
`effectivePower`. **Sheltered by Ghosts**: "gets +N/+N and has K and ward
{N}" em `attachEffect` (ward já era cobrado em `wardTax`). **UI**: o
pop-up da pilha saiu do centro (cobria Passar/Resolver em 1024×768 e
1280×720) e foi para a coluna da direita, como os outros pop-ups.
Verificado no navegador: manifestar pavor ponta a ponta (decisão, 2/2
virada, oponente vê "Carta virada para baixo", virar para cima por {2}{U})
e o pop-up da pilha na direita com o botão livre. Auditor: 13.890 full /
14.471 parciais / 4.720 manuais, 0 estruturais, 40 de simulação (a nova
é o simulador não escolher o custo de exílio da Curie, como já acontece
com estacionar). Legacy 99,0% → 99,1% (424 de 509 full, 85 com lacuna).
535 testes (m45: 7).

**v0.38.1 — mensagem de deck curto com a conta.** Lucas reportou que os
arquivos "Deck - Bant lands.txt" e "Deck - Jund.txt" "dão erro e sobem
menos cartas" (52 e 56). Verificado: os arquivos têm mesmo 52+15 e 56+12
(sem BOM, sem linha escondida, sem caractere estranho; parser reconhece
as 27 linhas de cada main, incluindo "Minsc & Boo, Timeless Heroes" e
código de coleção "40k"). O "erro" é a validação de deck apto da v0.34
(mínimo 60 no main; sideboard 0 ou 15). A mensagem agora mostra a conta
— "deck com 52 cartas no main (27 linhas somadas) e 15 no sideboard —
precisa de pelo menos 60 no main" — para o motivo ficar evidente sem
abrir o arquivo. Verificado no navegador colando o texto do Bant.
 Auditor: 13.795 full / 14.522 parciais / 4.764
manuais, 0 estruturais, 39 falhas de simulação. Legacy 97,5% (igual).
478 testes.

Fora do escopo por enquanto: Mutate, Phasing, Banding, Ward—Discard,
Conspire, Splice, Strive, Companion, Meld, mecânicas Alchemy.

## Regras de trabalho por leva
1. `node scripts/audit-cards.mjs` no começo (baseline) e no fim (medida).
2. Zero crash, zero problema estrutural, e cada nova mecânica com teste em
   `packages/engine/test/`.
3. Toda mecânica que envolva escolha do jogador precisa do overlay no
   cliente (`GameBoard.tsx`) — sem UI, a engine trava esperando resposta.
4. Atualizar a tabela acima e a nota do projeto no vault.
