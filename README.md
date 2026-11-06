# PaceUp — hub pessoal de treinos e nutrição

PWA pessoal para uma fase de perda de gordura com preservação de massa magra. Mostra, todo dia e em 1 ou 2 toques, dois números contra as metas que você configura: **a semana de treinos** (com destaque para os 2 treinos de perna) e **a proteína do dia**. Continua acompanhando o plano de retorno à corrida de 22 semanas. Peso e musculação detalhada ficam nos apps que você já usa (balança e Gravl).

Uso diário no celular, **offline por completo**, **custo zero**, sem build e sem dependências. Roda **só no GitHub Pages**: não há servidor, Apps Script nem planilha. Os dados vivem no seu aparelho (IndexedDB) e o backup é um arquivo JSON que você salva onde quiser.

Além dos números contra metas, a aba **Semana** sugere como terminar a semana quando os treinos saem do plano. O app só sugere: nada muda sem você tocar em **Aceitar**. Continua **sem alertas clínicos ou diagnósticos**.

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
- Merge: as sessões de origem **nunca são apagadas**; o registro delas ganha status `mesclada` e `mergeId`, e a combinada guarda as origens com o registro de antes. Juntar e desfazer são uma transação só. Origem mesclada não muda pelo check, não se move e não entra em outro merge.
- Refeições: nunca num dia futuro. Registros novos usam o ID estável `refeicao:<data>:<refeicaoId>` (os antigos mantêm o UUID); se um backup trouxer dois para a mesma (data, refeição), vale o de `atualizadoEm` mais recente.

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
         sessoes-musculacao.js   configuração editável do "Juntar sessões"
         rotas-config.js         custos, penalidades e janelas do motor de rotas
  services/  dates pace schedule stats discomfort ics backup theme dominio
             agenda metas nutricao merge
             motor-rotas (motor puro) semana (liga o motor aos dados)
  views/  router today treinos semana nutricao calendar evolution history settings help
          workout-form workout-detail onboarding agenda-editor metas-editor horarios-editor
          components/ ui.js charts.js agenda-ui.js nutricao-ui.js merge-ui.js arrastar.js aviso-semana.js
  tests/ nucleo.js            asserções do núcleo (rodam em test.html)
         motor-rotas.js       cenários do motor de rotas (rodam em test.html)
