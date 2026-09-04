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

## Estado (2026-09-04, v0.25.0 — listas do Lucas 2 + Moxfield por URL, Legacy a 95,4%)

| 33.085 cartas jogáveis | v0.5 | v0.6 | v0.7 | v0.8 (L1) | v0.9 (L2) | v0.10 (L3) | v0.11 (L3 completa) | v0.12 (Leva 4) | v0.13 (L5a) | v0.14 (L5b · faces) | v0.15 (L6a · Legacy) | v0.16 (L6a·3 · sideboard) | v0.17 (L6a·4) | v0.18 (L6a·5) | v0.19 (L6a·6) | v0.21.1 (L6a·7) | v0.22 (L6a·8) | v0.23 (L6a·9) | v0.24 | **v0.25** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Totalmente automatizadas | 1.804 | 5.011 | 5.554 | 6.275 | 6.696 | 7.062 | 7.136 | 10.296 | 11.800 | 12.170 | 12.787 | 13.022 | 13.110 | 13.175 | 13.250 | 13.288 | 13.344 | 13.534 | 13.600 | **13.690** |
| Parciais (jogáveis, alguma linha manual) | 21.602 | 20.566 | 20.873 | 20.182 | 19.788 | 19.464 | 19.400 | 16.960 | 15.772 | 15.620 | 15.275 | 15.101 | 15.034 | 14.971 | 14.909 | 14.883 | 14.849 | 14.719 | 14.670 | **14.605** |
| Manuais | 8.739 | 6.637 | 6.596 | 6.566 | 6.539 | 6.497 | 6.487 | 5.769 | 5.453 | 5.290 | 5.018 | 4.957 | 4.936 | 4.934 | 4.921 | 4.909 | 4.887 | 4.827 | 4.811 | **4.786** |
| Dupla-face manuais | 864 | 864 | 55 | 55 | 55 | 55 | 55 | 55 | 55 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **0** |

**Métrica nova (Leva 6): cobertura ponderada pelo metagame** — `node
scripts/meta-gap.mjs --format <formato>` baixa o metagame do MTGGoldfish e
mede quanto do que se joga já é full (META% × cópias). Legacy: **43,7% →
67,1%** na v0.15.0, **78,8%** na v0.15.1, **86,0%** na v0.16.0, **88,6%** na v0.17.0, **90,5%** na v0.18.0, **92,0%** na v0.19.0, **92,4%** na v0.21.0, **92,8%** na v0.22.0, **94,9%** na v0.23.0, **95,1%** na v0.24.0 e **95,4%** na v0.25.0. Relatórios em `data/meta/<formato>-gap.md`.

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

Fora do escopo por enquanto: Mutate, Phasing, Banding, Ward—Discard,
Conspire, Splice, Strive, Companion, Meld, mecânicas Alchemy.

## Regras de trabalho por leva
1. `node scripts/audit-cards.mjs` no começo (baseline) e no fim (medida).
2. Zero crash, zero problema estrutural, e cada nova mecânica com teste em
   `packages/engine/test/`.
3. Toda mecânica que envolva escolha do jogador precisa do overlay no
   cliente (`GameBoard.tsx`) — sem UI, a engine trava esperando resposta.
4. Atualizar a tabela acima e a nota do projeto no vault.
