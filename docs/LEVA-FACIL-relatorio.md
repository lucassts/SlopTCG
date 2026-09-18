# Leva fácil — relatório

Início: 2026-09-18 · Modelo: Opus 5 · Última atualização: 2026-09-18

## Feitas
| Carta | Peso | Release | Regra (uma linha) |
|---|---|---|---|
| Craterhoof Behemoth | 1.2 | v0.44.0 | ETB → `forEach` nas criaturas suas + `pump` com `powerDyn/toughnessDyn: { per: criaturas que você controla }` e `trample` |
| Koma, World-Eater | 1.2 | v0.44.0 | dano de combate ao jogador → `token` com nome derivado do nome curto da carta (`~'s Coil` → `Koma's Coil`, via `ParseState.shortName`) |
| Conjurer's Bauble | 1.2 | v0.44.0 | `{T}, Sacrifice ~` → alvo opcional no cemitério + `putOnLibraryBottom` + `draw` |
| Runehorn Hellkite | 1.1 | v0.44.0 | habilidade ativada do cemitério com `exileSelf` → `discardHand who:'each'` + `draw who:'each' count:7` |
| Firemind's Foresight | 1.1 | v0.44.0 | três `search` encadeados com `filter.cmcEquals` 3, 2 e 1 (cada busca já embaralha) |
| Loran of the Third Path | 0.4 | v0.44.0 | ETB `destroy` com alvo opcional artefato/encantamento + `{T}`: `draw` para o controlador e para o oponente alvo |
| Parallax Wave | 0.4 | v0.44.0 | gatilho `leaves` → `returnExiledBy to:'battlefield'` (o `exile` comum já grava `exiledBy`) |
| Jack-o'-Lantern | 0.6 | v0.44.0 | habilidade de mana do cemitério com `exileSelf` → `addManaChoice` |
| Lavaspur Boots | 0.1 | v0.44.0 | `attachEffect` com `power/toughness`, `keywords` e `ward` numérico |
| Cityscape Leveler | 0.3 | v0.44.0 | `When you cast ~ and whenever <X>, <corpo>` vira dois gatilhos com o mesmo corpo (o corpo já compilava sozinho) |

Ganho colateral da mesma leva (fora da lista, mas full agora): Parallax Tide,
Falcon's Wing Harness, Krydle of Baldur's Gate, Gimli of the Glittering Caves,
Beregond of the Guard, Karlov of the Ghost Council, Braulios of Pheres Band,
Iwamori of the Open Fist, Veldrane of Sengir, Tivadar of Thorn.

### Correção de parser que destravou várias lendárias
O texto oracle de lendárias no formato `Nome of …` (Loran of the Third Path,
Svyelun of Sea and Sky, Purraj of Urborg) cita a carta pelo primeiro nome, que o
normalizador não trocava por `~`. Pior: `Purraj has first strike…` compilava como
estática sobre um **subtipo** inexistente chamado "Purraj" — automação errada e
silenciosa. A normalização passou a considerar o primeiro termo como apelido
quando a carta é **criatura lendária** com nome `Palavra of …`. Verificado por
diff de compilação das 38.629 cartas: 24 mudaram, nenhuma perdeu automação.

