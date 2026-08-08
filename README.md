# Treinos de Corrida — PWA pessoal

App pessoal para acompanhar um plano de retorno à corrida de 22 semanas. Uso diário no celular, **offline por completo**, **custo zero**, sem build e sem dependências. Os dados vivem no seu aparelho (IndexedDB) e, opcionalmente, sincronizam com uma planilha do Google Sheets.

---

## 1. Arquitetura e decisões

### Stack: HTML + CSS + JavaScript vanilla, ES modules, sem build
O que está no repositório é exatamente o que roda no navegador. Nenhum bundler, framework ou `npm install`. Motivo: manutenção de um único dono ao longo de meses — toolchain de frontend apodrece; HTML e JS não. Os gráficos são SVG gerados à mão (`js/views/components/charts.js`).

### Local-first: IndexedDB é a fonte da verdade
Não há backend. Toda escrita é local e síncrona do ponto de vista do usuário — nunca existe estado "aguardando servidor". Um único usuário com um dispositivo principal não tem problema de sincronização; tem problema de **backup**.

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
- Import/merge por ID com **last-write-wins** por `atualizadoEm` — nunca duplica.

### Unidades e datas
Internamente: distância em **metros**, duração em **segundos**, timestamps ISO. Formatação (km, `mm:ss`, `6:48 /km`) só na camada de apresentação. Datas de calendário em ISO **tratadas em fuso local** (`js/services/dates.js`) para evitar o clássico bug de `new Date('2026-08-03')` virar o dia anterior por interpretação UTC.

### Estrutura de arquivos
```
index.html · manifest.webmanifest · service-worker.js · test.html
data/plano-seed.json          os 66 treinos derivados do plano
assets/icons/                 ícones do PWA
styles/app.css                design system (tema claro/escuro)
backend/Codigo.gs             Apps Script da sincronização (você publica)
js/
  app.js                      bootstrap: SW, tema, onboarding/roteamento, sync
  data/  db.js repository.js seed.js
  services/  dates pace schedule stats discomfort ics backup sync theme dominio
  views/  router today calendar evolution history settings help
          workout-form workout-detail onboarding
          components/ ui.js charts.js
  tests/ nucleo.js            asserções do núcleo (rodam em test.html)
```

---

## 2. Modelo de dados

Seis object stores no IndexedDB: `plans`, `phases`, `plannedWorkouts`, `completedWorkouts`, `discomforts`, `settings`. Dados **planejados** e **realizados** são separados por design — registrar nunca sobrescreve o plano. A região de desconforto **fáscia plantar / calcanhar** é própria, separada de "pé", por causa do histórico de fascite plantar.

Cada registro carrega `atualizadoEm` e `_pendingSync` para a sincronização opcional.

---

## 3. Lembretes: calendário nativo (.ics), não push

O app **não** usa Web Push (exigiria servidor com chaves VAPID, violando o custo zero) nem tenta agendar notificações locais (não há API confiável em PWA, menos ainda no iOS). Em vez disso, gera um arquivo **`.ics`** com todos os treinos futuros; você importa uma vez no Google Agenda e o sistema operacional cuida do lembrete — com o app fechado, sem servidor.

**Limitações que você precisa conhecer (documentadas também na tela de Ajuda):**
- O **Google Agenda ignora o horário de alarme** do arquivo importado e usa a notificação padrão da sua conta. Por isso os eventos têm um **horário real** (manhã, configurável) para a notificação padrão se ancorar. Ajuste a antecedência padrão do seu calendário. O alarme de "20:00 do dia anterior" só é respeitado pelo **Apple Calendar**.
- Reimportar por cima **pode duplicar** no Google. Ao reagendar, use um **calendário dedicado** ("Plano de Corrida") e reimporte-o inteiro. Os eventos usam `UID` estável + `SEQUENCE` incrementado (o Apple Calendar atualiza sem duplicar; o Google, via arquivo, não é confiável nisso).
- **Sem importar o .ics, não há lembrete.** O app apenas gera o arquivo.

### Lembrete por e-mail na véspera (recomendado para Google)
Como o Google Agenda ignora o alarme do `.ics`, o jeito **confiável** de receber um lembrete às 20:00 do dia anterior é por **e-mail**, enviado por um gatilho de tempo do mesmo Apps Script da sincronização (custo zero, com o app fechado, no horário exato que você escolher). Ele lê os treinos da planilha e, se houver treino amanhã, envia o resumo. Em dia de descanso, não manda nada. Passo a passo no topo de [`backend/Codigo.gs`](backend/Codigo.gs) (funções `enviarLembretesDiarios` / `instalarGatilhoLembrete`). Requer a **sincronização ativa** (a planilha precisa ter os treinos) — ver seção 7.

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

