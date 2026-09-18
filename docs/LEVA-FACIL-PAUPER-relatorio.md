# Leva fácil (Pauper) — relatório

Início: 2026-09-18 · Modelo: Opus 5 · Última atualização: 2026-09-18

Mesma fronteira e mesmo critério de `docs/LEVA-FACIL.md`, aplicados a
`data/meta/pauper-gap.md`. Ponto de partida: 457 cartas distintas do meta,
298 full, **159 com lacuna**, cobertura ponderada **72,1%**.

## Feitas
| Carta | Peso | Release | Regra (uma linha) |
|---|---|---|---|
| Lava Dart | 57.2 | v0.45.0 | `Flashback—Sacrifice a <permanente>` passou a aceitar qualquer nome de permanente (era só criatura) |
| Tolarian Terror | 49.2 | v0.45.0 | `parseNounG` passou a ler "instant **and** sorcery cards" como união de tipos → `costModifiers.perGraveyard` |
| Ichor Wellspring | 45.4 | v0.45.0 | `When ~ enters **or is put into a graveyard from the battlefield**, <corpo>` vira gatilho de `etb` + `dies` |
| Cryptic Serpent | 44.8 | v0.45.0 | mesma união de tipos do Tolarian Terror |
| Ancient Stirrings | 38.8 | v0.45.0 | linha única de mágica → `digTop count:5 pick:1 filter:{colorless}` |
| Bramble Wurm | 38.8 | v0.45.0 | forma geral de `{custo}, Exile this card from your graveyard: <efeito>` (corpo lido pelo parser de efeitos) |
| Lead the Stampede | 37.7 | v0.45.0 | `digTop count:5 pick:5 filter:{creature}` ("qualquer número" = tudo o que foi olhado) |
| Reckoner's Bargain | 27.8 | v0.45.0 | `gainLife { sacrificedManaValuePlus: 0 }` + `draw 2` (o custo adicional de sacrifício já era lido) |
| Augur of Bolas | 25.2 | v0.45.0 | o final "on the bottom of your library **in any order**" passou a ser aceito no `digTop` da gramática |
| Lembas | 23.7 | v0.45.0 | gatilho `dies` → `shuffleSelfIntoLibrary` |
| Dust to Dust | 14.9 | v0.45.0 | dois alvos de artefato na mesma mágica → dois `exile` |
| Melded Moxite | 7.2 | v0.45.0 | `{custo}, Sacrifice ~` → ficha de artefato-criatura **virada** |
| Nylea's Disciple | 6.2 | v0.45.0 | `gainLife { devotion: 'G' }` |
| Ethereal Armor | 9.2 | v0.45.0 | `parseStaticG` passou a ler keywords no fim do "gets +1/+1 for each … **and has** …" |
| Lotleth Giant | 7.8 | v0.45.0 | `damage` com `{ graveyardCount: 'controller', filter: { what: 'creature' } }` |
| God-Pharaoh's Faithful | 5.6 | v0.46.0 | gatilho `youCastSpellOf` com `filter.colorAnyOf` a partir de "a blue, black, or red spell" |
| Sunscape / Thornscape / Nightscape / Stormscape / Thunderscape Familiar | 5.6 | v0.46.0 | `costModifiers` com `filter.colorAnyOf` a partir de "X spells and Y spells you cast cost {1} less" |
| Goblin Anarchomancer | 4.0 | v0.46.0 | mesma regra, na redação "Each spell you cast that's red or green" |
| Guardians' Pledge | 4.4 | v0.46.0 | `pumpEach` com filtro de cor ("White creatures you control get +2/+2") |
| Holy Light | 2.2 | v0.46.0 | mesma regra, com `notColor` ("Nonwhite creatures get -1/-1") |
| Sea Gate Oracle | 4.2 | v0.46.0 | o `digTop` da gramática passou a aceitar "…and the **other** on the bottom of your library" |
| Words of Wisdom | 1.1 | v0.46.0 | `draw` para o controlador + `draw` para o oponente |
| Sylvok Lifestaff | 0.4 | v0.46.0 | gatilho `hostDies` com o corpo lido pelo parser de efeitos |
| Kruphix's Insight | 2.3 | v0.46.0 | `digTop count:6 pick:3 filter:{enchantment} rest:'graveyard'` |
| Ghostly Flicker | 2.0 | v0.46.0 | dois alvos + dois `blink` |
| Visionary's Dance | 0.6 | v0.46.0 | habilidade ativada **da mão** com `discardSelf` → `digTop` |
| Nested Shambler | 3.2 | v0.46.0 | `token` com `count: { powerOf: 'self' }` e `tapped` |
| Pestilence | 2.1 | v0.46.0 | gatilho `endStep` com `Cond.compare` ("nenhuma criatura em jogo") → `sacrificeSelf` |
| Aurora Eidolon / Sandstorm Eidolon | 2.0 / 1.0 | v0.46.0 | gatilho com `zone: 'graveyard'` + `mayDo` → `returnToHand` |
| Fanged Flames | 3.5 | v0.46.0 | `damage` com `exileIfDies: true` |
| Rally at the Hornburg | 16.0 | v0.46.0 | fichas + `pumpEach` por subtipo com keyword, na mesma linha |
| Reckless Impulse | 12.0 | v0.46.0 | `impulse { untilNextEndStep: true }` (aceita as duas ordens de frase) |
| Clockwork Percussionist | 16.0 | v0.46.0 | mesma regra do Reckless Impulse, disparada por `dies` |
| Defile | 7.8 | v0.46.0 | `pump` com `powerDyn: { times: -1, of: { per: Pântanos que você controla } }` |
| End the Festivities | 6.9 | v0.46.0 | `damage` no oponente + `damageEach` nas permanentes dele |

