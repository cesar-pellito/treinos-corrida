# PaceUp — hub pessoal de treinos e nutrição

PWA pessoal para uma fase de perda de gordura com preservação de massa magra. Mostra, todo dia e em 1 ou 2 toques, dois números contra as metas que você configura: **a semana de treinos** (com destaque para os 2 treinos de perna) e **a proteína do dia**. Continua acompanhando o plano de retorno à corrida de 22 semanas. Peso e musculação detalhada ficam nos apps que você já usa (balança e Gravl).

Uso diário no celular, **offline por completo**, **custo zero**, sem build e sem dependências. Roda **só no GitHub Pages**: não há servidor, Apps Script nem planilha. Os dados vivem no seu aparelho (IndexedDB) e o backup é um arquivo JSON que você salva onde quiser.

O app mostra números contra metas e nada além disso: **sem alertas clínicos, diagnósticos ou recomendações**.

---

## 1. Arquitetura e decisões

### Stack: HTML + CSS + JavaScript vanilla, ES modules, sem build
O que está no repositório é exatamente o que roda no navegador. Nenhum bundler, framework ou `npm install`. Motivo: manutenção de um único dono ao longo de meses — toolchain de frontend apodrece; HTML e JS não. Os gráficos são SVG gerados à mão (`js/views/components/charts.js`).

### Local-first: IndexedDB é a fonte da verdade
Não há backend. O GitHub Pages só entrega os arquivos do app; depois de instalado, tudo roda no aparelho. Toda escrita é local e síncrona do ponto de vista do usuário — nunca existe estado "aguardando servidor". Um único usuário com um dispositivo principal não tem problema de sincronização; tem problema de **backup** (seção 7).

### Três camadas, dependência unidirecional
```
views/      (DOM, eventos)         — não conhece IndexedDB nem regras
  ↓
services/   (regras, cálculos)     — não conhece DOM
  ↓
data/       (repository.js, db.js) — única a falar com IndexedDB
```
Regra de ouro: a UI nunca toca no IndexedDB. Tudo passa por `js/data/repository.js`, onde vivem as **regras de integridade**:
- IDs com `crypto.randomUUID()`.
- Registrar um treino cria um `completedWorkout` e **só altera o `status`** do planejado.
- Histórico é append-only: alterar o plano nunca reescreve/apaga um realizado.
- Reagendar preenche `dataOriginal` uma única vez.
- Proibido dois `completedWorkouts` para o mesmo treino planejado.
- Importar backup faz merge por ID com **last-write-wins** por `atualizadoEm` — nunca duplica.
- Hub: **uma sessão por (data, item da agenda)** e **uma refeição por (data, refeição)** — marcar de novo edita o registro; nunca duplica.
- Hub: exclusão é **lógica** (`removido: true`, o *tombstone*). O import de backup não tem DELETE: um registro apagado de verdade voltaria ao importar um backup antigo. As listagens filtram removidos.
- Hub: registros guardam um **snapshot** do que era previsto (tipo, rótulo, período; macros estimadas da refeição). Editar a agenda vale daqui para frente e não reescreve o histórico.
- A agenda-padrão é semeada com **UUIDs fixos** gerados uma vez com `crypto.randomUUID()` (`js/data/seed-hub.js`): reinstalar ou restaurar um backup não duplica.

### Unidades e datas
Internamente: distância em **metros**, duração em **segundos**, timestamps ISO. Formatação (km, `mm:ss`, `6:48 /km`) só na camada de apresentação. Datas de calendário em ISO **tratadas em fuso local** (`js/services/dates.js`) para evitar o clássico bug de `new Date('2026-08-03')` virar o dia anterior por interpretação UTC.

### Estrutura de arquivos
```
index.html · manifest.webmanifest · service-worker.js · test.html
data/plano-seed.json          os 66 treinos derivados do plano
assets/icons/                 ícones do PWA (icon.svg é a fonte; três anéis)
styles/app.css                design system (tema claro/escuro)
js/
  app.js                      bootstrap: SW, tema, seed do hub, onboarding/roteamento
  data/  db.js repository.js seed.js seed-hub.js plano-alimentar.js
  services/  dates pace schedule stats discomfort ics backup theme dominio
             agenda metas nutricao
  views/  router today treinos nutricao calendar evolution history settings help
          workout-form workout-detail onboarding agenda-editor metas-editor
          components/ ui.js charts.js agenda-ui.js nutricao-ui.js
  tests/ nucleo.js            asserções do núcleo (rodam em test.html)
```

---

