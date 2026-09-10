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

## Como jogar

**Só uma pessoa instala: o host.** O host roda o SlopTCG na própria máquina;
o programa abre o jogo no navegador e mostra um endereço. O oponente **não
instala nada** — abre o link num navegador qualquer (PC, Mac, celular) e
entra na sala com o código de 5 letras.

Fluxo, em qualquer sistema:

1. O host abre o SlopTCG (veja abaixo como, no seu sistema).
2. O navegador abre sozinho no jogo. O host clica em **Criar sala** e vê o
   código de 5 letras.
3. Para o oponente entrar:
   - **Mesma rede (Wi-Fi/LAN)**: mande o endereço `http://192.168…:8080`
     que aparece na janela do programa; ele abre e digita o código.
   - **Fora da sua rede**: na sala, clique em **Gerar link público** e mande
     o link `https://….trycloudflare.com/?sala=…`. Ele abre o jogo já com o
     código preenchido. Sem VPN, sem porta no roteador, sem conta: é um túnel
     temporário da Cloudflare, que vale enquanto o SlopTCG estiver aberto.
     Na primeira vez o programa baixa o `cloudflared` (~40 MB, versão fixa,
     do release oficial) para a pasta de dados do usuário.
4. Cada um importa o próprio deck (lista colada, arquivo `.txt`/`.dec` ou
   URL do Moxfield/Archidekt). Deck apto: **60+ cartas** no principal e
   **15 no sideboard** (ou nenhum).

### Windows e Linux

**Windows — jeito fácil (sem instalar nada):**

1. Baixe o **`SlopTCG.exe`** na
   [página de Releases](https://github.com/lucassts/SlopTCG/releases).
2. Dê dois cliques. O SmartScreen pode avisar "editor desconhecido" (o binário
   não é assinado): clique em **Mais informações → Executar assim mesmo**.
   O Firewall do Windows pode perguntar se libera a rede: **Permitir** (é o
   que deixa o oponente da mesma rede entrar).
3. O navegador abre no jogo; a janela preta mostra o endereço para a rede
   local. Siga o fluxo acima.

**Linux (e Windows pelo código-fonte):** precisa do Node 20+ e do git.

```bash
git clone https://github.com/lucassts/SlopTCG.git
cd SlopTCG
npm install
npm run build
npm start
```

O jogo fica em `http://localhost:8080` (a porta muda com `PORT=9000 npm
start`). `npm run package` gera um binário de um clique para o seu sistema
(`SlopTCG-linux`, `SlopTCG.exe`).

### macOS — passo a passo

Não há binário pronto para Mac nos Releases; roda pelo código-fonte, que é
simples, mas tem mais etapas:

1. **Instale o Node 20+**: baixe o instalador `.pkg` em
   [nodejs.org](https://nodejs.org) (versão LTS) e siga o assistente. Se
   preferir Homebrew: `brew install node`.
2. **Abra o Terminal** (⌘ + espaço, digite "Terminal").
3. **Baixe o projeto**. Com git (vem com as ferramentas de linha de comando
   da Apple; se o Terminal pedir para instalá-las, aceite):
   ```bash
   git clone https://github.com/lucassts/SlopTCG.git
   cd SlopTCG
   ```
   Sem git: no GitHub, **Code → Download ZIP**, descompacte e entre na pasta
   com `cd ~/Downloads/SlopTCG-main`.
4. **Instale e compile** (só na primeira vez e depois de atualizar):
   ```bash
   npm install
   npm run build
   ```
5. **Rode**:
   ```bash
   npm start
   ```
   O macOS pode perguntar se o `node` pode aceitar conexões de rede:
   **Permitir** — é o que deixa o oponente da mesma rede entrar.
6. O navegador abre em `http://localhost:8080`. O endereço para a rede local
   aparece no Terminal (`http://192.168…:8080`). Siga o fluxo da seção
   "Como jogar". Para encerrar, `Ctrl + C` no Terminal.
7. Opcional: `npm run package` gera um `SlopTCG-mac` de um clique. O
   Gatekeeper vai bloquear na primeira abertura (binário não assinado):
   **Ajustes do Sistema → Privacidade e Segurança → Abrir mesmo assim**.

### Desenvolvimento

```bash
npm install
npm run build            # compila engine, protocol, server e web
npm run dev:server       # servidor de salas em ws://localhost:8080
npm run dev:web          # cliente em http://localhost:5173 (outro terminal)
```

Abra duas abas em `http://localhost:5173`, crie uma sala numa, entre com o
código na outra.

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
