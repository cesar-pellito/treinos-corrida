/**
 * Codigo.gs — backend de sincronização (Google Apps Script) para o app
 * "Treinos de Corrida". Espelha o IndexedDB numa planilha do Google Sheets.
 *
 * NÃO é o banco: o app é a fonte da verdade e funciona 100% offline. Isto aqui
 * é um destino de sincronização/backup na nuvem, com custo zero.
 *
 * === COMO PUBLICAR (uma vez) ===
 * 1. Crie uma planilha nova no Google Sheets. Copie o ID dela da URL
 *    (a parte entre /d/ e /edit).
 * 2. Extensões > Apps Script. Apague o conteúdo e cole este arquivo.
 * 3. Em Configurações do projeto > Propriedades do script, adicione:
 *      SHEET_ID  = <o ID da planilha>
 *      TOKEN     = <uma senha longa que você inventar>
 * 4. Implantar > Nova implantação > Tipo: App da Web.
 *      - Executar como: Eu
 *      - Quem tem acesso: Qualquer pessoa
 *    Copie a URL do app da Web.
 * 5. No app, em Ajustes > Sincronização, cole a URL e o mesmo TOKEN.
 *
 * Os dados NÃO ficam públicos: quem não tem o TOKEN recebe erro.
 *
 * === LEMBRETE POR E-MAIL (opcional, resolve o "20:00 do dia anterior") ===
 * O Google Agenda ignora o alarme do arquivo .ics. Para receber um lembrete
 * confiável na véspera, use este backend para enviar um e-mail diário:
 * 6. Sincronize o app pelo menos uma vez (para a planilha ter os treinos).
 * 7. (Opcional) Em Propriedades do script, defina:
 *      LEMBRETE_HORA = 20     (hora do envio; padrão 20)
 *      EMAIL         = seu@email.com   (padrão: a conta dona do script)
 * 8. No editor do Apps Script, selecione a função `instalarGatilhoLembrete`
 *    e clique em Executar uma vez (autorize o envio de e-mail quando pedir).
 *    Pronto: todo dia, na hora escolhida, se houver treino AMANHÃ, você recebe
 *    um e-mail com o resumo. Em dia de descanso, não envia nada.
 * Reagendou um treino? Basta sincronizar; o e-mail usa sempre o dado atual.
 */

var STORES = ["plans", "phases", "plannedWorkouts", "completedWorkouts", "discomforts", "settings"];
var CHAVE = { settings: "chave" }; // demais usam "id"

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var props = PropertiesService.getScriptProperties();
    if (String(body.token || "") !== String(props.getProperty("TOKEN"))) {
      return json({ ok: false, erro: "Token inválido." });
    }
    if (body.acao === "ping") return json({ ok: true, serverTime: new Date().toISOString() });
    if (body.acao === "sync") return json(sync_(body));
    return json({ ok: false, erro: "Ação desconhecida." });
  } catch (err) {
    return json({ ok: false, erro: String(err) });
  }
}

function sync_(body) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty("SHEET_ID"));
    var since = body.since || "";
    var push = body.push || {};
    var out = {};
    STORES.forEach(function (store) {
      var sheet = aba_(ss, store);
      var dados = lerAba_(sheet); // {chave: {rec, rowIndex}}
      var chave = CHAVE[store] || "id";

      // aplica os registros enviados (last-write-wins por atualizadoEm)
      (push[store] || []).forEach(function (rec) {
        var k = rec[chave];
        if (k == null) return;
        rec._pendingSync = false; // no servidor nada fica pendente
        var existente = dados[k];
        if (!existente) {
          sheet.appendRow([String(k), rec.atualizadoEm || "", JSON.stringify(rec)]);
          dados[k] = { rec: rec, rowIndex: sheet.getLastRow() };
        } else if ((rec.atualizadoEm || "") > (existente.rec.atualizadoEm || "")) {
          sheet.getRange(existente.rowIndex, 1, 1, 3).setValues([[String(k), rec.atualizadoEm || "", JSON.stringify(rec)]]);
          existente.rec = rec;
        }
      });

      // devolve o que mudou no servidor desde `since`
      var mudados = [];
      Object.keys(dados).forEach(function (k) {
        var r = dados[k].rec;
        if (!since || (r.atualizadoEm || "") > since) mudados.push(r);
      });
      out[store] = mudados;
    });
    return { ok: true, serverTime: new Date().toISOString(), records: out };
  } finally {
    lock.releaseLock();
  }
}