## 7. Sincronização com Google Sheets (opcional)

Mantém uma cópia na nuvem e sincroniza entre dispositivos, sem custo. **O app continua 100% offline**; o sync roda em segundo plano. Passo a passo completo no topo de [`backend/Codigo.gs`](backend/Codigo.gs). Resumo:

1. Crie uma planilha e copie o ID dela.
2. Extensões → Apps Script → cole `backend/Codigo.gs`.
3. Propriedades do script: `SHEET_ID` e `TOKEN` (uma senha longa sua).
4. Implantar como **App da Web** (executar como você; acesso: qualquer pessoa).
5. No app, **Ajustes → Sincronização**: cole a URL e o mesmo `TOKEN` → **Salvar e testar** → **Sincronizar agora**.

O `TOKEN` protege o endpoint: sem ele, o servidor recusa. Como o repositório é público, a URL e o token ficam guardados só no seu aparelho (em `settings`), nunca no código.

---

## 8. Testes

Abra **`test.html`** (servido por HTTP) — roda asserções em JS puro contra a camada de dados e serviços, e mostra ✓/✗. Cobre: CRUD nos seis stores; cálculo de pace com bordas (distância/tempo zero, vírgula decimal); registrar não altera o planejado além do status; alterar o plano não mexe no realizado; reagendar preserva `dataOriginal`; importar backup não duplica e respeita last-write-wins; trava de duplicação; aderência com semana parcial/vazia; recorrência de desconforto com poucos treinos; `.ics` com `SEQUENCE` e `UID` estável; virada de mês/ano.

---

## 9. Checklist de validação

Marque cada item ao validar uma nova instalação.

**Restrições inegociáveis**
- [ ] Abre e navega **offline** (modo avião), consulta o treino de hoje.
- [ ] **Registra um treino offline**; fecha e reabre o app — o dado continua lá.
- [ ] **Instalável** na tela inicial e abre em **modo standalone** (tela cheia).
- [ ] Custo de infraestrutura **zero** (sem servidor obrigatório).
- [ ] Planejado e realizado ficam **separados**; registrar não sobrescreve o plano.
- [ ] Histórico **imutável**: alterar/reagendar o plano não muda nenhum realizado.
- [ ] Nenhuma recomendação médica, diagnóstico ou alerta clínico.

**Regras de dados**
- [ ] Registrar altera **apenas o `status`** do planejado.
- [ ] Reagendar preserva a **data original** mesmo após vários reagendamentos.
- [ ] Importar o mesmo backup duas vezes **não duplica**; backup antigo não sobrescreve dado novo.
- [ ] Não é possível registrar **dois realizados** para o mesmo treino planejado.

**Funcionalidade**
- [ ] Pace **calculado ao vivo** no formato `6:48 /km`; avisos (sem bloquear) fora de faixa.
- [ ] Comparativo **planejado × realizado** com deltas.
- [ ] Gráficos de Evolução renderizam (volume, consistência, pace/FC fácil, RPE).
- [ ] Recorrência de desconforto (contagem factual dos últimos treinos).
- [ ] Exporta **`.ics`** com `UID`/`SEQUENCE`/alarme; reagendar incrementa `SEQUENCE`.
- [ ] Backup **exporta e importa** JSON; aviso quando o último backup passa de 14 dias.

**Robustez**
- [ ] **Recarregar durante o preenchimento** de um formulário não trava o app (o botão "Atualizar" do service worker só aparece sob confirmação).
- [ ] Datas corretas na **virada de mês e de ano** (sem bug de UTC).
- [ ] Tempo até interativo abaixo de ~1s em conexão comum.

---

## 10. O que não está incluído (por decisão)

Web Push; backend/sync server obrigatório; GPS/rastreamento ao vivo; múltiplos planos simultâneos na UI (o schema suporta via `planId`); metas configuráveis; alertas automáticos de progressão; carga tipo TRIMP; rede social. Campos de `completedWorkouts` (metros, segundos, ISO) já são compatíveis com uma futura importação de Strava/Garmin.