## 2. Modelo de dados

IndexedDB `treinos-corrida`, **versão 3**. Cada migração só adiciona stores (`if (versaoAntiga < N)` em `db.js`); os stores existentes não são tocados.

**Corrida (v1):** `plans`, `phases`, `plannedWorkouts`, `completedWorkouts`, `discomforts`, `settings`. Dados **planejados** e **realizados** são separados por design — registrar nunca sobrescreve o plano. A região de desconforto **fáscia plantar / calcanhar** é própria, separada de "pé", por causa do histórico de fascite plantar.

**Hub (v2):**

| Store | O que guarda | Campos principais |
|---|---|---|
| `weeklySchedule` | a semana-padrão | `diaSemana` (0=dom…6=sáb), `periodo` (`manha`/`noite`), `tipo` (`musculacao`/`karate`/`corrida`), `rotulo`, `opcional` |
| `sessionLogs` | check de musculação e karatê | `data`, `scheduleItemId` (null = fora da agenda), snapshot `tipo`/`rotulo`/`periodo`/`opcional`, `status` (`feito`/`nao_feito`/`pulado`), `duracaoMin?`, `rpe?` |
| `foodLogs` | refeições do plano e proteína extra | `data`, `tipo` (`refeicao`/`extra`); refeição: `refeicaoId`, `varianteIndex`, `varianteNome`, `fracao` (1, ¾, ½, ¼), snapshot `macros {kcal, prot, carb, gord}`, `escolhas?` (do montar prato); extra: `proteinaG`, `descricao?` |
| `scheduleMoves` (v3) | item da agenda arrastado para outro dia/período **numa semana** | `scheduleItemId`, `dataOrigem` (o dia previsto), `data` (destino, mesma semana), `periodo`, `ordem` (posição no período). Um por (item, `dataOrigem`) |

A corrida arrastada não usa `scheduleMoves`: o próprio `plannedWorkout` é reagendado (mesmas regras de `dataOriginal`/`sequence`) e ganha `periodo` e `ordemDia` opcionais.

Metas ficam em `settings`, na chave `metas` (`js/services/metas.js`): proteína mínima e máxima por dia e treinos de Lower por semana.

Cada registro carrega `criadoEm` e `atualizadoEm`; o import de backup usa `atualizadoEm` para decidir quem vence. (Registros antigos da v1 podem ter um campo `_pendingSync` da época da sincronização com o Sheets; ele é ignorado.)

---

## 2.1 Navegação e definições

Barra inferior: **Hoje · Treinos · Nutrição · Ajustes**.

- **Hoje:** agenda do dia com check de 1 toque (✓ feito, ✕ não feito, ↷ pulado; tocar de novo desmarca; tocar no nome abre duração e RPE), proteína do dia contra a meta (+ proteína extra), as 4 refeições com ✓ de 1 toque (a do horário em destaque; tocar no nome escolhe a variante e a porção), resumo da semana e próxima corrida (tocar abre objetivo, RPE, zona, fase e a estrutura do treino).
- **Treinos:** *Semana* (agenda da semana com checks, aderência e "Lower X de 2", navegação entre semanas; **segurar e arrastar** um treino o leva para outro dia ou período da mesma semana, inclusive para ficar antes ou depois de outro no mesmo período), *Corrida* (progresso do plano e calendário), *Evolução* e *Histórico* da corrida. As rotas antigas `#/calendario`, `#/evolucao` e `#/historico` continuam funcionando.
- **Nutrição** (porte do App_Dieta): *Refeições* — abas por refeição (abre na do horário), variantes, Alimentos/Macros, montar prato com a barra de blocos e pendências, busca de substituições sem acento, e "Marcar como feita" / "Outra porção…"; *Semana* — dias na meta e média de proteína, dia a dia, e as 3 semanas anteriores; *Orientações* — mensagem, hidratação, refeição livre, orientações gerais, links com cupons e contato (dados do plano que o App_Dieta guardava mas não exibia).
- **Ajustes:** Agenda semanal, Metas, preferências da corrida, `.ics`, backup e "Recomeçar o plano de corrida".

A corrida do dia vem **sempre do plano de corrida** (`plannedWorkouts`); os itens `corrida` da agenda só indicam dia e período. O ✓ da corrida leva ao formulário de registro de sempre, e o ✕ marca "não realizado".

