// nucleo.js — asserções do núcleo de dados, em JS puro (sem framework).
//
// O MESMO módulo roda em dois lugares:
//   - test.html (navegador): mostra os resultados na tela
//   - runner headless em Node (fake-indexeddb): durante o desenvolvimento
//
// `reportar(nome, ok, msg)` é injetado por quem chama. `seed` é o objeto do
// plano-seed.json (fetch no navegador, readFileSync no Node).

import * as repo from "../data/repository.js";
import * as seedMod from "../data/seed.js";
import { apagarDB, abrirDB, migrarPara1, DB_NOME, TODOS_STORES } from "../data/db.js";
import * as agenda from "../services/agenda.js";
import { METAS_PADRAO, obterMetas, salvarMetas } from "../services/metas.js";
import * as sync from "../services/sync.js";
import * as nutri from "../services/nutricao.js";
import {
  calcularPaceSegPorKm, formatarPace, parseDistanciaParaMetros,
  parseTempoParaSegundos, formatarDuracao, validarRegistro,
} from "../services/pace.js";
import {
  deISODate, paraISODate, somarDias, diffDias, diaDaSemana,
  inicioDaSemana, ehISODateValida,
} from "../services/dates.js";
import { aderencia, seriesSemanais, comparacaoSemelhante } from "../services/stats.js";
import { statusEfetivo, remarcarEmpurrando } from "../services/schedule.js";
import { recorrencia } from "../services/discomfort.js";
import { gerarICS } from "../services/ics.js";