```

---

## 2. Modelo de dados

IndexedDB `treinos-corrida`, **versão 5**. Cada migração só adiciona stores (`if (versaoAntiga < N)` em `db.js`); os stores existentes não são tocados.

**Corrida (v1):** `plans`, `phases`, `plannedWorkouts`, `completedWorkouts`, `discomforts`, `settings`. Dados **planejados** e **realizados** são separados por design — registrar nunca sobrescreve o plano. A região de desconforto **fáscia plantar / calcanhar** é própria, separada de "pé", por causa do histórico de fascite plantar.

**Hub (v2):**

| Store | O que guarda | Campos principais |
|---|---|---|
| `weeklySchedule` | a semana-padrão | `diaSemana` (0=dom…6=sáb), `periodo` (`manha`/`noite`), `tipo` (`musculacao`/`karate`/`corrida`), `rotulo`, `opcional` |
| `sessionLogs` | check de musculação e karatê | `data`, `scheduleItemId` (null = fora da agenda), snapshot `tipo`/`rotulo`/`periodo`/`opcional`, `status` (`feito`/`nao_feito`), `duracaoMin?`, `rpe?` |
| `foodLogs` | refeições do plano e proteína extra | `data`, `tipo` (`refeicao`/`extra`); refeição: `refeicaoId`, `varianteIndex`, `varianteNome`, `fracao` (1, ¾, ½, ¼), snapshot `macros {kcal, prot, carb, gord}`, `escolhas?` (do montar prato); extra: `proteinaG`, `descricao?` |
| `scheduleMoves` (v3) | item da agenda arrastado para outro dia/período **numa semana** | `scheduleItemId`, `dataOrigem` (o dia previsto), `data` (destino, mesma semana), `periodo`, `ordem` (posição no período). Um por (item, `dataOrigem`) |
| `sessionMerges` (v4) | sessão combinada: duas sessões de musculação juntadas numa só | `data`, `periodo`, `rotulo` ("Lower A + Lower B"), `origens` [`scheduleItemId`, `rotulo`, `dataOcorrencia`, `dataOrigem`, `logAnterior`], `plano` (snapshot da sugestão), `status` (null = pendente, `feito`/`nao_feito`), `duracaoMin?`, `rpe?`, `removido` (merge desfeito) |
| `dailyCheckins` (v5) | check-in do dia | `data`, `disposicao` (1 a 5), `dorUpper`, `dorLower`, `fascia`. Um por dia (`checkin:<data>`); fica no histórico |
| `weekExceptions` (v5) | exceções da semana | `data`, `bloqueio` (`manha`/`noite`/`dia`/null), `feriado`. Uma por dia (`excecao:<data>`) |
| `weekHistory` (v5) | histórico por semana | `inicio`, `planoOriginal`, `escolhas` (rotas aceitas e "manter": data e hora, mudanças e custo), `resultado`, `fechadaEm`. Uma por semana (`semana:<inicio>`) |

Em `sessionLogs`, o status `mesclada` (v4) marca a origem de um merge, com `mergeId` apontando para a combinada. O status `pulado` saiu do app: registros antigos ficam como estão no banco e são lidos como `nao_feito`. Em `plannedWorkouts`, `encurtada` marca a corrida que uma rota encurtou, e o status `encurtado` entra ao registrar com o campo "Corrida encurtada" (conta como feita, somando os minutos informados em `duracaoRealMin`). Em `foodLogs`, `data` é o dia a que o registro se refere e `criadoEm`/`atualizadoEm` dizem quando foi lançado.

A corrida arrastada não usa `scheduleMoves`: o próprio `plannedWorkout` é reagendado (mesmas regras de `dataOriginal`/`sequence`) e ganha `periodo` e `ordemDia` opcionais.

Metas ficam em `settings`, na chave `metas` (`js/services/metas.js`): proteína mínima e máxima por dia e treinos de Lower por semana.

Cada registro carrega `criadoEm` e `atualizadoEm`; o import de backup usa `atualizadoEm` para decidir quem vence. (Registros antigos da v1 podem ter um campo `_pendingSync` da época da sincronização com o Sheets; ele é ignorado.)

---

## 2.1 Navegação e definições

Barra inferior: **Hoje · Treinos · Semana · Nutrição · Ajustes**.

- **Hoje:** se ontem ficou sem nenhuma refeição, um aviso discreto "Ontem ficou sem registro. Completar?" leva ao dia (✕ dispensa); agenda do dia com check de 1 toque (✓ feito, ✕ não feito; tocar de novo desmarca; tocar no nome abre duração e RPE), proteína do dia contra a meta (+ proteína extra), as 4 refeições com ✓ de 1 toque (a do horário em destaque; tocar no nome escolhe a variante e a porção), resumo da semana e próxima corrida (tocar abre objetivo, RPE, zona, fase e a estrutura do treino).
- **Treinos:** *Semana* (agenda da semana com checks, aderência e "Lower X de 2", navegação entre semanas; **segurar e arrastar** um treino o leva para outro dia ou período da mesma semana, inclusive para ficar antes ou depois de outro no mesmo período; "Mover para…" na folha da sessão faz o mesmo sem arrastar; **"Juntar sessões"** junta duas de musculação pendentes — também aparece no Hoje quando há musculação atrasada), *Corrida* (progresso do plano e calendário), *Evolução* e *Histórico* da corrida. As rotas antigas `#/calendario`, `#/evolucao` e `#/historico` continuam funcionando.
- **Semana:** check-in do dia, status da semana, rotas sugeridas e a grade de 7 dias × 2 slots (seção 2.2). Quando a semana sai do plano, Hoje e Treinos mostram "Sua semana mudou, ver rotas".
- **Nutrição** (porte do App_Dieta): *Refeições* — seletor ‹ dia › com calendário (padrão hoje, futuro bloqueado); num dia passado aparecem a proteína do dia, as 4 refeições com ✓ de 1 toque e o plano, tudo gravando naquele dia; abas por refeição (abre na do horário), variantes, Alimentos/Macros, montar prato com a barra de blocos e pendências, busca de substituições sem acento, e "Marcar como feita" / "Outra porção…"; *Semana* — dias na meta e média de proteína, dia a dia (tocar num dia abre o registro dele; dia vazio mostra "sem registro · completar"), e as 3 semanas anteriores; *Orientações* — mensagem, hidratação, refeição livre, orientações gerais, links com cupons e contato (dados do plano que o App_Dieta guardava mas não exibia).
- **Ajustes:** Agenda semanal, Horários para treinar, Metas, preferências da corrida, `.ics`, backup e "Recomeçar o plano de corrida".

