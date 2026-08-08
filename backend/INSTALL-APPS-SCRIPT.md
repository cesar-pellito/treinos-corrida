# Apps Script — sincronização + lembrete por e-mail (passo a passo)

Este backend faz duas coisas, ambas de graça: **espelha seus dados numa planilha** (sincronização/backup na nuvem) e **envia o lembrete de treino por e-mail na véspera**. O app continua 100% offline; isto roda em segundo plano.

Você faz isto **uma vez**. Leva ~10 minutos.

---

## Parte A — Criar a planilha

1. Abra [sheets.google.com](https://sheets.google.com) e crie uma **planilha em branco**. Dê um nome (ex.: *Treinos de Corrida — dados*).
2. Ajuste o fuso horário: **Arquivo → Configurações → Fuso horário → (GMT-03:00) São Paulo → Salvar**. (Isso faz o "amanhã" do e-mail bater com o seu dia.)
3. Copie o **ID da planilha** da URL do navegador — é a parte entre `/d/` e `/edit`:
   `https://docs.google.com/spreadsheets/d/`**`ESTE_TRECHO_É_O_ID`**`/edit`

---

## Parte B — Criar o projeto Apps Script e colar o código

4. Na planilha, menu **Extensões → Apps Script**. Abre o editor num nova aba.
5. Apague o conteúdo do arquivo `Código.gs` que vem por padrão.
6. Abra o arquivo **`backend/Codigo.gs`** deste projeto, copie **tudo** e cole no editor.
7. Clique no ícone de **salvar** (disquete) ou `Ctrl+S`. Dê um nome ao projeto se pedir (ex.: *Treinos Corrida*).

---

## Parte C — Definir as propriedades do script

8. No editor, clique na engrenagem **⚙ Configurações do projeto** (menu à esquerda).
9. Role até **Propriedades do script → Adicionar propriedade do script** e crie:

   | Propriedade | Valor |
   |---|---|
   | `SHEET_ID` | o ID da planilha (Parte A, passo 3) |
   | `TOKEN` | uma senha longa que você inventa (ex.: 30+ caracteres aleatórios) |
   | `EMAIL` *(opcional)* | o e-mail que vai receber os lembretes (padrão: a sua própria conta) |
   | `LEMBRETE_HORA` *(opcional)* | hora do envio, 0–23 (padrão: `20`) |

10. Clique em **Salvar propriedades do script**.

> Guarde o `TOKEN`: você vai colá-lo no app. Ele é o que protege o endpoint — sem ele, ninguém escreve nem lê seus dados.

---

## Parte D — Publicar como App da Web

11. No editor, canto superior direito: **Implantar → Nova implantação**.
12. Clique na engrenagem ⚙ ao lado de "Selecione o tipo" e escolha **App da Web**.
13. Configure:
    - **Descrição:** qualquer coisa (ex.: v1).
    - **Executar como:** **Eu (seu e-mail)**.
    - **Quem tem acesso:** **Qualquer pessoa**.
14. Clique em **Implantar**.
15. Vai aparecer um pedido de **autorização**. Autorize com sua conta. Se surgir um aviso de "app não verificado": **Avançado → Acessar Treinos Corrida (não seguro)** → **Permitir**. (É o seu próprio script; o aviso é padrão do Google para projetos pessoais.)
16. Copie a **URL do app da Web** que aparece (termina em `/exec`).

---

## Parte E — Conectar o app

17. No app, abra **Ajustes → Sincronização**.
18. Cole a **URL do app da Web** e o **mesmo TOKEN** da Parte C.
19. Toque em **Salvar e testar conexão** → deve aparecer "Conexão OK".
20. Toque em **Sincronizar agora**. Isso envia seus treinos para a planilha (necessário para o lembrete por e-mail funcionar).

---

## Parte F — Ligar o lembrete por e-mail

21. Volte ao editor do Apps Script.
22. Na barra de ferramentas, no seletor de função (ao lado de "Depurar"/"Executar"), escolha **`instalarGatilhoLembrete`**.
23. Clique em **Executar**. Autorize o **envio de e-mail** quando pedir (mesmo fluxo do passo 15).
24. Pronto: todo dia, na `LEMBRETE_HORA`, se houver treino **amanhã**, você recebe o e-mail com o resumo. Em dia de descanso, não chega nada.

**Testar agora:** selecione a função **`testarLembreteAgora`** e clique em Executar. Se houver treino amanhã na planilha, o e-mail chega em segundos.

---

## Depois: manutenção

- **Reagendou/remarcou um treino?** Só **Sincronizar agora** no app. O e-mail e a planilha passam a usar o dado novo.
- **Mudou o código do `Codigo.gs`?** Republique mantendo a **mesma URL**: **Implantar → Gerenciar implantações → (lápis de editar) → Versão: Nova versão → Implantar**. (Só use "Nova implantação" se quiser uma URL nova — aí precisa recolar no app.)
- **Trocar a hora do lembrete?** Altere `LEMBRETE_HORA` nas propriedades e rode `instalarGatilhoLembrete` de novo.

---

## Se algo falhar

- **"Token inválido"** ao testar conexão: o `TOKEN` no app e nas propriedades do script estão diferentes.
- **Conexão falha / CORS:** confira que "Quem tem acesso" está em **Qualquer pessoa** e que a URL termina em `/exec` (não `/dev`).
- **E-mail não chega:** você rodou `instalarGatilhoLembrete` e autorizou o envio? Há treino **amanhã** na planilha (sincronizou)? O fuso da planilha está correto?