function aba_(ss, nome) {
  var sh = ss.getSheetByName(nome);
  if (!sh) { sh = ss.insertSheet(nome); sh.appendRow(["chave", "atualizadoEm", "__json"]); }
  return sh;
}

function lerAba_(sheet) {
  var valores = sheet.getDataRange().getValues();
  var mapa = {};
  for (var i = 1; i < valores.length; i++) {
    var linha = valores[i];
    if (!linha[0]) continue;
    try { mapa[String(linha[0])] = { rec: JSON.parse(linha[2]), rowIndex: i + 1 }; } catch (e) {}
  }
  return mapa;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ===========================================================================
// Lembrete por e-mail — enviado por um gatilho de tempo diário do Apps Script.
// Resolve o lembrete da véspera de forma confiável, mesmo no Google Agenda.
// Depende da sincronização estar ativa (a planilha precisa ter os treinos).
// ===========================================================================

/** Rodada diária: se houver treino AMANHÃ, manda o resumo por e-mail. */
function enviarLembretesDiarios() {
  var props = PropertiesService.getScriptProperties();
  var ss = SpreadsheetApp.openById(props.getProperty("SHEET_ID"));
  var tz = ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone();
  var amanha = Utilities.formatDate(new Date(Date.now() + 24 * 60 * 60 * 1000), tz, "yyyy-MM-dd");

  var sheet = ss.getSheetByName("plannedWorkouts");
  if (!sheet) return;
  var dados = lerAba_(sheet);
  var treinos = [];
  Object.keys(dados).forEach(function (k) {
    var w = dados[k].rec;
    if (w && w.dataPlanejada === amanha && w.status !== "concluido" && w.status !== "nao_realizado") {
      treinos.push(w);
    }
  });
  if (!treinos.length) return; // descanso amanhã: não envia

  var email = props.getProperty("EMAIL") || Session.getEffectiveUser().getEmail();
  var assunto = "Treino de amanhã — " + treinos.map(function (w) { return w.titulo; }).join(", ");
  var corpo = treinos.map(corpoLembrete_).join("\n\n----------------------------------------\n\n");
  MailApp.sendEmail(email, assunto, corpo);
}

function corpoLembrete_(w) {
  return [
    w.titulo + " (Semana " + w.semana + ")",
    w.descricao ? "Dose: " + w.descricao : "",
    "Duração: " + w.duracaoMin + " min · RPE " + w.rpeMin + "–" + w.rpeMax + (w.zonaFC ? " · Zona FC " + w.zonaFC : ""),
    w.objetivoFisiologico ? "Objetivo: " + w.objetivoFisiologico : "",
    w.aquecimento ? "Aquecimento: " + w.aquecimento : "",
    w.partePrincipal ? "Principal: " + w.partePrincipal : "",
    w.desaquecimento ? "Desaquecimento: " + w.desaquecimento : "",
  ].filter(function (x) { return x; }).join("\n");
}

/** Rode UMA vez para instalar o gatilho diário. Idempotente. */
function instalarGatilhoLembrete() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "enviarLembretesDiarios") ScriptApp.deleteTrigger(t);
  });
  var hora = Number(PropertiesService.getScriptProperties().getProperty("LEMBRETE_HORA") || 20);
  ScriptApp.newTrigger("enviarLembretesDiarios").timeBased().everyDays(1).atHour(hora).create();
}

/** Envia um lembrete de teste agora (para conferir que chega). */
function testarLembreteAgora() {
  enviarLembretesDiarios();
}