A corrida do dia vem **sempre do plano de corrida** (`plannedWorkouts`); os itens `corrida` da agenda só indicam dia e período. O ✓ da corrida leva ao formulário de registro de sempre, que tem o campo "Corrida encurtada", e o ✕ marca "não realizado".

**Definições usadas nos números:**
- **Previstos da semana:** itens não opcionais da agenda + corridas do plano na semana.
- **Aderência:** feitos ÷ previstos. Opcional feito e treino fora da agenda contam como *extra*.
- **Lower da semana:** sessões de musculação **feitas** com rótulo começando por "Lower", em qualquer dia (inclusive fora da agenda).
- **Remanejamento:** um "treino fora da agenda" com o mesmo rótulo de um item da semana ainda não feito (ex.: Lower B no sábado em vez de domingo) vale por aquele item: o item aparece como "Feito no sábado" e conta na aderência, e a sessão aparece como "Vale pelo treino de domingo", sem contar como extra.
- **Treino movido (arrastar):** vale só para aquela semana; a agenda-padrão não muda. O treino continua previsto uma vez só, agora no novo dia ("Movido de segunda"). Se estava "não feito", a marcação sai e ele volta a ficar pendente; se estava "feito", o registro vai junto. Tocar no nome mostra "Voltar para segunda · manhã". Não se movem: corrida já registrada, treino já feito em outro dia (remanejado) e treino fora da agenda.
- **Proteína do dia:** soma de `macros.prot × fração` das refeições registradas mais a proteína extra. As macros vêm da tabela de **estimativas** por refeição e variante (`MACROS` em `js/data/plano-alimentar.js`), não são valores oficiais da nutricionista, e a interface sempre mostra o selo "estimativa".
- **Bateu a meta:** proteína do dia ≥ mínimo configurado em Metas.
- **Média semanal de proteína:** só dos dias com algum registro; dias sem registro aparecem à parte, para que esquecer de lançar não pareça dia de proteína baixa.
- **Média de 7 dias:** os 7 dias que terminam no dia exibido, com a mesma regra: dia sem registro fica **fora** da média (não entra como zero). Aparece no card de proteína do Hoje e da Nutrição.
- **Registro retroativo:** qualquer dia passado pode ser lançado, editado ou removido, sem limite para trás (o upsert por dia e refeição e a exclusão lógica tornam isso seguro). O que foi lançado depois do dia ganha um 🕐 discreto e vale igual.
- **Sessão combinada (merge):** duas sessões de **musculação** pendentes (sem registro ou não feitas) da **mesma semana** viram uma, num dia dessa semana. Corrida, karatê e sessões feitas não entram. Upper + Lower é permitido, com aviso de full body longo. A combinada não é um previsto novo nem extra: cada origem continua prevista uma vez e segue o status dela — combinada feita = as duas origens **cobertas** (contam como feitas e, se Lower, no "Lower X de 2"); pendente = pendentes; não feita = idem. O resumo mostra "Musculação: 4 de 4 cobertas (1 mesclada)". Dá para desfazer enquanto a combinada não estiver feita: as origens voltam exatamente como estavam.
- **Sugestão da combinada:** vem de `js/data/sessoes-musculacao.js` (itens obrigatórios e acessórios por sessão — edite à vontade). Une os itens das duas sessões com **um por slot** (uma flexora e uma panturrilha só), compostos primeiro, isoladores depois, bi-set extensora + flexora; se passar de ~20 séries ou de 70 min, corta acessórios primeiro (adução, core) e depois séries de isoladores. Mostra o volume por grupo contra a meta semanal (quadríceps ~10, posterior e glúteo ~8, panturrilha ~6). É o plano; o volume real continua no Gravl.
- **Dia seguinte pesado:** corrida ou karatê intenso no dia seguinte à combinada mostra "Deixe 2 a 3 repetições na reserva, sem dropset e sem falha."
- **Musculação atrasada:** o convite da tela Hoje e "Reorganizar a semana" só consideram treino sem registro; treino com ✕ já foi resolvido e não é cobrado de novo.
- **Reorganizar a semana:** depois do merge, as sessões de musculação de dias passados que ficaram sem registro podem ir para um dia livre (sem musculação) de hoje em diante.

## 2.2 Aba Semana e motor de rotas

O motor (`js/services/motor-rotas.js`) é um conjunto de funções puras: recebe o estado e devolve resultados, sem DOM e sem banco. `js/services/semana.js` lê os dados, aplica a rota aceita com as funções que já existem (`moverEntrada`, `juntar`, status) e grava o histórico. **Custos, penalidades e janelas ficam em `js/data/rotas-config.js`.**