export async function rodarTestes(seed, reportar) {
  let ok = 0, fail = 0;
  const test = async (nome, fn) => {
    try { await fn(); reportar(nome, true); ok++; }
    catch (e) { reportar(nome, false, e && e.message); fail++; }
  };
  const assert = (c, m) => { if (!c) throw new Error(m || "assert falhou"); };
  const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || ""} — esperado ${JSON.stringify(b)}, obtido ${JSON.stringify(a)}`); };
  const reset = () => apagarDB();

  const cfg3 = { dataInicio: "2026-08-03", diasTreino: [1, 3, 5], primeiroDiaSemana: 1 }; // seg/qua/sex

  // -------------------------------------------------------------------------
  // dates.js — bug UTC e virada de mês/ano (spec teste #12)
  // -------------------------------------------------------------------------
  await test("dates: new Date('YYYY-MM-DD') não volta um dia (bug UTC)", () => {
    const d = deISODate("2026-03-01");
    eq(d.getFullYear(), 2026, "ano"); eq(d.getMonth(), 2, "mês (0-index)"); eq(d.getDate(), 1, "dia");
    eq(paraISODate(d), "2026-03-01", "roundtrip");
  });
  await test("dates: virada de ano", () => {
    eq(somarDias("2026-12-31", 1), "2027-01-01");
    eq(somarDias("2027-01-01", -1), "2026-12-31");
  });
  await test("dates: virada de mês (fev não-bissexto 2026)", () => {
    eq(somarDias("2026-02-28", 1), "2026-03-01");
    eq(somarDias("2026-03-01", -1), "2026-02-28");
  });
  await test("dates: diffDias atravessando o ano", () => {
    eq(diffDias("2026-01-01", "2026-12-31"), 364);
    eq(diffDias("2026-12-31", "2027-01-01"), 1);
  });
  await test("dates: rejeita data inexistente e valida", () => {
    assert(!ehISODateValida("2026-02-30"), "30/fev deveria ser inválida");
    assert(ehISODateValida("2026-02-28"), "28/fev deveria ser válida");
  });
  await test("dates: inicioDaSemana (segunda como primeiro dia)", () => {
    const seg = inicioDaSemana("2026-08-05", 1); // 05/08/2026 é quarta
    eq(diaDaSemana(seg), 1, "deve cair numa segunda");
    assert(diffDias(seg, "2026-08-05") >= 0 && diffDias(seg, "2026-08-05") < 7, "dentro da mesma semana");
  });

  // -------------------------------------------------------------------------
  // pace.js (spec teste #2)
  // -------------------------------------------------------------------------
  await test("pace: distância zero e tempo zero -> null (sem divisão por zero)", () => {
    eq(calcularPaceSegPorKm(0, 300), null);
    eq(calcularPaceSegPorKm(5000, 0), null);
    eq(calcularPaceSegPorKm(null, null), null);
  });
  await test("pace: cálculo e formatação", () => {
    eq(calcularPaceSegPorKm(5000, 2040), 408, "5km em 34:00 = 408 s/km");
    eq(formatarPace(408), "6:48 /km");
    eq(formatarPace(null), "—");
  });
  await test("pace: aceita vírgula e ponto decimais", () => {
    eq(parseDistanciaParaMetros("6,84"), 6840);
    eq(parseDistanciaParaMetros("6.84"), 6840);
    eq(parseDistanciaParaMetros(""), null);
  });
  await test("pace: parse de tempo mm:ss e hh:mm:ss", () => {
    eq(parseTempoParaSegundos("5:00"), 300);
    eq(parseTempoParaSegundos("1:00:00"), 3600);
    eq(parseTempoParaSegundos("125"), 125);
    eq(formatarDuracao(3665), "1:01:05");
  });
  await test("pace: validação avisa fora de faixa sem lançar", () => {
    const avisos = validarRegistro({ distanciaMetros: 200000, duracaoSeg: 100, fcMedia: 300, paceSegPorKm: 30 });
    assert(avisos.length >= 1, "deveria haver avisos");
    eq(validarRegistro({ distanciaMetros: 5000, duracaoSeg: 1500, fcMedia: 150, paceSegPorKm: 300 }).length, 0, "dentro da faixa: sem avisos");
  });

  // -------------------------------------------------------------------------
  // repository CRUD em cada store (spec teste #1)
  // -------------------------------------------------------------------------
  await test("repo: CRUD nos seis stores", async () => {
    await reset();
    const plano = await repo.salvarPlano({ nome: "P", versao: 1, ativo: true }, { novo: true });
    assert(plano.id && plano.criadoEm && plano.atualizadoEm, "plano carimbado");
    eq((await repo.obterPlano(plano.id)).nome, "P");

    const fase = await repo.salvarFase({ planId: plano.id, numero: 1, nome: "F1" }, { novo: true });
    eq((await repo.listarFases(plano.id)).length, 1);

    const w = await repo.salvarPlanned({ planId: plano.id, phaseId: fase.id, semana: 1, sessao: "A", dataPlanejada: "2026-08-03", status: "futuro", titulo: "T" }, { novo: true });
    eq((await repo.obterPlanned(w.id)).titulo, "T");
    await repo.editarPlanned(w.id, { titulo: "T2" });
    eq((await repo.obterPlanned(w.id)).titulo, "T2");

    const c = await repo.registrarTreino({ plannedWorkoutId: null, data: "2026-08-03", duracaoSeg: 1800, distanciaMetros: 5000, rpe: 4 });
    assert(c.avulso === true, "sem planejado => avulso");
    eq((await repo.listarCompleted()).length, 1);
    await repo.atualizarTreino(c.id, { rpe: 5 });
    eq((await repo.obterCompleted(c.id)).rpe, 5);

    const d = await repo.salvarDesconforto({ completedWorkoutId: c.id, data: "2026-08-03", regiao: "fascia_plantar_calcanhar", intensidade: 3 });
    eq((await repo.listarDesconfortosPorTreino(c.id)).length, 1);
    assert(d.regiao === "fascia_plantar_calcanhar", "região específica preservada");

    await repo.definirConfig("temaEscuro", "auto");
    eq(await repo.obterConfig("temaEscuro"), "auto");
    eq(await repo.obterConfig("inexistente", "padrao"), "padrao");
  });

  // -------------------------------------------------------------------------
  // Regras de integridade
  // -------------------------------------------------------------------------
  await test("integridade: registrar treino altera SÓ o status do planejado (spec #3)", async () => {
    await reset();
    const p = await repo.salvarPlano({ nome: "P", versao: 1, ativo: true }, { novo: true });
    const w = await repo.salvarPlanned({ planId: p.id, semana: 1, sessao: "A", dataPlanejada: "2026-08-03", status: "futuro", titulo: "Rodagem", duracaoMin: 25, rpeMin: 3, rpeMax: 4, descricao: "25'" }, { novo: true });
    const antes = await repo.obterPlanned(w.id);
    await repo.registrarTreino({ plannedWorkoutId: w.id, data: "2026-08-03", duracaoSeg: 1500, rpe: 4 });
    const depois = await repo.obterPlanned(w.id);
    eq(depois.status, "concluido", "status deve virar concluido");
    for (const k of ["titulo", "duracaoMin", "rpeMin", "rpeMax", "descricao", "dataPlanejada", "semana", "sessao"]) {
      eq(depois[k], antes[k], `campo ${k} não pode mudar`);
    }
  });

  await test("integridade: alterar plano futuro não mexe no realizado (spec #4)", async () => {
    await reset();
    const p = await repo.salvarPlano({ nome: "P", versao: 1, ativo: true }, { novo: true });
    const w = await repo.salvarPlanned({ planId: p.id, semana: 1, sessao: "A", dataPlanejada: "2026-08-03", status: "futuro", titulo: "X" }, { novo: true });
    const c = await repo.registrarTreino({ plannedWorkoutId: w.id, data: "2026-08-03", duracaoSeg: 1500, rpe: 4 });
    const realizadoAntes = JSON.stringify(await repo.obterCompleted(c.id));
    await repo.editarPlanned(w.id, { titulo: "MUDOU", dataPlanejada: "2026-09-01", descricao: "outra coisa" });
    await repo.reagendarPlanned(w.id, "2026-09-10");
    eq(JSON.stringify(await repo.obterCompleted(c.id)), realizadoAntes, "realizado deve ficar idêntico");
  });

  await test("integridade: não registrar dois realizados para o mesmo planejado (spec #8)", async () => {
    await reset();
    const p = await repo.salvarPlano({ nome: "P", versao: 1, ativo: true }, { novo: true });
    const w = await repo.salvarPlanned({ planId: p.id, semana: 1, sessao: "A", dataPlanejada: "2026-08-03", status: "futuro", titulo: "X" }, { novo: true });
    await repo.registrarTreino({ plannedWorkoutId: w.id, data: "2026-08-03", duracaoSeg: 1500 });
    let lançou = false;
    try { await repo.registrarTreino({ plannedWorkoutId: w.id, data: "2026-08-04", duracaoSeg: 1600 }); }
    catch { lançou = true; }
    assert(lançou, "segunda criação deveria lançar erro");
    eq((await repo.listarCompleted()).length, 1, "só 1 realizado");
  });

  await test("integridade: reagendar preserva dataOriginal após 2 reagendamentos (spec #5)", async () => {
    await reset();
    const p = await repo.salvarPlano({ nome: "P", versao: 1, ativo: true }, { novo: true });
    const w = await repo.salvarPlanned({ planId: p.id, semana: 1, sessao: "A", dataPlanejada: "2026-08-03", status: "futuro", titulo: "X" }, { novo: true });
    await repo.reagendarPlanned(w.id, "2026-08-05");
    await repo.reagendarPlanned(w.id, "2026-08-07");
    const r = await repo.obterPlanned(w.id);
    eq(r.dataOriginal, "2026-08-03", "dataOriginal deve ser a primeira data");
    eq(r.dataPlanejada, "2026-08-07", "dataPlanejada é a última");
    eq(r.status, "reagendado");
  });

  // -------------------------------------------------------------------------
  // Backup / merge (spec #6 e #7)
  // -------------------------------------------------------------------------
  await test("backup: importar duas vezes não duplica (spec #6)", async () => {
    await reset();
    const p = await repo.salvarPlano({ nome: "P", versao: 1, ativo: true }, { novo: true });
    await repo.salvarPlanned({ planId: p.id, semana: 1, sessao: "A", dataPlanejada: "2026-08-03", status: "futuro", titulo: "X" }, { novo: true });
    const dump = await repo.exportarTudo();
    await reset();
    const r1 = await repo.importarBackup(dump);
    const r2 = await repo.importarBackup(dump);
    eq(r1.criados, 2, "1ª import cria plano+treino");
    eq(r2.criados, 0, "2ª import não cria nada");
    eq(r2.ignorados, 2, "2ª import ignora os 2 (mesmo timestamp)");
    const cont = await repo.contarTudo();
    eq(cont.plans + cont.plannedWorkouts, 2, "sem duplicação");
  });

  await test("backup: import mais antigo não sobrescreve mais novo (spec #7)", async () => {
    await reset();
    const p = await repo.salvarPlano({ id: "fixo", nome: "NOVO", versao: 2, ativo: true, atualizadoEm: "2026-08-10T00:00:00.000Z" }, { novo: true });
    const backupAntigo = { stores: { plans: [{ id: "fixo", nome: "ANTIGO", versao: 1, ativo: true, atualizadoEm: "2026-01-01T00:00:00.000Z" }] } };
    const rel = await repo.importarBackup(backupAntigo);
    eq((await repo.obterPlano("fixo")).nome, "NOVO", "não deve sobrescrever com versão antiga");
    eq(rel.ignorados, 1);
    const backupNovo = { stores: { plans: [{ id: "fixo", nome: "MAIS_NOVO", versao: 3, ativo: true, atualizadoEm: "2026-12-01T00:00:00.000Z" }] } };
    const rel2 = await repo.importarBackup(backupNovo);
    eq((await repo.obterPlano("fixo")).nome, "MAIS_NOVO", "deve sobrescrever com versão mais nova");
    eq(rel2.atualizados, 1);
  });

  await test("sync: escrita marca _pendingSync e marcarSincronizados limpa", async () => {
    await reset();
    await repo.salvarPlano({ nome: "P", versao: 1, ativo: true }, { novo: true });
    let pend = await repo.listarPendentesSync();
    eq(pend.plans.length, 1, "plano pendente após criar");
    await repo.marcarSincronizados({ plans: pend.plans });
    pend = await repo.listarPendentesSync();
    eq(pend.plans.length, 0, "nada pendente após marcar");
  });

  // -------------------------------------------------------------------------
  // seed.js — expansão do plano
  // -------------------------------------------------------------------------
  await test("seed: 3 dias/semana gera 66 treinos, 4 fases, 1 plano", async () => {
    await reset();
    const res = await seedMod.semearPlano(seed, cfg3);
    eq(res.treinos, 66, "22 semanas x 3");
    const cont = await repo.contarTudo();
    eq(cont.plans, 1); eq(cont.phases, 4); eq(cont.plannedWorkouts, 66);
    assert(await seedMod.jaSemeado(), "jaSemeado deve ser true");
  });

  await test("seed: idempotente (não semeia de novo)", async () => {
    // continua do teste anterior (não reseta): já há plano ativo
    const res = await seedMod.semearPlano(seed, cfg3);
    assert(res.jaExistia === true, "deveria detectar que já existe");
    eq((await repo.contarTudo()).plannedWorkouts, 66, "continua 66");
  });

  await test("seed: rodagem longa (C) cai no dia mais tarde da semana", async () => {
    const itens = seedMod.calcularDatasSessoes(seed, cfg3);
    const semana1 = itens.filter((i) => i.semana === 1);
    const c = semana1.find((i) => i.sessao === "C");
    const outros = semana1.filter((i) => i.sessao !== "C");
    for (const o of outros) assert(diffDias(o.dataPlanejada, c.dataPlanejada) > 0, "C deve ser depois das outras");
  });

  await test("seed: 2 dias/semana aplica regra de corte (44 treinos; fase 1 A+C, fase 3 B+C)", async () => {
    await reset();
    const cfg2 = { dataInicio: "2026-08-03", diasTreino: [2, 5], primeiroDiaSemana: 1 };
    const itens = seedMod.calcularDatasSessoes(seed, cfg2);
    eq(itens.length, 44, "22 x 2");
    const s1 = itens.filter((i) => i.semana === 1).map((i) => i.sessao).sort();
    eq(JSON.stringify(s1), JSON.stringify(["A", "C"]), "fase 1: A e C");
    const s10 = itens.filter((i) => i.semana === 10).map((i) => i.sessao).sort();
    eq(JSON.stringify(s10), JSON.stringify(["B", "C"]), "fase 3: B e C (mantém qualidade+longa)");
  });

  await test("seed: volume da semana 1 soma 72 min e datas ISO válidas", async () => {
    const itens = seedMod.calcularDatasSessoes(seed, cfg3).filter((i) => i.semana === 1);
    const soma = itens.reduce((a, i) => a + i.template.duracaoMin, 0);
    eq(soma, 72, "3x24");
    for (const i of itens) assert(ehISODateValida(i.dataPlanejada), `data inválida: ${i.dataPlanejada}`);
  });

  // -------------------------------------------------------------------------
  // Aderência semanal (spec #9): semana parcial e semana vazia
  // -------------------------------------------------------------------------
  await test("stats: aderência com semana parcial e semana vazia (spec #9)", async () => {
    await reset();
    await seedMod.semearPlano(seed, cfg3);
    const plan = await repo.planoAtivo();
    const s1 = await repo.listarPlanned({ planId: plan.id, semana: 1 });
    await repo.registrarTreino({ plannedWorkoutId: s1[0].id, data: s1[0].dataPlanejada, duracaoSeg: 1440 });
    await repo.registrarTreino({ plannedWorkoutId: s1[1].id, data: s1[1].dataPlanejada, duracaoSeg: 1440 });
    const a1 = await aderencia(plan, 1);
    eq(a1.semanaPct, 67, "2 de 3 = 67%");
    const a2 = await aderencia(plan, 2); // semana 2 vazia; acumulado inclui sem 1 e 2
    eq(a2.semanaPct, 0, "semana vazia = 0%");
    assert(a2.acumuladaPct > 0 && a2.acumuladaPct < 100, "acumulado entre 0 e 100");
  });

  await test("stats: séries semanais têm 22 entradas e volume real bate", async () => {
    // continua do teste anterior (2 treinos de 24 min na semana 1)
    const plan = await repo.planoAtivo();
    const serie = await seriesSemanais(plan);
    eq(serie.length, 22);
    eq(serie[0].minutos, 48, "2 x 24 min = 48");
    eq(serie[0].concluidos, 2);
  });

  // -------------------------------------------------------------------------
  // Recorrência de desconforto com < 4 treinos (spec #10)
  // -------------------------------------------------------------------------
  await test("recomeçar: arquiva o plano sem apagar e esconde realizados antigos", async () => {
    await reset();
    const pausa = () => new Promise((r) => setTimeout(r, 5)); // criadoEm distintos
    const velho = await repo.salvarPlano({ nome: "P", versao: 1, ativo: true }, { novo: true });
    const w = await repo.salvarPlanned({ planId: velho.id, semana: 1, sessao: "A", dataPlanejada: "2026-08-03", status: "futuro", titulo: "X" }, { novo: true });
    await repo.registrarTreino({ plannedWorkoutId: w.id, data: "2026-08-03", duracaoSeg: 1500 });
    await pausa();
    await repo.registrarTreino({ plannedWorkoutId: null, data: "2026-08-04", duracaoSeg: 900 });
    await pausa();

    await repo.arquivarPlanoAtivo();
    eq(await repo.planoAtivo(), null, "sem plano ativo => onboarding");
    eq((await repo.obterPlano(velho.id)).ativo, false);
    await pausa();
    const novo = await repo.salvarPlano({ nome: "P", versao: 1, ativo: true }, { novo: true });
    await pausa();
    await repo.registrarTreino({ plannedWorkoutId: null, data: "2026-11-02", duracaoSeg: 600 });

    eq((await repo.listarCompleted()).length, 3, "nada foi apagado");
    eq((await repo.listarCompleted({ planId: velho.id })).length, 2, "vinculado + avulso antigos");
    const doNovo = await repo.listarCompleted({ planId: novo.id });
    eq(doNovo.length, 1, "só o avulso feito depois do recomeço");
    eq(doNovo[0].data, "2026-11-02");
  });

  await test("desconforto: recorrência com menos de 4 treinos (spec #10)", async () => {
    await reset();
    const p = await repo.salvarPlano({ nome: "P", versao: 1, ativo: true }, { novo: true });
    for (let i = 0; i < 2; i++) {
      const w = await repo.salvarPlanned({ planId: p.id, semana: 1, sessao: "A", dataPlanejada: `2026-08-0${3 + i}`, status: "futuro", titulo: "X" }, { novo: true });
      const c = await repo.registrarTreino({ plannedWorkoutId: w.id, data: `2026-08-0${3 + i}`, duracaoSeg: 1500 });
      await repo.salvarDesconforto({ completedWorkoutId: c.id, data: c.data, regiao: "fascia_plantar_calcanhar", intensidade: 3 });
    }
    const r = await recorrencia("fascia_plantar_calcanhar", 4);
    eq(r.comDesconforto, 2, "2 treinos com desconforto");
    eq(r.total, 2, "só 2 treinos existem (não força 4)");
    const rOutra = await recorrencia("joelho", 4);
    eq(rOutra.comDesconforto, 0);
  });

  // -------------------------------------------------------------------------
  // .ics: SEQUENCE incrementado, mesmo UID após reagendar (spec #11)
  // -------------------------------------------------------------------------
  await test("ics: reagendar incrementa SEQUENCE e mantém UID (spec #11)", async () => {
    await reset();
    const p = await repo.salvarPlano({ nome: "P", versao: 1, ativo: true }, { novo: true });
    const w0 = await repo.salvarPlanned({
      planId: p.id, semana: 1, sessao: "A", dataPlanejada: "2026-08-03", status: "futuro",
      titulo: "Rodagem", descricao: "25'", duracaoMin: 25, rpeMin: 3, rpeMax: 4, zonaFC: "65–75%",
      objetivoFisiologico: "Base", aquecimento: "aq", partePrincipal: "pp", desaquecimento: "des", sequence: 0,
    }, { novo: true });
    await repo.reagendarPlanned(w0.id, "2026-08-05");
    await repo.reagendarPlanned(w0.id, "2026-08-07");
    const w = await repo.obterPlanned(w0.id);
    eq(w.sequence, 2, "duas reprogramações => SEQUENCE 2");
    const ics = gerarICS([w]);
    assert(ics.includes(`UID:treino-${w.id}@corrida.local`), "UID estável presente");
    assert(ics.includes("SEQUENCE:2"), "SEQUENCE:2 presente");
    assert(ics.includes("BEGIN:VALARM") && ics.includes("TRIGGER"), "VALARM presente");
    assert(ics.includes("BEGIN:VCALENDAR") && ics.includes("END:VCALENDAR"), "envelope VCALENDAR");
  });

  await test("stats: comparação com treino semelhante anterior", async () => {
    await reset();
    const p = await repo.salvarPlano({ nome: "P", versao: 1, ativo: true, dataInicio: "2026-08-03", totalSemanas: 22 }, { novo: true });
    const mk = async (data, semana, paceSeg) => {
      const w = await repo.salvarPlanned({ planId: p.id, semana, sessao: "A", dataPlanejada: data, status: "futuro", titulo: "Fácil", tipo: "continua" }, { novo: true });
      return repo.registrarTreino({ plannedWorkoutId: w.id, data, duracaoSeg: 1800, distanciaMetros: 5000, paceSegPorKm: paceSeg });
    };
    await mk("2026-08-03", 1, 434); // 7:14
    const atual = await mk("2026-08-31", 5, 412); // 6:52
    const comp = await comparacaoSemelhante(atual);
    assert(comp && comp.texto.includes("6:52"), "cita o pace de hoje");
    assert(comp.texto.includes("7:14"), "cita o pace anterior");
  });

  // -------------------------------------------------------------------------
  // Status 'perdido' derivado e remarcação empurrando o plano
  // -------------------------------------------------------------------------
  await test("schedule: status 'perdido' para pendente no passado", () => {
    const H = "2026-08-10";
    eq(statusEfetivo({ status: "futuro", dataPlanejada: "2026-08-05" }, H), "perdido");
    eq(statusEfetivo({ status: "futuro", dataPlanejada: "2026-08-10" }, H), "hoje");
    eq(statusEfetivo({ status: "futuro", dataPlanejada: "2026-08-15" }, H), "futuro");
    eq(statusEfetivo({ status: "concluido", dataPlanejada: "2026-08-01" }, H), "concluido");
  });

  await test("schedule: remarcar empurra pendentes e estende o fim; não move concluídos", async () => {
    await reset();
    const plan = await repo.salvarPlano({ nome: "P", versao: 1, ativo: true, dataInicio: "2026-08-03", totalSemanas: 22 }, { novo: true });
    const mk = (data, semana) => repo.salvarPlanned({ planId: plan.id, semana, sessao: "A", dataPlanejada: data, status: "futuro", titulo: "T", duracaoMin: 20 }, { novo: true });
    const w1 = await mk("2026-08-03", 1);
    const w2 = await mk("2026-08-05", 1);
    const w3 = await mk("2026-08-07", 2);
    const w4 = await mk("2026-08-10", 2);
    await repo.registrarTreino({ plannedWorkoutId: w2.id, data: "2026-08-05", duracaoSeg: 1200 }); // w2 concluído

    const r = await remarcarEmpurrando(plan, w1, "2026-08-04"); // delta +1
    eq((await repo.obterPlanned(w1.id)).dataPlanejada, "2026-08-04");
    eq((await repo.obterPlanned(w2.id)).dataPlanejada, "2026-08-05", "concluído não se move");
    eq((await repo.obterPlanned(w3.id)).dataPlanejada, "2026-08-08", "pendente posterior +1");
    eq((await repo.obterPlanned(w4.id)).dataPlanejada, "2026-08-11", "pendente posterior +1");
    eq(r.novoFim, "2026-08-11", "fim do plano estendido");
  });

  // =========================================================================
  // Hub (v2)
  // =========================================================================

  // -------------------------------------------------------------------------
  // Migração v1 -> v2 a partir de um banco v1 de verdade, com dados
  // -------------------------------------------------------------------------
  await test("migração v1→v2: dados da corrida intactos e stores do hub criados", async () => {
    await reset();
    const dadosV1 = {
      plans: [{ id: "p1", nome: "Plano", ativo: true, dataInicio: "2026-08-03", criadoEm: "2026-08-01T10:00:00.000Z", atualizadoEm: "2026-08-01T10:00:00.000Z", _pendingSync: false }],
      phases: [{ id: "f1", planId: "p1", numero: 1, nome: "F1", atualizadoEm: "2026-08-01T10:00:00.000Z" }],
      plannedWorkouts: [{ id: "w1", planId: "p1", phaseId: "f1", semana: 1, sessao: "A", dataPlanejada: "2026-08-03", status: "concluido", titulo: "T", atualizadoEm: "2026-08-03T10:00:00.000Z" }],
      completedWorkouts: [{ id: "c1", plannedWorkoutId: "w1", avulso: false, data: "2026-08-03", duracaoSeg: 1500, distanciaMetros: 3500, atualizadoEm: "2026-08-03T10:00:00.000Z" }],
      discomforts: [{ id: "d1", completedWorkoutId: "c1", data: "2026-08-03", regiao: "fascia_plantar_calcanhar", intensidade: 2, atualizadoEm: "2026-08-03T10:00:00.000Z" }],
      settings: [{ chave: "temaEscuro", valor: "auto", atualizadoEm: "2026-08-01T10:00:00.000Z" }],
    };
    // 1) banco v1 com o schema exato da v1
    const v1 = await new Promise((resolve, reject) => {
      const r = globalThis.indexedDB.open(DB_NOME, 1);
      r.onupgradeneeded = () => migrarPara1(r.result);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    eq(v1.objectStoreNames.length, 6, "v1 tem 6 stores");
    await new Promise((resolve, reject) => {
      const tx = v1.transaction(Object.keys(dadosV1), "readwrite");
      for (const [s, recs] of Object.entries(dadosV1)) for (const r of recs) tx.objectStore(s).put(r);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    v1.close();

    // 2) o app abre (v2) e migra
    const db = await abrirDB();
    eq(db.version, 2, "versão 2");
    for (const s of TODOS_STORES) assert(db.objectStoreNames.contains(s), `store ${s} existe`);

    const cont = await repo.contarTudo();
    for (const s of Object.keys(dadosV1)) eq(cont[s], 1, `${s} preservado`);
    for (const s of ["weeklySchedule", "sessionLogs", "foodLogs", "bodyMeasurements", "gravlWorkouts"]) eq(cont[s], 0, `${s} vazio`);

    // registros byte a byte iguais
    eq(JSON.stringify(await repo.obterPlano("p1")), JSON.stringify(dadosV1.plans[0]), "plano idêntico");
    eq(JSON.stringify(await repo.obterPlanned("w1")), JSON.stringify(dadosV1.plannedWorkouts[0]), "planejado idêntico");
    eq(JSON.stringify(await repo.obterCompleted("c1")), JSON.stringify(dadosV1.completedWorkouts[0]), "realizado idêntico");
    eq(JSON.stringify((await repo.listarDesconfortosPorTreino("c1"))[0]), JSON.stringify(dadosV1.discomforts[0]), "desconforto idêntico");
    eq(await repo.obterConfig("temaEscuro"), "auto", "settings preservado");

    // índices da v1 continuam funcionando
    eq((await repo.plannedNaData("2026-08-03")).length, 1, "índice dataPlanejada");
    eq((await repo.completedPorPlanned("w1")).id, "c1", "índice plannedWorkoutId");

    // 3) depois de migrar, o seed do hub entra sem tocar no resto
    await seedMod.semearHub();
    eq((await repo.contarTudo()).plannedWorkouts, 1, "seed não mexe na corrida");
  });

  // -------------------------------------------------------------------------
  // Seed do hub e metas
  // -------------------------------------------------------------------------
  await test("seed do hub: agenda-padrão idempotente e respeita remoção", async () => {
    await reset();
    eq((await seedMod.semearHub()).agenda, 10, "10 itens na 1ª vez");
    eq((await seedMod.semearHub()).agenda, 0, "2ª vez não insere nada");
    const ag = await repo.listarAgenda();
    eq(ag.length, 10);
    eq(ag.filter((i) => i.tipo === "musculacao" && agenda.ehLower(i.rotulo)).length, 2, "dois treinos de perna");
    eq(ag.filter((i) => i.tipo === "corrida").map((i) => i.diaSemana).sort().join(","), "4,6", "corrida qui e sáb");
    await repo.removerItemAgenda(ag[0].id);
    await seedMod.semearHub();
    eq((await repo.listarAgenda()).length, 9, "item removido não volta pelo seed");
  });

  await test("metas: padrão, mescla parcial e validação", async () => {
    await reset();
    const m = await obterMetas();
    eq(m.proteinaMinG, 150); eq(m.proteinaMaxG, 170); eq(m.pesoAlvoKg, 78); eq(m.seriesPerna.panturrilha, 6);
    await salvarMetas({ ...m, proteinaMinG: 160, seriesPerna: { quadriceps: 12 } });
    const m2 = await obterMetas();
    eq(m2.proteinaMinG, 160); eq(m2.seriesPerna.quadriceps, 12); eq(m2.seriesPerna.posteriorGluteo, 8, "mantém as demais");
    let lancou = false;
    try { await salvarMetas({ ...m2, proteinaMaxG: 100 }); } catch { lancou = true; }
    assert(lancou, "máximo < mínimo deve ser recusado");
  });

  // -------------------------------------------------------------------------
  // Agenda e sessões
  // -------------------------------------------------------------------------
  await test("agenda: 1 registro por (data, item); novo toque edita; tocar de novo desmarca", async () => {
    await reset();
    const item = await repo.salvarItemAgenda({ diaSemana: 4, periodo: "noite", tipo: "musculacao", rotulo: "Lower A" });
    const d = "2026-11-05"; // quinta
    const a = await agenda.marcarSessao(item, d, "feito");
    const b = await agenda.marcarSessao(item, d, "pulado", { duracaoMin: 40 });
    eq(a.id, b.id, "mesmo registro");
    eq(b.status, "pulado"); eq(b.duracaoMin, 40);
    eq((await repo.listarSessoes()).length, 1, "sem duplicar");

    await agenda.alternarSessao(item, d, "pulado", b); // mesmo status => desmarca
    eq((await repo.listarSessoes()).length, 0, "desmarcado some da lista");
    const c = await agenda.alternarSessao(item, d, "feito", null);
    eq(c.id, a.id, "reativa o mesmo registro (tombstone), não cria outro");
    eq((await repo.contarTudo()).sessionLogs, 1, "um único registro no banco");

    await repo.salvarItemAgenda({ ...item, rotulo: "Upper A" });
    eq((await repo.listarSessoes())[0].rotulo, "Lower A", "editar a agenda não reescreve o histórico");

    const outroDia = await agenda.marcarSessao(item, "2026-11-12", "feito");
    assert(outroDia.id !== a.id, "outra data => outro registro");
  });

  await test("agenda: aderência ignora opcionais; Lower conta mesmo fora do dia", () => {
    const ag = [
      { id: "u", diaSemana: 1, periodo: "manha", tipo: "musculacao", rotulo: "Upper A" },
      { id: "k", diaSemana: 5, periodo: "noite", tipo: "karate", rotulo: "Leve", opcional: true },
      { id: "l", diaSemana: 4, periodo: "noite", tipo: "musculacao", rotulo: "Lower A" },
      { id: "r", diaSemana: 4, periodo: "manha", tipo: "corrida", rotulo: "Corrida curta" },
    ];
    const ses = [
      { id: "1", data: "2026-11-02", scheduleItemId: "u", tipo: "musculacao", rotulo: "Upper A", status: "feito" },
      { id: "2", data: "2026-11-06", scheduleItemId: "k", tipo: "karate", rotulo: "Leve", status: "feito", opcional: true },
      { id: "3", data: "2026-11-05", scheduleItemId: "l", tipo: "musculacao", rotulo: "Lower A", status: "pulado" },
      { id: "4", data: "2026-11-07", scheduleItemId: null, tipo: "musculacao", rotulo: "Lower A", periodo: "manha", status: "feito" },
    ];
    const corridas = [{ id: "w", dataPlanejada: "2026-11-05", status: "concluido", titulo: "Corrida" }];
    const r = agenda.resumirSemana({ agenda: ag, sessoes: ses, corridas, inicio: "2026-11-02", metas: METAS_PADRAO });
    eq(r.previstos, 3, "Upper + Lower + corrida; opcional fora");
    eq(r.feitos, 2, "Upper + corrida");
    eq(r.pulados, 1);
    eq(r.extras, 2, "karatê opcional + Lower fora da agenda");
    eq(r.lower, 1, "Lower feito no sábado conta");
    eq(r.metaLower, 2);
    const qui = r.dias.find((d) => d.data === "2026-11-05");
    eq(qui.entradas.map((e) => e.tipo).join(","), "corrida,sessao", "manhã (corrida) antes da noite (Lower)");
    const sab = r.dias.find((d) => d.data === "2026-11-07");
    eq(sab.entradas[0].tipo, "avulsa", "sessão fora da agenda aparece no dia");
  });

  // -------------------------------------------------------------------------
  // Sync e backup com os stores novos
  // -------------------------------------------------------------------------
  await test("sync: backend antigo (6 stores) não marca os stores do hub como sincronizados", async () => {
    await reset();
    await repo.salvarPlano({ nome: "P", versao: 1, ativo: true }, { novo: true });
    await repo.salvarItemAgenda({ diaSemana: 1, periodo: "manha", tipo: "musculacao", rotulo: "Upper A" });
    await repo.definirConfig("syncUrl", "https://exemplo.invalid/exec");
    const antigos = ["plans", "phases", "plannedWorkouts", "completedWorkouts", "discomforts", "settings"];
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ ok: true, serverTime: "2026-11-01T00:00:00.000Z", records: Object.fromEntries(antigos.map((s) => [s, []])) }),
    });
    try {
      const r = await sync.sincronizar();
      eq(r.naoAceitos, 1, "só o item da agenda fica de fora");
      const pend = await repo.listarPendentesSync();
      eq(pend.plans.length, 0, "plano sincronizado");
      eq(pend.weeklySchedule.length, 1, "item da agenda continua pendente");
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  });

  await test("backup: v1 (6 stores) importa no v2; dump v2 traz os stores do hub", async () => {
    await reset();
    const dumpV1 = {
      schemaVersion: 1,
      stores: {
        plans: [{ id: "p", nome: "P", ativo: true, atualizadoEm: "2026-08-01T00:00:00.000Z" }],
        settings: [{ chave: "x", valor: 1, atualizadoEm: "2026-08-01T00:00:00.000Z" }],
      },
    };
    eq((await repo.importarBackup(dumpV1)).criados, 2);
    await repo.salvarItemAgenda({ diaSemana: 0, periodo: "manha", tipo: "musculacao", rotulo: "Lower B" });
    const dump = await repo.exportarTudo();
    eq(dump.schemaVersion, 2);
    eq(dump.stores.weeklySchedule.length, 1, "agenda no backup");
    await reset();
    await repo.importarBackup(dump);
    const r2 = await repo.importarBackup(dump);
    eq(r2.criados, 0, "2ª importação não cria nada");
    eq((await repo.contarTudo()).weeklySchedule, 1, "sem duplicar");
  });

  // -------------------------------------------------------------------------
  // Nutrição
  // -------------------------------------------------------------------------
  await test("plano alimentar: quantidades literais preservadas (amostras do PDF)", () => {
    const P = nutri.PLANO;
    eq(P.versao, "08/07/2026");
    eq(P.refeicoes.map((r) => r.id).join(","), "cafe,almoco,lanche,jantar");
    const op = (refId, vi, grupo, alimento) =>
      nutri.obterRefeicao(refId).variantes[vi].blocos.find((b) => b.grupo === grupo).opcoes.find((o) => o.alimento === alimento);
    eq(op("cafe", 0, "GRUPO DOS PÃES", "Pão de forma").quantidade, "2 fatias");
    eq(op("cafe", 0, "GRUPO DAS CARNES ou LEITES E DERIVADOS", "Queijo branco").quantidade, "2 fatias grossas (50g)");
    eq(op("cafe", 0, "SUPLEMENTO", "Whey Protein").quantidade, "30g");
    eq(op("almoco", 0, "GRUPO DE ARROZ", "Arroz Integral").quantidade, "110g");
    eq(op("almoco", 0, "GRUPO DAS LEGUMINOSAS", "Feijão").quantidade, "120g");
    eq(nutri.obterRefeicao("lanche").variantes.length, 2, "lanche com 2 alternativas");
    eq(nutri.obterRefeicao("jantar").variantes.map((v) => v.nome).join("|"), "Prato|Sanduíche");
    eq(P.substituicoes["GRUPO DOS PÃES – 1 porção"][0].medida, "1und");
  });

  await test("nutrição: proteína do dia = refeições × porção + extras; removido não soma", async () => {
    await reset();
    const d = "2026-11-03";
    await nutri.registrarRefeicao({ data: d, refeicaoId: "cafe", varianteIndex: 0 });              // 43
    await nutri.registrarRefeicao({ data: d, refeicaoId: "almoco", varianteIndex: 0, fracao: 0.5 }); // 24
    await nutri.registrarProteinaExtra({ data: d, proteinaG: 25, descricao: "shake" });            // 25
    let dia = await nutri.carregarDia(d);
    eq(dia.totais.proteina, 92, "43 + 48×0,5 + 25");
    eq(dia.totais.proteinaExtra, 25);

    // registrar o almoço de novo EDITA (não duplica)
    await nutri.registrarRefeicao({ data: d, refeicaoId: "almoco", varianteIndex: 0, fracao: 1 });
    dia = await nutri.carregarDia(d);
    eq(dia.registros.filter((r) => r.refeicaoId === "almoco").length, 1, "uma só refeição de almoço");
    eq(dia.totais.proteina, 116, "43 + 48 + 25");

    // desfazer = tombstone; some da soma
    await nutri.desfazerRegistro(dia.extras[0]);
    eq((await nutri.carregarDia(d)).totais.proteina, 91, "sem o extra");
    eq((await repo.contarTudo()).foodLogs, 3, "o extra continua no banco (removido)");

    // snapshot: a variante do jantar guarda as macros daquele momento
    const j = await nutri.registrarRefeicao({ data: d, refeicaoId: "jantar", varianteIndex: 1 });
    eq(j.macros.prot, 37); eq(j.varianteNome, "Sanduíche");
    eq(await nutri.ultimaVariante("jantar"), 1, "padrão do 1 toque = última variante usada");
  });

  await test("nutrição: semana de proteína — média só dos dias com registro", () => {
    const metas = { ...METAS_PADRAO };
    const R = (data, prot) => ({ tipo: "extra", data, proteinaG: prot });
    const registros = [R("2026-11-02", 160), R("2026-11-03", 120), R("2026-11-05", 155), R("2026-11-05", 10)];
    const s = nutri.resumirSemanaProteina({ registros, inicio: "2026-11-02", metas, hoje: "2026-11-06" });
    eq(s.diasComRegistro, 3);
    eq(s.diasMeta, 2, "160 e 165 batem; 120 não");
    eq(s.media, 148, "(160+120+165)/3");
    eq(s.diasSemRegistro, 2, "quarta e sexta (sábado e domingo são futuros)");
    eq(s.dias.filter((d) => d.futuro).length, 2);
  });

  await test("nutrição: busca de substituição sem acento e montar prato com pendências", () => {
    const achados = nutri.procurarSubstituicoes("pao");
    assert(achados.some((a) => a.grupo.startsWith("GRUPO DOS PÃES")), "acha o grupo dos pães sem acento");
    eq(nutri.procurarSubstituicoes("xyzinexistente").length, 0);
    eq(JSON.stringify(nutri.partesDoGrupo("GRUPO DOS PÃES – 1 porção")), JSON.stringify({ titulo: "GRUPO DOS PÃES", nota: "1 porção" }));

    const cafe = nutri.obterRefeicao("cafe").variantes[0].blocos;
    const escolhas = { [cafe[0].grupo]: cafe[0].opcoes[0] };
    const r = nutri.resumoDoPrato("cafe", 0, escolhas);
    eq(r.itens.length, 1);
    eq(r.total, cafe.length);
    eq(r.pendentes.join("|"), "GRUPO DAS CARNES ou LEITES E DERIVADOS|SUPLEMENTO", "opcionais (café, açúcar) não pendem");
    eq(nutri.refeicaoDoHorario(9), "cafe"); eq(nutri.refeicaoDoHorario(14), "almoco");
    eq(nutri.refeicaoDoHorario(18), "lanche"); eq(nutri.refeicaoDoHorario(21), "jantar");
  });

  await reset();
  return { ok, fail, total: ok + fail };
}