### Ganho colateral
As regras gerais valem para muito mais que a lista do Pauper: **78 cartas** na
v0.45.0 e mais **57** na v0.46.0 ficaram full de brinde. Entre elas Cleansing Nova,
Devastation, Purify, Powder Keg, Awakening (união "artifacts **and** enchantments" /
"creatures **and** lands"), Enigma Drake, Haughty Djinn, Spellheart Chimera, Bedlam
Reveler (contagem de "instant and sorcery cards" no cemitério), Commune with Nature,
Adventurous Impulse, Bond of Flourishing, Seek the Wilds, Peer Through Depths,
Glint-Nest Crane, Sleight of Hand, Sight Beyond Sight (o `digTop`), Blanchwood Armor,
All That Glitters, Empyrial Armor (keywords junto do bônus por contagem), Skullclamp,
Original Skullclamp, Oathkeeper, Malefic Scythe, Eater of Virtue (gatilho da criatura
equipada morrendo), Light Up the Stage, Wrenn's Resolve, Dark Bargain, Irradiate,
Pyrohemia, Call to the Grave, Festergloom e Into the Core.

## Não fáceis (para o Fable 5.1)
| Carta | Peso | O que falta na engine | Sugestão de op / mecanismo |
|---|---|---|---|
| Highway Robbery | 59.2 | escolha entre dois custos diferentes ("descarte uma carta **ou** sacrifique um terreno") antes do efeito | `op: 'chooseCost'` (modo com custos, não com efeitos) |
| Grab the Prize | 59.2 | não há condição sobre o **tipo da carta descartada** como custo adicional | `Cond { kind: 'discardedWasType'; types: CardType[] }` |
| Refurbished Familiar | 52.0 | "para cada oponente que não puder descartar, compre" — falta a condição de mão vazia por oponente | `op: 'discardElseDraw'` ou `Cond { kind: 'handEmpty'; who }` |
| Relic of Progenitus | 44.2 | "o jogador alvo exila **uma carta** do próprio cemitério" (escolha dele) | `op: 'exileFromGraveyardChoice'; who: WhoSel; count` |
| Dispel | 44.1 | `TargetSpec.spellType` só tem `creature`/`noncreature`/`instantSorcery` | acrescentar `instant`, `sorcery`, `artifact`, `enchantment` |
| Fireblast | 41.7 | `altCost` não tem sacrifício como custo alternativo | `altCost.sacrifice: { filter: FilterSpec; count: number }` |
| Winding Way | 37.7 | modo escolhido + "**todas** as cartas do tipo revelado para a mão, o resto para o cemitério" (o `digTop` é "até N", escolha do jogador) | `digTop { forced: true }` ou `op: 'revealTopSplitByType'` |
| Nyxborn Hydra | 35.2 | aura cujo bônus depende de marcadores **na própria aura** e concede duas keywords | `attachEffect.powerPerCounterOnSelf` existe; falta combinar com `keywords` na mesma linha de bestow |
| Masked Vandal | 34.4 | custo opcional "exile uma criatura do cemitério" dentro do gatilho, com alvo condicionado | `op: 'mayDo'` com custo de exílio do cemitério |
| Unfathomable Truths | 29.4 | ficha Eldrazi Spawn com habilidade de sacrifício por mana | `token.abilities` existe; falta a regra de texto dessa ficha nomeada |
| Spellstutter Sprite | 28.0 | anular mágica com valor de mana ≤ X onde X conta Faeries em jogo | `TargetSpec.cmcAtMostCount: FilterSpec` (e checar mv no ramo de mágicas) |
| Searing Blaze | 27.8 | dois alvos ligados (o jogador e uma criatura **daquele** jogador) | `TargetSpec.controlledByTarget: number` |
| Bonder's Ornament | 27.8 | "cada jogador que controla uma permanente com este nome" | `FilterSpec.sameNameAsSource` |
| Utopia Sprawl / Wild Growth | 27.2 / 13.5 | não há gatilho de "terreno encantado virado para mana" | `attachEffect.extraManaOnTap: Color \| 'chosen'` |
| Steel Sabotage / Annul / Envelop | 25.9 / 6.1 / 9.3 | ver Dispel (tipo de mágica no alvo) | idem |
| Cast into the Fire | 25.1 | "dano a cada uma de até duas criaturas alvo" | `TargetSpec.upTo: number` com efeito por alvo |
| Skred | 22.8 | não há contagem de permanentes de neve | `FilterSpec.snow` |
| Deem Inferior | 22.4 | redução por cartas compradas no turno | `costModifiers.perCardsDrawnThisTurn` |
| Moon-Circuit Hacker | 22.4 | "descarte a menos que tenha entrado neste turno" | `Cond { kind: 'sourceEnteredThisTurn' }` |
| Prismatic Strands | 21.1 | prevenir todo dano de fontes de uma cor escolhida | `op: 'preventFromColorThisTurn'` |
| Land Grant | 20.6 | custo alternativo "revele a mão se não tiver terrenos" | `altCost.revealHandIfNoLands` |
| Thraben Charm | 19.8 | "exile os cemitérios de qualquer número de jogadores alvo" | alvo de jogador em quantidade variável |
| Wall of Roots | 17.0 | custo que **põe** um marcador (não remove) | `cost.putCounters: { counter: string; count: number }` |
| Cryoshatter | 16.8 | gatilho "quando a criatura encantada vira ou recebe dano" | `hostBecomesTapped` / `hostDealtDamage` combinados |
| Faerie Miscreant | 16.8 | condição "você controla outra criatura com este nome" | `Cond { kind: 'controlsAnotherNamed' }` |
| Of One Mind | 16.8 | redução condicionada a controlar Humano **e** não-Humano | `costModifiers.condition: Cond` |
| Inventor's Axe | 16.0 | custo de equipar pago com energia | `equipCost.energy` |
| Balustrade Spy | 15.6 | moer até revelar um terreno | `op: 'millUntil'; filter` |
| Mesmeric Fiend | 14.4 | escolher carta da mão do oponente e exilar até a fonte sair | `op: 'exileFromHandUntilLeaves'` |
| Smash to Smithereens | 13.9 | `damage.to` é `SubjectRef` e não aceita `controllerOf:0` | permitir `controllerOf:${n}` em `SubjectRef` |
| Thermokarst | 13.6 | ver Skred (permanentes/terrenos de neve) | `FilterSpec.snow` |
| Monstrous Emergence | 13.4 | custo adicional "escolha uma criatura sua **ou** revele uma da mão" | ver Highway Robbery |
| Kenku Artificer | 12.3 | marcadores + virar artefato em criatura 0/0 voadora | `animatePermanent` sem duração + `putCounters` no mesmo alvo |
| Gingerbrute | 12.0 | "não pode ser bloqueada exceto por criaturas com ímpeto" | `flags.cantBeBlockedExceptKeyword: Keyword` |
| Battle Screech | 12.0 | flashback pago virando três criaturas brancas | `flashback.tapCreatures: { count: number; filter: FilterSpec }` |
| Lunarch Veteran | 12.0 | gatilho global de `leaves` não existe (só o próprio) | `fireZoneTriggers` também para `leaves` |
| Vitu-Ghazi Inspector | 11.4 | mecânica collect evidence | mecânica nova |
| Bender's Waterskin | 10.5 | "desvire durante o passo de desvirar de cada outro jogador" | `flags.untapDuringEachUntapStep` |
| Eldrazi Repurposer | 10.1 | ficha Eldrazi Spawn nomeada (ver Unfathomable Truths) | idem |
| Call Damage Control | 9.8 | "escolha até duas" entre modos que referenciam cartas do cemitério | modos com alvo variável |
| Haunted Fengraf | 9.7 | devolver carta **ao acaso** do cemitério | `op: 'returnRandomFromGraveyard'` |
| Kaervek's Torch | 9.7 | taxa sobre mágicas que têm a própria mágica como alvo, na pilha | `costModifiers.targetsSelf` existe para permanentes; falta para mágica na pilha |
| Flaring Pain | 9.6 | "o dano não pode ser prevenido neste turno" | `flags.damageCantBePrevented` |
| Ancestral Mask | 9.2 | `powerPer` vale +1 por objeto; aqui é +2 | `StaticAbility.powerPerAmount: number` |
| Abundant Growth | 9.2 | aura não concede habilidades ao hospedeiro | `attachEffect.grantAbilities: AbilityDef[]` |
| Tithing Blade | 9.1 | mecânica craft | mecânica nova |
| Campfire | 8.9 | zona de comando | fora do escopo (Commander) |
| Spreading Seas | 8.4 | aura não muda o tipo do terreno encantado | `attachEffect.becomesSubtype: string` |
| Citadel Gate / Cliffgate | 8.0 / 6.0 | `chooseOnEnter: 'color'` existe, mas não "cor **diferente de** X" | `chooseOnEnter: { kind: 'color'; except: Color }` |
| Extract a Confession | 7.8 | collect evidence | mecânica nova |
| Crypt Rats | 7.8 | "gaste apenas mana preta em X" | `cost.manaRestriction: Color` |
| Ride's End | 7.0 | redução se o alvo estiver virado | `costModifiers.ifTargetTapped` |
| Snap | 6.5 | "desvire até dois terrenos" sem alvo (escolha livre) | `op: 'untapChoice'; count; filter` |
| Standard Bearer | 6.3 | regra de escolha de alvo forçada (flagbearer) | mecânica nova |
| Deglamer | 5.6 | embaralhar **o alvo** no grimório do dono | `op: 'shuffleTargetIntoLibrary'` |
| Glint Hawk | 6.0 | "sacrifique a menos que devolva um artefato seu" | `op: 'sacrificeUnlessReturn'` |