- **Slots:** cada dia tem manhã e noite. Dia útil: manhã até 9h, noite até 22h. Sábado, domingo e feriado: manhã até 13h, tarde/noite até 22h. Slot livre = marcado em Ajustes → Horários para treinar, sem "não posso", não passou e sem sessão.
- **Sem registro:** treino num slot que passou sem status. A aula opcional não entra: perdê-la não gera aviso nem custo, e pendente não conta no limite de 3 karatês.
- **Regras obrigatórias:** feita não muda; karatê só nas noites de aula; até 3 karatês; karatê e corrida nunca no mesmo dia; Lower nunca em dias seguidos nem no dia do intenso; até 2 treinos por dia; duas corridas nunca no mesmo dia; piso de 1 Upper e 1 Lower; com dor na fáscia, a corrida de hoje só encurtada ou não feita (e não vai para outro dia). Regra quebrada só entre treinos feitos não conta.
- **Dois treinos no mesmo período** são permitidos quando você arruma assim, e isso não gera aviso. O motor, por conta própria, só usa slots livres.
- **O que você move** vira o plano da semana e não conta como mudança de rota; só gera aviso se quebrar uma regra.
- **Treino com ✕** fica como está. O motor só o reabre sozinho se o piso de musculação estiver quebrado.
- **Recalcular:** a checagem automática só decide se há aviso. As rotas só são buscadas no botão **Recalcular semana de treinos**, e marcar treinos mostra "Registros atualizados" até você tocar nele. Com a semana em dia, o botão oferece "Manter como está" e alternativas, quando o check-in pesa num treino de hoje ou quando dá para recuperar um treino com ✕ (o ✕ de uma rota aceita não volta a ser oferecido).
- **Rotas:** até 3 mudanças (mover, juntar, encurtar, não fazer), em camadas de 1, 2 e 3; custo = operações + penalidades; até 3 rotas, sem repetir a mesma semana final.
- **Semana comprometida:** sem rota para tudo, a rota garante o piso de musculação com o que dá tempo, e o resto sem registro vira não feito ao aceitar. Tudo pode ser corrigido depois.
- **Check-in:** vale só para o dia. Disposição 1 e 2 = cansado; dor em Upper ou Lower pesa no treino de hoje; só a dor na fáscia gera aviso sozinha. Sem check-in: disposição 3 e sem dor.
- **Fechamento:** sem servidor, a semana fecha na primeira abertura depois de domingo: o pendente vira não feito (menos a aula opcional). Semana fechada continua editável, e o resultado acompanha.

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

Os dados ficam só no aparelho; o backup é um arquivo JSON com todos os stores (corrida, agenda, sessões, sessões combinadas e refeições — com o status `mesclada`, o vínculo `mergeId` e os merges desfeitos como tombstone).

- **Exportar:** **Ajustes → Exportar backup (JSON)**. O celular abre o menu de compartilhar: salve no **Google Drive** ou no app **Arquivos**. Se o compartilhar não estiver disponível, o arquivo é baixado; em último caso, o conteúdo vai para a área de transferência.
- **Restaurar ou trocar de aparelho:** **Ajustes → Importar backup (JSON)**. O merge é por ID com last-write-wins: importar duas vezes não duplica, e um backup antigo não sobrescreve dado mais novo. Um backup feito antes do hub (só corrida) importa normalmente.
- O app avisa quando o último backup passa de **14 dias**.

> **Sincronização com Google Sheets removida.** As versões anteriores podiam espelhar os dados numa planilha via Apps Script e mandar lembrete por e-mail. Isso saiu: o PaceUp não depende de nada além do GitHub Pages. Se você chegou a publicar o Apps Script, ele e a planilha continuam na sua conta Google até você apagá-los; o app não fala mais com eles. A URL e o token que estavam em Ajustes ficam guardados sem uso.

---

## 8. Testes

Abra **`test.html`** (servido por HTTP) — roda asserções em JS puro contra a camada de dados e serviços, e mostra ✓/✗. Cobre: CRUD nos seis stores da corrida; cálculo de pace com bordas (distância/tempo zero, vírgula decimal); registrar não altera o planejado além do status; alterar o plano não mexe no realizado; reagendar preserva `dataOriginal`; importar backup não duplica e respeita last-write-wins; trava de duplicação; aderência com semana parcial/vazia; recorrência de desconforto com poucos treinos; `.ics` com `SEQUENCE` e `UID` estável; virada de mês/ano.