**Definições usadas nos números:**
- **Previstos da semana:** itens não opcionais da agenda + corridas do plano na semana.
- **Aderência:** feitos ÷ previstos. Opcional feito e treino fora da agenda contam como *extra*. "Pulado" aparece separado e não conta como feito.
- **Lower da semana:** sessões de musculação **feitas** com rótulo começando por "Lower", em qualquer dia (inclusive fora da agenda).
- **Remanejamento:** um "treino fora da agenda" com o mesmo rótulo de um item da semana ainda não feito (ex.: Lower B no sábado em vez de domingo) vale por aquele item: o item aparece como "Feito no sábado" e conta na aderência, e a sessão aparece como "Vale pelo treino de domingo", sem contar como extra.
- **Treino movido (arrastar):** vale só para aquela semana; a agenda-padrão não muda. O treino continua previsto uma vez só, agora no novo dia ("Movido de segunda"). Se estava "não feito" ou "pulado", a marcação sai e ele volta a ficar pendente; se estava "feito", o registro vai junto. Tocar no nome mostra "Voltar para segunda · manhã". Não se movem: corrida já registrada, treino já feito em outro dia (remanejado) e treino fora da agenda.
- **Proteína do dia:** soma de `macros.prot × fração` das refeições registradas mais a proteína extra. As macros vêm da tabela de **estimativas** por refeição e variante (`MACROS` em `js/data/plano-alimentar.js`), não são valores oficiais da nutricionista, e a interface sempre mostra o selo "estimativa".
- **Bateu a meta:** proteína do dia ≥ mínimo configurado em Metas.
- **Média semanal de proteína:** só dos dias com algum registro; dias sem registro aparecem à parte, para que esquecer de lançar não pareça dia de proteína baixa.

### Plano alimentar
O `PLANO` do App_Dieta foi copiado **sem alteração** para `js/data/plano-alimentar.js` (só ganhou `export`), com o comentário de manutenção original: quantidades literais do PDF, `quantidade: null` quando o PDF não informa, blocos que se somam e opções excludentes dentro do bloco. O `App_Dieta/` continua na pasta como referência.

### Corrida em 2 vezes por semana
O plano de 22 semanas foi escrito para 3 sessões. Com 2 dias (quinta e sábado), o app segue a regra do próprio plano: nas fases 1 e 2 sai a sessão B; nas fases 3 e 4 sai a A, mantendo a de qualidade (B) e a rodagem longa (C). São 44 treinos, e a sessão mais longa fica sempre no dia mais tarde da semana. Para recomeçar da semana 1: **Ajustes → Recomeçar o plano de corrida**, escolha Qui + Sáb e a data de início. O plano anterior é arquivado, não apagado.

---

## 3. Lembretes: calendário nativo (.ics), não push

O app **não** usa Web Push (exigiria servidor com chaves VAPID, violando o custo zero) nem tenta agendar notificações locais (não há API confiável em PWA, menos ainda no iOS). Em vez disso, gera um arquivo **`.ics`** com todos os treinos futuros; você importa uma vez no Google Agenda e o sistema operacional cuida do lembrete — com o app fechado, sem servidor.

**Limitações que você precisa conhecer (documentadas também na tela de Ajuda):**
- O **Google Agenda ignora o horário de alarme** do arquivo importado e usa a notificação padrão da sua conta. Por isso os eventos têm um **horário real** (manhã, configurável) para a notificação padrão se ancorar. Ajuste a antecedência padrão do seu calendário. O alarme de "20:00 do dia anterior" só é respeitado pelo **Apple Calendar**.
- Reimportar por cima **pode duplicar** no Google. Ao reagendar, use um **calendário dedicado** ("Plano de Corrida") e reimporte-o inteiro. Os eventos usam `UID` estável + `SEQUENCE` incrementado (o Apple Calendar atualiza sem duplicar; o Google, via arquivo, não é confiável nisso).
- **Sem importar o .ics, não há lembrete.** O app apenas gera o arquivo. Lembrete por e-mail exigiria um servidor e não existe mais.

---

## 4. Deploy no GitHub Pages (passo a passo)

O Pages gratuito só publica **repositórios públicos**. Como todos os dados ficam no seu aparelho (nada sensível vai para o repositório), público é seguro.

1. Crie um repositório **público** no GitHub (ex.: `treinos-corrida`).
2. Na raiz do projeto:
   ```bash
   git init
   git add .
   git commit -m "App de treinos de corrida"
   git branch -M main
   git remote add origin https://github.com/SEU_USUARIO/treinos-corrida.git
   git push -u origin main
   ```
