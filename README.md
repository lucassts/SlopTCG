# SlopMTG

**Card games no navegador. De código aberto, de verdade.**

Os clientes oficiais dos grandes card games são pesados, fechados e presos a
plataformas. O SlopMTG é uma engine de card game que roda em qualquer
navegador, instala como PWA (vira um atalho, funciona offline) e pertence à
comunidade. O primeiro jogo suportado é **Magic: The Gathering**; a
arquitetura foi desenhada para a comunidade portar outros jogos.

## Como funciona

- **Engine autoritativa no servidor** — as regras rodam em
  [`packages/engine`](packages/engine) (TypeScript puro, zero dependências).
  O cliente só envia intenções e renderiza eventos. Não dá para trapacear.
- **Automação progressiva** — cartas implementadas na DSL declarativa jogam
  100% automatizadas (pilha, gatilhos, combate, SBAs). Cartas ainda não
  implementadas são jogáveis em **modo manual** (estilo Cockatrice), com tudo
  registrado no log. Nenhuma carta fica de fora.
- **Zero dado proprietário no repositório** — texto e imagem de carta vêm do
  [Scryfall](https://scryfall.com/docs/api) em runtime, sob a
  [Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy)
  da Wizards.
- **Multiplayer por código de sala** — um jogador cria a sala, manda o código
  de 5 letras, o outro entra. Lobby público e federação de servidores estão
  no roadmap.

## Rodando localmente

Pré-requisito: Node 20+.

```bash
npm install
npm run build            # compila engine, protocol, server e web
npm run dev:server       # servidor de salas em ws://localhost:8080
npm run dev:web          # cliente em http://localhost:5173 (outro terminal)
```

Abra duas abas em `http://localhost:5173`, crie uma sala numa, entre com o
código na outra. Os dois decks demo (Gruul Smash e Azorius Wings) são 100%
automatizados. Também dá para colar qualquer decklist (`4 Lightning Bolt`…) —
cartas fora do set demo entram em modo manual.

## Testes

```bash
npm test
```

A engine tem suíte própria cobrindo turnos, mana, combate (voar, alcance,
vigilância, atropelar, toque mortífero), pilha, counterspells, gatilhos,
SBAs, descarte e modo manual.

## Arquitetura

Leia [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md). Resumo do monorepo:

| Pacote | Papel |
|---|---|
| `packages/engine` | Regras do jogo. Puro, determinístico, testado. |
| `packages/protocol` | Tipos de mensagem cliente ↔ servidor. |
| `packages/server` | Salas via WebSocket, engine autoritativa. |
| `apps/web` | Cliente React + PWA. |

## Contribuindo

O caminho mais fácil de contribuir é **implementar cartas** na DSL — veja
[`CONTRIBUTING.md`](CONTRIBUTING.md). Não precisa conhecer a engine por
dentro: a maioria das cartas é descrita como dados.

## Licença

[MIT](LICENSE). Nomes e textos de cartas são propriedade dos respectivos
donos (Wizards of the Coast, no caso do Magic); este projeto é conteúdo de fã
não oficial e não é endossado pela Wizards.