## Não fáceis (para o Fable 5.1)
| Carta | Peso | O que falta na engine | Sugestão de op / mecanismo |
|---|---|---|---|
| Phyrexian Dreadnought | 1.2 | não há como pedir "sacrifique quantas criaturas quiser com poder total ≥ N ou sacrifique isto" | `op: 'sacrificeUnlessTotalPower'` (escolha múltipla com soma de poder) |
| Alpha Deathclaw | 1.2 | não existe gatilho `becomesMonstrous` (monstruosidade só existe como `putCountersOnce`) | `TriggerSpec { on: 'becomesMonstrous', self: true }` |
| Chain of Smog | 1.2 | `chainCopy` é específico de dano (Chain Lightning) | generalizar para `chainCopy { by: 'affectedPlayer', free: true }` com novo alvo |
| Silvergill Adept | 1.2 | `additionalCost` não tem "revelar carta da mão" nem alternativa "ou pague {N}" | `additionalCost.reveal: FilterSpec` + `additionalCost.orPayMana: string` |
| Sylvan Library | 1.2 | nenhum op para "compre duas a mais e, por carta comprada neste turno, pague 4 de vida ou devolva ao topo" | `op: 'sylvanLibrary'` (ou `chooseDrawnThisTurn` + `payOrElse` por carta) |
| Balustrade Spy | 1.2 | não há op de "moer até revelar um terreno" | `op: 'millUntil'; filter: FilterSpec; who: WhoSel` |
| Lively Dirge | 1.2 | kicker que devolve duas criaturas do cemitério com valor de mana **somado** ≤ N | `op: 'returnFromGraveyardTotalMv'` |
| Agadeem's Awakening | 1.2 | devolver N criaturas com valores de mana **distintos** ≤ X | `op: 'returnFromGraveyardDistinctMv'` |
| Vampire Hexmage | 1.2 | `removeCounters` remove um tipo de marcador só | `op: 'removeAllCounters'; what: SubjectRef` |
| Six | 1.2 | retrace para cartas no cemitério durante seu turno | mecânica nova (retrace concedido) |
| Mystic Forge | 1.1 | `castFromLibraryTop` é um único `FilterSpec`; "artefato **ou** incolor" é disjunção | `FilterSpec.anyOf: FilterSpec[]` |
| Mishra's Research Desk | 1.1 | `impulse` libera todas as cartas exiladas; aqui só uma delas, escolhida | `impulse { chooseOne: true }` |
| Into the Flood Maw | 1.1 | mecânica gift | `kicker.gift` existe, mas falta o efeito alternativo "em vez disso" com alvo diferente |
| Shadowspear | 1.1 | não há como remover hexproof/indestructible de permanentes | `op: 'loseKeywordsUntilEot'; filter; keywords` |
| Unite the Coalition | 1.1 | "escolha cinco, podendo repetir o modo" | `spellModeChoice { count: 5, repeat: true }` |
| Shared Summons | 1.1 | `search` não sabe exigir **nomes diferentes** | `search { distinctNames: true }` |
| Legolas's Quick Reflexes | 1.0 | conceder habilidade disparada com gatilho `becomesTapped` até o fim do turno | `grantAbility` já existe; falta a regra de texto compor o gatilho aninhado |
| Not of This World | 1.0 | anular habilidade/mágica **que tenha como alvo** uma permanente sua | `TargetSpec.targetsYourPermanent: true` |
| Liquimetal Coating | 1.0 | `animatePermanent` é permanente, sem duração | `animatePermanent { duration: 'eot' }` |
| Forth Eorlingas! | 1.0 | gatilho atrasado "sempre que criaturas suas causarem dano de combate neste turno" | `op: 'delayed'` com gatilho `yourCreatureCombatDamageToPlayer` |
| Yuriko, the Tiger's Shadow | 1.0 | commander ninjutsu | mecânica nova |
| Ingenious Infiltrator | 1.0 | `on: 'yourCreatureCombatDamageToPlayer'` não aceita filtro | acrescentar `filter?: FilterSpec` a esse gatilho |
| Glamer Gifter | 1.0 | `setBaseUntilEot` opera por filtro, não por alvo, e não sabe "todos os tipos de criatura" | `setBaseUntilEot { what: SubjectRef; allCreatureTypes?: true }` |
| Mockingbird | 1.0 | entrar como cópia limitada pelo mana gasto | `becomeCopy` + restrição por mana gasto |
| Tide Shaper | 0.9 | "for as long as ~ remains on the battlefield" | efeito contínuo com duração ligada à fonte |
| Harbinger of the Seas | 0.9 | só existe `nonbasicLandsAreMountains` | generalizar para `nonbasicLandsAre: BasicType` |
| Spirit of the Labyrinth / Narset | 0.8 / 0.6 | não há trava "não pode comprar mais de uma carta por turno" | `flags.drawLimitPerTurn: { whose: 'each' \| 'opponents'; n: 1 }` |
| Anger | 0.8 | estática ativa **do cemitério** condicionada a controlar uma Montanha | estáticas com `zone: 'graveyard'` |
| Ox of Agonas | 0.8 | escape que entra com marcador +1/+1 | `CastMethod.entersWithCounters` |
| Contagion | 0.8 | distribuir marcadores entre um ou dois alvos | `op: 'distributeCounters'` (existe `divideDamage`, não o equivalente de marcadores) |
| Grindstone | 0.8 | moer 2 e repetir enquanto duas cartas moídas compartilharem cor | `op: 'grindstone'` |
| Valakut Awakening | 0.8 | pôr N cartas da mão no fundo e comprar N+1 | `op: 'bottomThenDraw'` |
| Excava, the Risen Past | 0.8 | devolver com marcador de finalidade e virar 1/1 Espírito voador | composição de `returnToBattlefield` + `animatePermanent` com duração permanente |
| Doorkeeper Thrull | 0.8 | "entrar não dispara habilidades" (substituição global) | `flags.noEtbTriggers: FilterSpec` |
| Etali, Primal Conqueror | 0.6 | exilar até uma não-terreno de **cada** jogador e conjurar todas de graça | `exileUntilNonlandFree { who: 'each', castAll: true }` |
| Gemstone Caverns | 0.6 | começar o jogo com a carta no campo | mecânica de mão inicial |
| Inevitable Betrayal | 0.6 | buscar no grimório **do oponente** e pôr em jogo sob seu controle | `search { library: 'opponent', to: 'battlefield', control: 'you' }` |
| Fire Magic | 0.6 | mecânica tiered | mecânica nova |
| Exhume | 0.6 | cada jogador escolhe uma criatura do próprio cemitério (escolha simultânea) | `op: 'eachReanimates'` |
| Echoing Truth | 0.6 | "e todas as permanentes com o mesmo nome" | `FilterSpec.sameNameAsTarget` |
| Nimble Obstructionist | 0.6 | `targetMatchesSpec` não filtra por controlador no ramo `stack`, então "que você não controla" não é verificável | acrescentar a checagem de `controlledBy` ao ramo `choice.kind === 'stack'` |
| Orim's Chant | 0.6 | "o jogador alvo não pode conjurar mágicas neste turno" | `op: 'cantCastThisTurn'; who` |
| Relic of Progenitus | 0.6 | "o jogador alvo exila **uma carta** do próprio cemitério" (escolha dele) | `op: 'exileFromGraveyardChoice'; who: WhoSel; count` |
| Temur Sabertooth | 0.6 | `bounceOwn` é obrigatório quando há opção; falta o "you may … if you do" | `bounceOwn { optional: true }` (ou permitir `bounceOwn` dentro de `mayDo`) |
| Vibrance | 0.6 | condição "se {R}{R} foi gasto para conjurar" | `Cond { kind: 'manaSpentIncluded'; symbols }` |
| Borborygmos Enraged | 0.6 | revelar 3 e separar terrenos/não-terrenos entre mão e cemitério | `op: 'revealTopSplitByType'` |
| Silvergill Mentor | 0.6 | mecânica behold | mecânica nova |
| True-Name Nemesis | 0.6 | proteção contra um jogador escolhido | `chooseOnEnter: 'player'` + `playerProtection` estático |
| Tishana's Tidebinder | 0.6 | anular habilidade e a permanente perder todas as habilidades enquanto isto estiver em jogo | `op: 'loseAllAbilitiesWhile'` |
| Wear Down | 0.6 | gift | ver Into the Flood Maw |
| Goblin Charbelcher | 0.6 | revelar até terreno, dano = não-terrenos revelados, dobrado se Montanha | `op: 'charbelcher'` (ou `revealUntil` com contagem e dano) |
| Meddling Mage | 0.5 | trava "mágicas com o nome escolhido não podem ser conjuradas" | `flags.cantCastChosenName = true` (o `chooseOnEnter: 'cardName'` já existe) |
| Karn's Sylex | 0.5 | trava "jogadores não podem pagar vida" | `flags.noPayLife` |
| Currency Converter | 0.5 | zona própria de cartas exiladas com a fonte + ficha por tipo | `op: 'exiledWithThisToGraveyard'` com ramificação por tipo |
| Hex Parasite | 0.5 | remover até X marcadores de **qualquer** tipo e ganhar +1/+0 por marcador | `removeAllCounters { upTo: 'X' }` + `pump` com `countersRemovedThisWay` |
| Toxic Deluge | 0.5 | `additionalCost.payLife` é número fixo, não X | `additionalCost.payLifeX: true` |
| Bitter Triumph | 0.5 | `additionalCost.either` só cobre sacrificar-ou-descartar | estender `either` para descarte-ou-vida |
| Strategic Betrayal | 0.5 | exilar uma criatura escolhida pelo oponente **e** o cemitério dele | `op: 'opponentExilesOwnCreature'` |
| Ghost Vacuum | 0.4 | "cada carta de criatura exilada com isto" para o campo | `op: 'exiledWithThisToBattlefield'` |
| Chaos Defiler | 0.4 | escolher uma permanente por oponente e destruir uma delas ao acaso | `op: 'chooseThenDestroyRandom'` |
| From the Catacombs | 0.3 | corpse counter + iniciativa + substituição de saída | combinação de mecânicas novas |
| Svyelun of Sea and Sky | 0.3 | `StaticAbility` não carrega **ward numérico** (só `keywords`) | `StaticAbility.ward?: number` |
| Echoing Deeps | 0.3 | entrar como cópia de um terreno no cemitério | `becomeCopy` a partir do cemitério |
| Memory's Journey | 0.3 | embaralhar até três cartas alvo do cemitério de volta | `op: 'shuffleTargetsIntoLibrary'` |
| Geist of Saint Traft | 0.3 | ficha tem `sacrificeAtEnd`, não "exile no fim do combate" | `token.exileAtEndOfCombat: true` |
| Spell Snare | 0.3 | `targetMatchesSpec` ignora valor de mana para `what: 'spell'` | aplicar `cmcAtMost`/`cmcAtLeast` também no ramo de mágicas |
| Keen-Eyed Curator | 0.3 | tipos de carta entre as exiladas com a fonte | `DynAmount { cardTypesExiledWith: 'self' }` |
| Key to the Side-Door | 0.3 | custo "descarte uma lendária com o mesmo nome de uma permanente lendária sua" | `cost.discard: FilterSpec` com `sameNameAsControlled` |
| The Filigree Sylex | 0.3 | custo "remova dez marcadores de óleo **entre** permanentes suas" | `cost.removeCountersAcross` |
| Chains of Mephistopheles | 0.3 | substituição de compra | mecânica de replacement |
| Palantir of Orthanc | 0.3 | oponente escolhe entre te dar compra ou moer/perder vida | `op: 'payOrElse'` com efeito composto no lado do oponente |
| Sarevok's Tome | 0.2 | mana condicionada à iniciativa + conjurar exilada de graça só com masmorra completa | `Cond { kind: 'hasInitiative' }` |
| Kira, Great Glass-Spinner | 0.1 | conceder a todas as criaturas um gatilho "primeira vez em cada turno" | `grantAbility` + gatilho `becomesTargeted` com `oncePerTurn` |
| The Millennium Calendar | 0.1 | gatilho por permanentes desviradas no desvirar + dobrar marcadores + limiar de 1.000 | ops novos |

## Tentadas e revertidas
| Carta | O que aconteceu |
|---|---|
| (nenhuma) | |

## Situação
- Cartas da lista processadas: 85 de 85 (10 feitas, 75 classificadas como não fáceis)
- Releases publicadas: v0.44.0
- Totais do auditor na última release: 13.911 full / 14.452 parciais / 4.718 manuais / 0 estruturais / 41 falhas de simulação
- Observação sobre as 41 falhas (eram 40): a falha nova é
  `habilidade N (cemitério) recusada: escolha a cor da mana`, do Jack-o'-Lantern.
  É limitação do simulador `scripts/audit-cards.mjs`, que preenche `manaColor`
  para habilidades de mana do **campo de batalha** mas não para as do
  **cemitério** — a carta em si está correta (testes mF2 cobrem a compilação).
  `scripts/` está fora da fronteira de edição desta leva.
- Cobertura ponderada do Legacy: 99,1% → **99,2%**; cartas full do meta Legacy: 424 → 434 (lacunas 85 → 75).
- Diff de compilação das 38.629 cartas (antes × depois): 21 mudaram de status, **todas** de
  `partial`/`null` para `full`; nenhuma carta perdeu automação.
