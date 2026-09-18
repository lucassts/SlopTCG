# Leva fácil — instruções para o modelo leve

Você está em `D:\SlopTCG`, engine de Magic em TypeScript (monorepo: `packages/engine`,
`packages/server`, `apps/web`). Sua missão é **fechar as lacunas fáceis do Legacy**:
cartas de `data/meta/legacy-gap.md` cuja linha pendente pode ser expressa **com o que
a engine já tem**, sem mexer na engine. O que não for fácil, você **não faz** — só
registra no relatório para o Lucas terminar com outro modelo.

Trabalhe sozinho, sem perguntas, até processar todas as cartas da lista ou até bater
numa condição de parada (seção 9). Depois de cada compactação de contexto, releia
este arquivo e `docs/LEVA-FACIL-relatorio.md` antes de continuar.

## 1. A fronteira — inegociável

**Pode editar:**

- `packages/engine/src/cards/oracle-parser.ts` — regras novas de reconhecimento de texto
- `packages/engine/src/cards/lexicon.ts` e `grammar.ts` — vocabulário e gramática do parser
- `packages/engine/test/` — testes (só criar arquivos novos `mF*.test.ts` e ampliar `oracle-parser.test.ts`)
- `docs/COBERTURA.md` e `docs/LEVA-FACIL-relatorio.md` (`data/` inteira é gitignored; o gap regenerado não entra no commit)

**Não pode editar, em nenhuma hipótese:** `effects.ts`, `game.ts`, `state.ts`, `ops.ts`,
`mana.ts`, `sba.ts`, `view.ts`, `events.ts`, `actions.ts`, `cards/types.ts`, qualquer
arquivo de `packages/server`, `apps/web`, `packages/protocol`, `scripts/`. Editar
`types.ts` para criar um op novo **é** mexer na engine.

Antes de cada commit rode `git diff --name-only HEAD` e confira que só há caminhos
permitidos. Se aparecer outro, reverta com `git checkout -- <arquivo>` e trate a carta
como não fácil.

## 2. O que é "fácil"

Uma carta é fácil quando **cada peça** da linha pendente já existe e já está
implementada:

| Peça | Onde conferir que existe | Como conferir que está implementada |
|---|---|---|
| op de efeito (`{ op: 'x' }`) | `grep -n "op: 'x'" packages/engine/src/cards/types.ts` | `grep -n "case 'x'" packages/engine/src/effects.ts` (ou `game.ts`) |
| condição (`cond: { kind: 'x' }`) | `types.ts`, tipo `Cond` (linha ~26) | `grep -n "'x'" effects.ts` dentro de `condHolds`/`staticConditionHolds` |
| gatilho (`trigger: { on: 'x' }`) | `types.ts`, tipo `TriggerSpec` (linha ~782) | `grep -n "'x'" game.ts` |
| custo de habilidade (`cost: { x }`) | `types.ts`, custo de habilidade ativada | `grep -n "cost.x" game.ts` |
| flag estática (`st.flags13.x`) | `oracle-parser.ts` + `types.ts` | `grep -n "x" game.ts effects.ts sba.ts` |
| filtro (`FilterSpec`: `subtype`, `cmcAtMost`, `nontoken`…) | `types.ts`, `FilterSpec` | `grep -n "f.campo\|filter.campo" effects.ts ops.ts` |

Se **qualquer** peça não existir ou existir só no tipo sem `case` na engine, a carta
**não é fácil**. Não invente op, não reaproveite um op "parecido", não relaxe uma
regex existente para ela "pegar" a carta. A regra do projeto (em `docs/COBERTURA.md`):
**nunca automatizar errado — uma automação incorreta é uma violação de regra que
ninguém vê.** Uma carta que fica no relatório custa nada; uma carta errada custa uma
partida.

Sinais de que **não** é fácil, para pular sem perder tempo: texto com "instead" que
substitui um evento (replacement), "for as long as", "copy of", "choose a card name",
"can't draw more than", "each player" com escolha simultânea, "at random" sem op
pronto, mecânica nova (gift, behold, retrace, tiered, monarch, initiative, dungeon
quando o op não existe), custo adicional de conjuração que não seja sacrifício ou
descarte já suportado, `X` que depende de escolha do jogador sem op pronto.

Sinais de que **é** fácil: ETB/ataque/dano de combate com efeito direto (dano,
compra, ficha, marcador, destruir, exilar, retornar), habilidade ativada com custo
`tap/mana/sacrificeSelf/payLife` e efeito direto, keyword que já compila em outra
linha mas aparece aqui com redação diferente, anthem/lord estático, custo de mana
reduzido com filtro existente.

## 3. Ferramentas e onde olhar

- Lista de trabalho: `data/meta/legacy-gap.md`, tabela "Cartas com lacuna, por peso".
  Vá de cima para baixo (maior peso primeiro). A coluna "O que segura" é a linha pendente.
