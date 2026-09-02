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

## Estado (2026-09-02, v0.9.0)

| 33.085 cartas jogáveis | v0.5 | v0.6 | v0.7 | v0.8 (Leva 1) | **v0.9 (Leva 2)** |
|---|---|---|---|---|---|
| Totalmente automatizadas | 1.804 | 5.011 | 5.554 | 6.275 | **6.696** |
| Parciais (jogáveis, alguma linha manual) | 21.602 | 20.566 | 20.873 | 20.182 | **19.788** |
| Manuais | 8.739 | 6.637 | 6.596 | 6.566 | **6.539** |
| Dupla-face manuais | 864 | 864 | 55 | 55 | **55** |

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

### Leva 3 — keywords de campo restantes (≈800 cartas)
Level up + bandas LEVEL (≈90), Soulshift, Exploit, Soulbond, Backup,
Station, Start your engines, Job select, Firebending, Specialize, Graft,
Amplify, Sunburst/Converge, Tribute, Training, Provoke, Annihilator,
Phasing, Banding, Haunt, Hideaway, Umbra armor, Enlist, Double team,
Mobilize, Battle cry, Melee, Ravenous, Dethrone, Ingest, Champion, Ripple,
Assist, Bargain, Storied, Increment, Read ahead, Daybound/Nightbound,
Monarch, Initiative, Energy, Sagas (capítulos), Batalhas, Dungeons.

### Leva 4 — gramática composicional (o grosso: ≈17.000 cartas)
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

### Leva 5 — o que sobra
Cartas dupla-face de verdade (transformar/verso jogável, 731 cartas),
adventure/split (segunda metade), poder/resistência `*` (CDA), cartas Un-,
e o resto do `data/tail-sentences.txt` — nesse ponto, script por carta
(Tier 2) é o mais barato, e a lista do auditor diz exatamente quais.

## Regras de trabalho por leva
1. `node scripts/audit-cards.mjs` no começo (baseline) e no fim (medida).
2. Zero crash, zero problema estrutural, e cada nova mecânica com teste em
   `packages/engine/test/`.
3. Toda mecânica que envolva escolha do jogador precisa do overlay no
   cliente (`GameBoard.tsx`) — sem UI, a engine trava esperando resposta.
4. Atualizar a tabela acima e a nota do projeto no vault.