Hub: **migração v1→v2** a partir de um banco v1 de verdade, com dados (registros idênticos byte a byte, índices funcionando, stores novos vazios); seed da agenda idempotente e que respeita remoções; metas com mescla, validação e descarte de campos antigos; uma sessão por (data, item) com edição, desmarcar e reativar sem duplicar; aderência que ignora opcionais e conta Lower fora do dia; remanejamento de treino fora da agenda; backup v1 importando no v2 sem duplicar; plano alimentar com quantidades literais (amostras do PDF); proteína do dia com porção, extras, edição sem duplicar e tombstone; semana de proteína com média só dos dias registrados; busca sem acento e pendências do montar prato.

Motor de rotas (`js/tests/motor-rotas.js`): os 7 cenários da especificação, verificando propriedades do resultado, mais karatê opcional, reabrir ✕ com o piso quebrado, recuperar ✕, check-in, dois treinos no mesmo período, voltar ao lugar original e horários fora da grade. Aba Semana (`nucleo.js`): migração v4→v5, aceitar rota, encurtado, status só atualizando no Recalcular, semana comprometida, fechamento e backup dos stores novos.

v4: **migração v3→v4** a partir de um banco v3 com dados em todos os stores (registros idênticos byte a byte, índices funcionando, `sessionMerges` vazio); merge no repository (origens `mesclada` com vínculo, desfazer restaurando sem registro / não feito, recusa depois de feita); bloqueios (feita, corrida, karatê, semanas diferentes, combinada fora da semana, a mesma sessão duas vezes) e aviso de Upper + Lower; sugestão Lower A + Lower B sem duplicados, compostos primeiro, bi-set, dentro do teto e cortes em ordem; aviso do dia seguinte; o caso de 31/10 de ponta a ponta (juntar, desfazer, juntar de novo, Upper A para domingo, "4 de 4 cobertas (1 mesclada)", Lower 2 de 2, backup sem duplicar); registro retroativo atualizando o total do dia e a média de 7 dias; dia sem registro fora da média; registrar duas vezes o mesmo dia e refeição sem duplicar; dia futuro recusado; lembrete de lacuna; duplicado de backup contado uma vez.

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
- [ ] Nenhum diagnóstico ou alerta clínico; rotas são sugestões e nada muda sem tocar em Aceitar.

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
- [ ] Hoje mostra a agenda do dia; ✓ / ✕ marcam em **1 toque** e tocar de novo desmarca.
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

**Juntar sessões (merge)**
- [ ] Ao atualizar para a v4, **todos os dados continuam** (corrida, agenda, sessões, refeições, treinos movidos).
- [ ] "Juntar sessões" aparece em Treinos → Semana (2+ pendentes) e no Hoje (musculação atrasada); vem com Lower A + Lower B marcados.
- [ ] A prévia mostra uma flexora e uma panturrilha só, compostos primeiro, bi-set, ~20 séries, minutos, volume × meta e o que foi cortado.
- [ ] Dia seguinte com corrida ou karatê intenso mostra o aviso de reps na reserva; Upper + Lower mostra o aviso de full body.
- [ ] Depois de juntar, "Reorganizar a semana" leva a sessão atrasada para um dia livre.
- [ ] As origens aparecem como "Mesclada → sábado" sem check; a combinada tem ✓ ✕.
- [ ] Com a combinada feita: "Musculação: 4 de 4 cobertas (1 mesclada)" e "Lower 2 de 2".
- [ ] "Desfazer merge" devolve as duas sessões como estavam; com a combinada feita, não desfaz.
- [ ] "Mover para…" na folha da sessão muda dia e período sem arrastar.

**Registro retroativo de refeições**
- [ ] Nutrição → Refeições: ‹ › e o calendário trocam o dia; › e o calendário não vão além de hoje.
- [ ] Num dia passado, ✓ numa refeição soma na hora no total do dia e na média de 7 dias; tocar de novo desfaz.
- [ ] Marcar de novo a mesma refeição no mesmo dia edita, não duplica.
- [ ] Dia sem registro aparece como "sem registro" e fica fora da média.
- [ ] O que foi lançado depois do dia mostra 🕐.
- [ ] Hoje mostra "Ontem ficou sem registro. Completar?" quando ontem está vazio; ✕ some com o aviso.

**Backup**
- [ ] Exportar backup abre o compartilhar; salvar no Drive ou no Arquivos funciona.
- [ ] Importar o backup em outro navegador traz corrida, agenda, sessões e refeições, sem duplicar.
- [ ] Aviso quando o último backup passa de 14 dias.