## Tentadas e revertidas
| Carta | O que aconteceu |
|---|---|

## Situação
- Cartas da lista processadas: **121 de 159** (37 feitas; 55 linhas de "não fáceis",
  algumas cobrindo mais de uma carta). Restam 121 na lista regenerada; as de peso ≤ 0,5
  ainda não foram lidas uma a uma.
- Releases publicadas: v0.45.0 e v0.46.0
- Totais do auditor na última release: 14.048 full / 14.372 parciais / 4.661 manuais /
  0 estruturais / 42 falhas de simulação
- As 42 falhas de simulação são as mesmas da v0.45.0 — nenhuma nova nesta leva.
  A única acrescentada desde a v0.44.0 é **Melek, Reforged Researcher**: com a união de
  tipos, o `cdaPower/cdaToughness` dela passou a compilar ("o dobro do número de cartas
  de instantâneo e feitiço no seu cemitério"). No cenário do auditor o cemitério está
  vazio, então ela entra 0/0 e morre — comportamento **correto** de Magic, igual aos 17
  casos já presentes nesse mesmo balde (Splinterfright, Boneyard Wurm, Uro, Kroxa…).
  A carta saiu de manual para parcial: é ganho, não regressão.
- Cobertura ponderada do Pauper: 72,1% → 78,9% (v0.45.0) → **80,5%** (v0.46.0);
  cartas full do meta Pauper: 298 → 336 (lacunas 159 → 121). Legacy segue em 99,2%.
- Diff de compilação das 38.629 cartas em cada release: nenhuma carta perdeu automação.
  Na v0.46.0, a primeira versão da regra do Rally at the Hornburg derrubou o Grand
  Crescendo ("Create **X** 1/1 …") de full para injogável; corrigida movendo as guardas
  para a **condição** do `if`, de modo que uma regra que não casa inteira deixa a linha
  seguir para as regras seguintes em vez de reprovar a carta.
