# SlopTCG

**Card games no navegador. De código aberto, de verdade.**

Os clientes oficiais dos grandes card games são pesados, fechados e presos a
plataformas. O SlopTCG é uma engine de card game que roda em qualquer
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
automatizados. Também dá para colar qualquer decklist (`4 Lightning Bolt`…).

## Hospedando uma partida (estilo XMage)

Quem cria o jogo hospeda na própria máquina, e o oponente só precisa de um
navegador.

### Jeito fácil (sem instalar nada)

1. Baixe o **`SlopTCG.exe`** (Windows) — ou o binário de mac/linux — na
   [página de Releases](https://github.com/lucassts/SlopTCG/releases).
2. Dê dois cliques. O navegador abre sozinho no jogo, e a janela preta
   mostra o endereço para mandar ao oponente (ex.: `http://192.168.0.10:8080`).
3. Crie a sala e compartilhe o código de 5 letras. Fim.
4. **Oponente fora da sua rede?** Na sala, clique em **Gerar link público**
   e mande o link `https://….trycloudflare.com/?sala=…` — ele abre o jogo já
   com o código preenchido. Sem VPN, sem porta no roteador, sem conta: é um
   túnel temporário da Cloudflare, que vale enquanto o SlopTCG estiver aberto.
   Na primeira vez o programa baixa o `cloudflared` (~40 MB, versão fixa, do
   release oficial) para a pasta de dados do usuário.

> O Windows SmartScreen pode avisar sobre "editor desconhecido" (o binário
> não é assinado): clique em **Mais informações → Executar assim mesmo**.
> Na mesma rede local, o endereço `http://192.168…:8080` da janela preta
> continua funcionando sem túnel.

### Jeito de desenvolvedor

```bash
npm install
npm run build
npm start
```

Mesmo resultado, em `http://localhost:8080`. `PORT=9000 npm start` muda a
porta; `npm run package` gera o executável de um clique localmente.

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

## Licença e aviso legal

[MIT](LICENSE) — a licença mais permissiva possível. Este é um projeto de
**engine genérica de card games para estudo e uso não comercial**, sem
qualquer afiliação com a Wizards of the Coast ou outras empresas de jogos.
O repositório não contém nenhum dado proprietário de cartas — tudo vem do
Scryfall em runtime, sob a Fan Content Policy. Leia o
[AVISO-LEGAL.md](AVISO-LEGAL.md) completo (PT/EN) antes de redistribuir.