**Robustez**
- [ ] **Recarregar durante o preenchimento** de um formulário não trava o app (o botão "Atualizar" do service worker só aparece sob confirmação).
- [ ] Atualização do banco com outra aba aberta mostra "Atualizando os dados do app…" e conclui ao fechar a outra aba (não dá erro).
- [ ] Datas corretas na **virada de mês e de ano** (sem bug de UTC).
- [ ] Tempo até interativo abaixo de ~1s em conexão comum.

**Aba Semana**
- [ ] Ao atualizar para a v5, **todos os dados continuam**, e não aparece mais o botão ↷.
- [ ] Treino sem registro aparece na aba Semana e gera "Sua semana mudou, ver rotas" em Hoje e Treinos.
- [ ] Marcar treinos mostra "Registros atualizados"; a semana só muda ao tocar em Recalcular.
- [ ] Aceitar uma rota volta a "Semana em dia, segue como está".
- [ ] Check-in: disposição e dor muscular não geram aviso; fáscia "sim" no dia da corrida gera.
- [ ] Toque no dia da grade: "não posso" e "feriado" valem só para a semana.
- [ ] Corrida encurtada: o formulário traz o campo marcado quando uma rota encurtou, e ela conta como feita.
- [ ] Ajustes → Horários para treinar muda o que as rotas sugerem.

### Roteiro rápido no celular (v5)

Antes: **Ajustes → Exportar backup**. Depois abra o app e toque em "Atualizar" quando aparecer.

1. Em **Semana**, responda o check-in e veja a grade com os seus treinos.
2. Se houver treino sem registro, marque ✓ ou ✕ e toque em **Recalcular semana de treinos**.
3. Abra "O que não fazer?" e aceite uma rota: a grade muda e a tela volta a "Semana em dia".
4. Em Treinos, arraste um treino para um dia que quebre uma regra (corrida na sexta, com karatê): o aviso aparece em Hoje e Treinos.
5. Em Ajustes → **Horários para treinar**, desmarque os horários em que você nunca treina.

### Roteiro rápido no celular (v4)

Antes: **Ajustes → Exportar backup**. Depois abra o app, toque em "Atualizar" quando aparecer e confira que a semana e as refeições continuam lá.

1. **Caso de 31/10.** Em Treinos → Semana, deixe o Lower A de quinta sem marcar (ou ✕) e o Lower B de domingo pendente. Toque em **Juntar sessões**: Lower A e Lower B vêm marcados. Escolha **sáb**, **Manhã**, confira a prévia (uma flexora, uma panturrilha, ~20 séries) e toque em **Juntar**.
2. Na folha **Reorganizar a semana**, mova o **Upper A → domingo**. A semana mostra a combinada no sábado, Lower A e Lower B como "Mesclada → sábado" e o Upper A no domingo ("Movido de segunda").
3. Toque no nome da combinada: confira o plano e o botão **Desfazer merge**. Desfaça, veja as duas sessões voltarem, e junte de novo.
4. Marque ✓ na combinada e no Upper A: o resumo mostra **"Musculação: 4 de 4 cobertas (1 mesclada)"** e **Lower 2 de 2**.
5. **Refeições de um dia anterior.** Em Nutrição → Refeições, toque em ‹ até um dia passado (ou no 📅). Marque ✓ em duas refeições: a proteína do dia e a **média de 7 dias** mudam na hora, e as refeições ganham 🕐. Tente › além de hoje: não deixa.
6. Em Nutrição → Semana, o dia completado mostra 🕐; um dia vazio mostra "sem registro · completar" e abre o dia ao tocar.
7. Se ontem ficou vazio, a tela Hoje mostra "Ontem ficou sem registro. Completar?".

---

## 10. O que não está incluído (por decisão)

Servidor de qualquer tipo (Web Push, Apps Script, sincronização, lembrete por e-mail); acompanhamento de peso e composição corporal (fica no app da balança); logger ou importação de musculação (fica no Gravl); GPS/rastreamento ao vivo; múltiplos planos simultâneos na UI (o schema suporta via `planId`); macros por alimento (as estimativas são por refeição e variante); alertas clínicos ou diagnósticos; aprendizado com o histórico da semana, calendário automático de feriados e rotas com IA (o histórico já é guardado para uma versão futura); carga tipo TRIMP; rede social. Campos de `completedWorkouts` (metros, segundos, ISO) já são compatíveis com uma futura importação de Strava/Garmin.
