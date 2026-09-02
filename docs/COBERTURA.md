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

## Estado (2026-08-30, v0.8.0)

| 33.085 cartas jogáveis | v0.5 | v0.6 | v0.7 | **v0.8 (Leva 1)** |
|---|---|---|---|---|
| Totalmente automatizadas | 1.804 | 5.011 | 5.554 | **6.275** |
| Parciais (jogáveis, alguma linha manual) | 21.602 | 20.566 | 20.873 | **20.182** |
| Manuais | 8.739 | 6.637 | 6.596 | **6.566** |
| Dupla-face manuais | 864 | 864 | 55 | **55** |

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

### Leva 2 — mecânicas de conjuração (≈1.000 cartas pela keyword + suas frases)
Morph / Megamorph / Disguise (226 — carta virada para baixo 2/2 por {3},
virar por custo), Kicker restante, Multikicker, Unearth (58), Ninjutsu (43),
Evoke (36), Madness (46), Warp (37), Mutate (34), Cascade (30), Suspend
(30), Encore (25), Plot (24), Escape (23), Dash (21), Reconfigure (21),
Offspring (21), Foretell (20), Blitz (19), Myriad (18), Buyback (16), Squad
(15), Bestow (15), Embalm/Eternalize (28), Emerge (14), Scavenge (13),
Dredge (10), Convoke / Delve / Improvise / Affinity de verdade (130 — hoje
parciais pagando custo cheio), Split second, Rebound, Retrace, Cipher,
Entwine, Overload, Replicate, Miracle, Surge, Prowl, Spectacle.
Infra comum: custos alternativos com zona de origem, cartas viradas para
baixo, gatilhos atrasados ("no fim do turno", "na próxima manutenção"),
cópias de mágica com modos.

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