- Texto oracle real da carta (use sempre o texto real, nunca de memória):
  ```bash
  node -e "const c=JSON.parse(require('fs').readFileSync('data/oracle-cards.json','utf8')).find(x=>x.name==='NOME');console.log(c.type_line,'|',c.mana_cost,'|',c.power,'/',c.toughness);console.log(c.oracle_text)"
  ```
- O parser: `parseLine` em `oracle-parser.ts` (linha ~1581) recebe cada linha do texto
  com o nome da carta trocado por `~`. Regras específicas ficam em blocos `// ---- Leva N`.
  **Não leia o arquivo inteiro** (3.300 linhas): use `grep -n` para achar padrões
  parecidos com a sua linha e leia só o trecho.
- Exemplo real de regra (Leva 22, terreno com masmorra), para copiar o formato:
  ```ts
  if ((m = line.match(/^\{T\}: Add ((?:\{[WUBRGC]\})+)\. If you've completed a dungeon, add (\w+) (\{[WUBRGC]\}) instead\.$/i))) {
    const base = [...m[1].matchAll(/\{([WUBRGC])\}/g)].map((x) => x[1] as ManaSymbol);
    const n = num(m[2]) ?? 0; const sym = m[3].slice(1, -1) as ManaSymbol;
    st.abilities.push({ kind: 'activated', cost: { tap: true }, isManaAbility: true, text: `Adicionar ${m[1]} (${m[2]} ${m[3]} se completou uma masmorra)`, effect: [{ op: 'addMana', who: 'controller', mana: base }, { op: 'if', cond: { kind: 'completedDungeon' }, then: [{ op: 'addMana', who: 'controller', mana: Array.from({ length: Math.max(0, n - base.length) }, () => sym) }] }] });
    return true;
  }
  ```
  Regras: regex ancorada (`^…$`, flag `i`), `~` literal para o nome, `text` em PT-BR
  curto (é o tooltip do jogador), `return true` só quando a linha foi inteiramente
  entendida, `return false` quando um pedaço falha (`keywordList`, `num`, `parseNounG`
  devolvem `null`). Suas regras entram num bloco novo
  `// ---- Leva F (fáceis)` logo depois do bloco `// ---- Leva 22`.
- Helpers do parser: `num('two') → 2`, `keywordList('flying and haste')`,
  `parseNounG('creature you control')`, `manaValueOfCost('{2}{R}')`, `COLOR_WORDS`.
- Auditor por carta (compila e simula numa partida; leva ~1 min):
  ```bash
  node scripts/audit-cards.mjs --only "NOME DA CARTA"
  ```
  Usa o `dist` da engine → rode `npm run build` na raiz antes.

## 4. Ciclo por carta

1. Ler a linha pendente e o texto real. Decidir fácil / não fácil pela seção 2.
   Não fácil → registrar no relatório (seção 7) e ir para a próxima.
2. Escrever a regra no bloco Leva F.
3. Teste em `packages/engine/test/mF<N>-<tema>.test.ts` (um arquivo por release):
   - compila com o texto oracle real via `compileOracleCard` e afirma
     `automation === 'full'` e o formato do DSL gerado (op, alvos, custo);
   - quando o efeito é observável numa partida, um teste de comportamento com os
     helpers de `test/helpers.ts` (`makeGame`, `goToMain1`, `passUntil`, `findIn`) e
     `manualMove` para montar a cena. Copie o estilo de `m51-convoke.test.ts`.
4. Rodar, em `packages/engine`: `npx tsc -p tsconfig.json --noEmit` e `npx vitest run`.
   Tudo verde, sem exceção. Teste que quebrou de outra carta = sua regra capturou linha
   que não devia → corrija a regra, nunca o teste antigo.
5. `npm run build` na raiz e `node scripts/audit-cards.mjs --only "NOME"`: precisa
   sair `full` e a simulação sem erro. Falhou → investigue; se a falha está na engine,
   a carta não é fácil: remova a regra e registre.
6. Anotar a carta como feita no relatório (seção 7) **antes** de ir para a próxima.

## 5. Ciclo por release (a cada 6 a 8 cartas feitas, ou ao esgotar a lista)

Versões: continue a sequência de `git tag | sort -V | tail -1` (a próxima depois de
v0.43.0 é v0.44.0, depois v0.45.0…). Os `package.json` ficam em 0.1.0, não mexa.

```bash
cd packages/engine && npx tsc -p tsconfig.json --noEmit && npx vitest run
cd ../.. && npm run build
cd apps/web && npx tsc --noEmit -p tsconfig.json && cd ../server && npx tsc --noEmit -p tsconfig.json && cd ../..
node scripts/audit-cards.mjs > audit-vX.Y.Z.txt 2>&1      # 5 a 10 min: rode em background com timeout de 600000
node scripts/meta-gap.mjs --format legacy                   # regenera data/meta/legacy-gap.md
node scripts/package.mjs                                    # gera release/SlopTCG.exe (alguns minutos, background)
```