3. No GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, pasta `/ (root)`. Salve.
4. Em ~1 minuto o app estará em `https://SEU_USUARIO.github.io/treinos-corrida/`. HTTPS é obrigatório para o service worker — o Pages já entrega.
5. Dali em diante, **`git push` publica**. Sem action, sem build.

### Rodar localmente
ES modules não abrem via `file://`. Na raiz:
```bash
npx serve
```
e abra `http://localhost:3000`.

---

## 5. Instalar na tela inicial

Instalar **protege seus dados no iOS** (o Safari pode descartar o IndexedDB de sites não instalados após ~7 dias). Não é só conveniência.

**Android (Chrome):** abra o site → menu ⋮ → **Instalar app** / **Adicionar à tela inicial**.

**iPhone (Safari):** abra o site → botão **Compartilhar** → **Adicionar à Tela de Início**. Abra pelo ícone criado (roda em tela cheia, modo standalone).

---

## 6. Importar o calendário (.ics)

Em **Ajustes → Exportar calendário (.ics)**. Depois:

**Google Agenda (computador):** [calendar.google.com](https://calendar.google.com) → engrenagem → **Configurações → Importar e exportar → Importar** → selecione o arquivo → escolha um calendário (crie um só para o plano) → **Importar**. Ajuste a **notificação padrão** desse calendário para a antecedência desejada.

**Apple Calendar (iPhone):** abra o arquivo `.ics` → **Adicionar todos**. O alarme do dia anterior (padrão 20:00) é respeitado.

Ao reagendar treinos, reexporte e reimporte no calendário dedicado (no Google, apague-o antes para não duplicar).

---

## 7. Backup

Os dados ficam só no aparelho; o backup é um arquivo JSON com todos os stores (corrida, agenda, sessões e refeições).

- **Exportar:** **Ajustes → Exportar backup (JSON)**. O celular abre o menu de compartilhar: salve no **Google Drive** ou no app **Arquivos**. Se o compartilhar não estiver disponível, o arquivo é baixado; em último caso, o conteúdo vai para a área de transferência.
- **Restaurar ou trocar de aparelho:** **Ajustes → Importar backup (JSON)**. O merge é por ID com last-write-wins: importar duas vezes não duplica, e um backup antigo não sobrescreve dado mais novo. Um backup feito antes do hub (só corrida) importa normalmente.
- O app avisa quando o último backup passa de **14 dias**.

> **Sincronização com Google Sheets removida.** As versões anteriores podiam espelhar os dados numa planilha via Apps Script e mandar lembrete por e-mail. Isso saiu: o PaceUp não depende de nada além do GitHub Pages. Se você chegou a publicar o Apps Script, ele e a planilha continuam na sua conta Google até você apagá-los; o app não fala mais com eles. A URL e o token que estavam em Ajustes ficam guardados sem uso.

---

## 8. Testes

Abra **`test.html`** (servido por HTTP) — roda asserções em JS puro contra a camada de dados e serviços, e mostra ✓/✗. Cobre: CRUD nos seis stores da corrida; cálculo de pace com bordas (distância/tempo zero, vírgula decimal); registrar não altera o planejado além do status; alterar o plano não mexe no realizado; reagendar preserva `dataOriginal`; importar backup não duplica e respeita last-write-wins; trava de duplicação; aderência com semana parcial/vazia; recorrência de desconforto com poucos treinos; `.ics` com `SEQUENCE` e `UID` estável; virada de mês/ano.

Hub: **migração v1→v2** a partir de um banco v1 de verdade, com dados (registros idênticos byte a byte, índices funcionando, stores novos vazios); seed da agenda idempotente e que respeita remoções; metas com mescla, validação e descarte de campos antigos; uma sessão por (data, item) com edição, desmarcar e reativar sem duplicar; aderência que ignora opcionais e conta Lower fora do dia; remanejamento de treino fora da agenda; backup v1 importando no v2 sem duplicar; plano alimentar com quantidades literais (amostras do PDF); proteína do dia com porção, extras, edição sem duplicar e tombstone; semana de proteína com média só dos dias registrados; busca sem acento e pendências do montar prato.

> `test.html` apaga e recria o banco da origem em que roda. Rode em `localhost`, nunca na URL do GitHub Pages onde estão seus dados.

---

## 9. Checklist de validação

Marque cada item ao validar uma nova instalação.

**Restrições inegociáveis**
- [ ] Abre e navega **offline** (modo avião), consulta o treino de hoje.
- [ ] **Registra um treino offline**; fecha e reabre o app — o dado continua lá.
- [ ] **Instalável** na tela inicial e abre em **modo standalone** (tela cheia).
- [ ] Custo de infraestrutura **zero**: só GitHub Pages, sem servidor.
- [ ] Planejado e realizado ficam **separados**; registrar não sobrescreve o plano.
- [ ] Histórico **imutável**: alterar/reagendar o plano não muda nenhum realizado.
- [ ] Nenhuma recomendação médica, diagnóstico ou alerta clínico.

**Regras de dados**
- [ ] Registrar altera **apenas o `status`** do planejado.
- [ ] Reagendar preserva a **data original** mesmo após vários reagendamentos.
- [ ] Importar o mesmo backup duas vezes **não duplica**; backup antigo não sobrescreve dado novo.
- [ ] Não é possível registrar **dois realizados** para o mesmo treino planejado.

**Funcionalidade (corrida)**
- [ ] Pace **calculado ao vivo** no formato `6:48 /km`; avisos (sem bloquear) fora de faixa.
- [ ] Comparativo **planejado × realizado** com deltas.
- [ ] Gráficos de Evolução renderizam (volume, consistência, pace/FC fácil, RPE).
- [ ] Recorrência de desconforto (contagem factual dos últimos treinos).
- [ ] Exporta **`.ics`** com `UID`/`SEQUENCE`/alarme; reagendar incrementa `SEQUENCE`.

**Agenda e Hoje**
- [ ] Ao atualizar do app antigo, **os dados da corrida continuam** (plano, corridas, desconfortos, ajustes) e a agenda-padrão aparece.
- [ ] Hoje mostra a agenda do dia; ✓ / ✕ / ↷ marcam em **1 toque** e tocar de novo desmarca.
- [ ] Tocar no nome abre duração e RPE opcionais; salvar não duplica o registro.
- [ ] "Treino fora da agenda" registra um Lower em outro dia; o item aparece como "Feito no …" e o **"Lower X de 2"** conta.
- [ ] A corrida do dia leva ao formulário de registro; ✕ marca "não realizado" e tocar de novo desfaz.
- [ ] Treinos → Semana navega entre semanas e permite marcar dias passados.
- [ ] Ajustes → Agenda semanal: adicionar, editar e remover; o histórico não muda.
- [ ] Ajustes → Metas salva e recusa valores incoerentes (máximo < mínimo).
- [ ] Ícone novo (três anéis) na tela inicial depois de reinstalar ou atualizar.

**Nutrição**
- [ ] Hoje: ✓ numa refeição soma a proteína estimada em 1 toque; tocar de novo desfaz.
- [ ] Tocar no nome da refeição permite escolher a variante e "comi metade / ¾ / ¼"; a soma acompanha.
- [ ] "+ Proteína extra" soma os gramas e o lançamento pode ser removido.
- [ ] O selo **"estimativa"** aparece em toda soma de macros.
- [ ] Nutrição abre na refeição do horário; variantes, Macros, montar prato e busca funcionam como no App_Dieta.
- [ ] Busca "pao" acha o grupo dos pães; termo fora da lista mostra que o plano não prevê a troca.
- [ ] Semana: dias na meta e média contam só dias com registro.
- [ ] Orientações mostra hidratação, refeição livre, orientações e links.

**Backup**
- [ ] Exportar backup abre o compartilhar; salvar no Drive ou no Arquivos funciona.
- [ ] Importar o backup em outro navegador traz corrida, agenda, sessões e refeições, sem duplicar.
- [ ] Aviso quando o último backup passa de 14 dias.

**Robustez**
- [ ] **Recarregar durante o preenchimento** de um formulário não trava o app (o botão "Atualizar" do service worker só aparece sob confirmação).
- [ ] Atualização do banco com outra aba aberta mostra "Atualizando os dados do app…" e conclui ao fechar a outra aba (não dá erro).
- [ ] Datas corretas na **virada de mês e de ano** (sem bug de UTC).
- [ ] Tempo até interativo abaixo de ~1s em conexão comum.

---

## 10. O que não está incluído (por decisão)

Servidor de qualquer tipo (Web Push, Apps Script, sincronização, lembrete por e-mail); acompanhamento de peso e composição corporal (fica no app da balança); logger ou importação de musculação (fica no Gravl); GPS/rastreamento ao vivo; múltiplos planos simultâneos na UI (o schema suporta via `planId`); macros por alimento (as estimativas são por refeição e variante); alertas automáticos, diagnósticos ou recomendações de qualquer tipo; carga tipo TRIMP; rede social. Campos de `completedWorkouts` (metros, segundos, ISO) já são compatíveis com uma futura importação de Strava/Garmin.