No `audit-vX.Y.Z.txt` as linhas 19–23 trazem os totais (full / parcial / manual /
estruturais / falhas de simulação). **Full só pode subir, parcial e manual só podem
descer, estruturais têm de ficar em 0.** Se full caiu ou apareceu estrutural, uma regra
sua capturou texto de outra carta: ache qual (`--only`), corrija, repita. O número de
falhas de simulação antes desta leva é 40; se subir, veja quais e trate como acima.

Depois, documentação (seção 6), commit e release:

```bash
git add -A
git commit -q -m "vX.Y.Z: leva fácil — N cartas do Legacy (Carta A, Carta B, …)" -m "<linha de atribuição que o seu ambiente pedir>"
git tag vX.Y.Z
git push -q origin main --tags
gh release create vX.Y.Z --title "vX.Y.Z — leva fácil: N cartas do Legacy" --notes-file notes-vX.Y.Z.md release/SlopTCG.exe
```

`notes-vX.Y.Z.md` e `audit-vX.Y.Z.txt` ficam **fora do repositório** (no seu diretório
de rascunho), nunca commitados. Sem alteração no cliente web não há verificação no
navegador; testes + simulador bastam.

## 6. Documentação por release

1. `docs/COBERTURA.md`: atualize a data, a versão e a cobertura no título
   `## Estado (…)` e acrescente um parágrafo `**vX.Y.Z — leva fácil.**` depois do
   parágrafo da versão anterior (é o último `**v0.43.0 — …**` na seção Estado), com:
   cartas feitas, o padrão de cada regra em uma linha, totais novos do auditor, total
   de testes. Não altere a tabela grande.
2. Vault (`D:\SegundoCerebro\segundocerebro`):
   - `03 - Projetos/SlopTCG.md`: no bullet `- **Release atual vX** (…)` troque a versão
     e o link da release; não mexa no resto da nota.
   - `99 - Sistema/Log de Operações.md`: insira uma linha logo depois de
     `|---|---|---|---|`, no formato das linhas vizinhas:
     `| AAAA-MM-DD | **SlopTCG vX.Y.Z — leva fácil (N cartas)**: nomes. Testes: T. Release <url> | \`D:\SlopTCG\` · [[SlopTCG]] | <seu modelo> |`
3. Notas da release (`notes-vX.Y.Z.md`): título `## vX.Y.Z — …` e um bullet por carta,
   em PT-BR, dizendo o que passou a funcionar sozinho.

## 7. Relatório — `docs/LEVA-FACIL-relatorio.md`

É o produto final para o Lucas e também a sua memória. Crie na primeira carta e
atualize a cada carta. Formato:

```markdown
# Leva fácil — relatório

Início: AAAA-MM-DD · Modelo: <nome> · Última atualização: AAAA-MM-DD HH:MM

## Feitas
| Carta | Peso | Release | Regra (uma linha) |
|---|---|---|---|

## Não fáceis (para o Fable 5.1)
| Carta | Peso | O que falta na engine | Sugestão de op / mecanismo |
|---|---|---|---|

## Tentadas e revertidas
| Carta | O que aconteceu |
|---|---|

## Situação
- Cartas da lista processadas: N de 85
- Releases publicadas: vX…vY
- Totais do auditor na última release: full / parcial / manual / falhas de simulação
```

Na coluna "O que falta na engine" seja concreto: o op que não existe (`op: 'copySpellToTarget'`),
o gatilho, a condição, o campo de custo. Isso é o que vai orientar o trabalho depois.

## 8. Proibições

- Nunca marque `full` o que não está inteiramente implementado; nunca aproxime semântica.
- Nunca remova, afrouxe ou reordene regra existente do parser.
- Nunca edite ou apague teste existente para passar.
- Nunca use `--no-verify`, `--force`, `git reset --hard`, nem reescreva histórico.
- Nunca commite `audit-*.txt` nem `notes-*.md` (mantenha-os fora do repositório).
- Nunca coloque segredo, token ou chave em arquivo, commit ou resposta.
- Não pergunte ao usuário: ele não está acompanhando. Dúvida = não fácil = relatório.

## 9. Condições de parada

Pare e escreva o resumo final no relatório quando:

- todas as 85 cartas da lista tiverem sido classificadas (feita ou não fácil); ou
- três cartas seguidas que pareciam fáceis tiveram de ser revertidas (a lista restante
  provavelmente é toda de engine); ou
- a pipeline de release falhar duas vezes seguidas por motivo que não é a sua regra
  (rede, gh, build). Nesse caso deixe o trabalho commitado localmente, sem tag, e diga
  isso na seção Situação.

Ao parar, a última mensagem para o Lucas deve ter: cartas feitas (com versões),
cartas não fáceis com o motivo em uma linha cada, e os totais do auditor. Sem
promessas de trabalho futuro.
