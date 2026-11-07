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
import { apagarDB, abrirDB, migrarPara1, migrarPara2, migrarPara3, migrarPara4, DB_NOME, TODOS_STORES } from "../data/db.js";
import * as agenda from "../services/agenda.js";
import { METAS_PADRAO, obterMetas, salvarMetas } from "../services/metas.js";
import * as nutri from "../services/nutricao.js";
import * as merge from "../services/merge.js";
import {
  calcularPaceSegPorKm, formatarPace, parseDistanciaParaMetros,
  parseTempoParaSegundos, mascararTempo, tempoDoCampo, formatarDuracao, formatarTempoTotal, validarRegistro,
} from "../services/pace.js";
import {
  deISODate, paraISODate, somarDias, diffDias, diaDaSemana,
  inicioDaSemana, ehISODateValida, hoje as hojeDeHoje,
} from "../services/dates.js";
import { aderencia, seriesSemanais, comparacaoSemelhante, janelaDeSemanas } from "../services/stats.js";
import { statusEfetivo, remarcarEmpurrando, progressoSemana } from "../services/schedule.js";
import * as semanaSrv from "../services/semana.js";
import { recorrencia } from "../services/discomfort.js";
import { gerarICS } from "../services/ics.js";
import { textoZonaFC } from "../services/dominio.js";

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
  await test("pace: campo Tempo põe os dois-pontos ao digitar", () => {
    eq(mascararTempo("27"), "27");
    eq(mascararTempo("273"), "2:73", "ainda digitando");
    eq(mascararTempo("2730"), "27:30");
    eq(mascararTempo("12730"), "1:27:30");
    eq(mascararTempo("27:30"), "27:30", "valor já formatado fica igual");
    eq(mascararTempo("1:00:00"), "1:00:00");
    eq(mascararTempo("27.30"), "27:30", "outra pontuação do teclado");
    eq(mascararTempo(""), "");
    eq(tempoDoCampo("27"), "27:00", "1 ou 2 números são minutos");
    eq(tempoDoCampo("5"), "5:00");
    eq(tempoDoCampo("2730"), "27:30");
    eq(tempoDoCampo(""), "");
    eq(parseTempoParaSegundos(tempoDoCampo("2730")), 1650);
    eq(parseTempoParaSegundos(tempoDoCampo("27")), 1620);
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
    const planejados = await repo.listarPlanned({ planId: plan.id });
    const daSemana1 = planejados.filter((w) => w.semana === 1).reduce((a, w) => a + w.duracaoMin, 0);
    assert(daSemana1 > 0, "a semana 1 tem minutos planejados");
    eq(serie[0].minutosPlanejados, daSemana1, "minutos planejados somam as sessões da semana");
  });

  await test("stats: gráficos mostram sempre as semanas do período", () => {
    const iguais = (a, de, ate) => { eq(a.de, de); eq(a.ate, ate); };
    iguais(janelaDeSemanas(2, 8, 22), 1, 8);
    iguais(janelaDeSemanas(2, 4, 22), 1, 4);
    iguais(janelaDeSemanas(12, 8, 22), 5, 12);
    iguais(janelaDeSemanas(22, 12, 22), 11, 22);
    iguais(janelaDeSemanas(5, 0, 22), 1, 22);
    iguais(janelaDeSemanas(2, 12, 8), 1, 8);
  });

  await test("pace: tempo total em horas e minutos", () => {
    eq(formatarTempoTotal(367), "6h07m");
    eq(formatarTempoTotal(69), "1h09m");
    eq(formatarTempoTotal(60), "1h00m");
    eq(formatarTempoTotal(45), "45 min");
    eq(formatarTempoTotal(0), "0 min");
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
    assert(ics.includes("Zona FC Z2"), "zona no corpo do evento");
  });

  await test("zonas: faixa do plano vira zona com bpm da FC máxima", async () => {
    eq(textoZonaFC("65–75%", 190), "Z2 · 124–143 bpm", "fácil");
    eq(textoZonaFC("76–83%", 190), "Z3 · 144–158 bpm", "moderado");
    eq(textoZonaFC("84–90%", 190), "Z4 · 160–171 bpm", "limiar");
    eq(textoZonaFC("65–75%", null), "Z2 · 124–143 bpm", "sem FC máxima usa 190");
    eq(textoZonaFC("65–75%", 200), "Z2 · 130–150 bpm", "respeita a FC máxima dos Ajustes");
    eq(textoZonaFC("70–80%", 190), "70–80%", "faixa fora do plano fica como está");
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

    // 2) o app abre (v5) e migra
    const db = await abrirDB();
    eq(db.version, 5, "versão 5");
    for (const s of TODOS_STORES) assert(db.objectStoreNames.contains(s), `store ${s} existe`);

    const cont = await repo.contarTudo();
    for (const s of Object.keys(dadosV1)) eq(cont[s], 1, `${s} preservado`);
    for (const s of ["weeklySchedule", "sessionLogs", "foodLogs", "scheduleMoves", "sessionMerges", "dailyCheckins", "weekExceptions", "weekHistory"]) eq(cont[s], 0, `${s} vazio`);

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
    eq(m.proteinaMinG, 150); eq(m.proteinaMaxG, 170); eq(m.lowerPorSemana, 2);
    await salvarMetas({ proteinaMinG: 160 });
    const m2 = await obterMetas();
    eq(m2.proteinaMinG, 160); eq(m2.proteinaMaxG, 170, "mantém as demais");
    eq(JSON.stringify(Object.keys(await obterMetas()).sort()), JSON.stringify(["lowerPorSemana", "proteinaMaxG", "proteinaMinG"]));
    await repo.definirConfig("metas", { proteinaMinG: 155, pesoAlvoKg: 78, seriesPerna: {} });
    eq((await obterMetas()).pesoAlvoKg, undefined, "campos de versões antigas são descartados");
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
    const b = await agenda.marcarSessao(item, d, "nao_feito", { duracaoMin: 40 });
    eq(a.id, b.id, "mesmo registro");
    eq(b.status, "nao_feito"); eq(b.duracaoMin, 40);
    eq((await repo.listarSessoes()).length, 1, "sem duplicar");

    await agenda.alternarSessao(item, d, "nao_feito", b); // mesmo status => desmarca
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
      { id: "3", data: "2026-11-05", scheduleItemId: "l", tipo: "musculacao", rotulo: "Lower A", status: "nao_feito" },
      { id: "4", data: "2026-11-07", scheduleItemId: null, tipo: "musculacao", rotulo: "Lower A", periodo: "manha", status: "feito" },
    ];
    const corridas = [{ id: "w", dataPlanejada: "2026-11-05", status: "concluido", titulo: "Corrida" }];
    const r = agenda.resumirSemana({ agenda: ag, sessoes: ses, corridas, inicio: "2026-11-02", metas: METAS_PADRAO });
    eq(r.previstos, 3, "Upper + Lower + corrida; opcional fora");
    eq(r.feitos, 2, "Upper + corrida");
    eq(r.naoFeitos, 1);
    eq(r.extras, 2, "karatê opcional + Lower fora da agenda");
    eq(r.lower, 1, "Lower feito no sábado conta");
    eq(r.metaLower, 2);
    const qui = r.dias.find((d) => d.data === "2026-11-05");
    eq(qui.entradas.map((e) => e.tipo).join(","), "corrida,sessao", "manhã (corrida) antes da noite (Lower)");
    const sab = r.dias.find((d) => d.data === "2026-11-07");
    eq(sab.entradas[0].tipo, "avulsa", "sessão fora da agenda aparece no dia");
  });

  // -------------------------------------------------------------------------
  // Backup com os stores novos
  // -------------------------------------------------------------------------
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
    eq(dump.schemaVersion, 5);
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
    const d = "2026-10-27";
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

  await test("agenda: treino fora da agenda com o mesmo rótulo é remanejado para o item da semana", async () => {
    await reset();
    await seedMod.semearHub();
    const log = await agenda.registrarSessaoAvulsa({ data: "2026-11-07", tipo: "musculacao", rotulo: "Lower B", periodo: "manha" });
    const lowerB = (await repo.listarAgenda()).find((i) => i.rotulo === "Lower B");
    eq(log.scheduleItemId, lowerB.id, "ligado ao Lower B de domingo");
    const outro = await agenda.registrarSessaoAvulsa({ data: "2026-11-07", tipo: "musculacao", rotulo: "Treino livre", periodo: "noite" });
    eq(outro.scheduleItemId, null, "rótulo sem item correspondente fica fora da agenda");
  });

  // -------------------------------------------------------------------------
  // Arrastar treinos na semana
  // -------------------------------------------------------------------------
  await test("mover: Upper A de segunda (não feito) vai para terça à noite, antes do karatê", async () => {
    await reset();
    await seedMod.semearHub();
    await repo.definirConfig("primeiroDiaSemana", 1);
    const seg = "2026-10-26", ter = "2026-10-27";
    const upperA = (await repo.listarAgenda()).find((i) => i.rotulo === "Upper A");
    await agenda.marcarSessao(upperA, seg, "nao_feito");

    let semana = await agenda.carregarSemana(seg);
    eq(semana.naoFeitos, 1, "antes: 1 não feito");
    const previstosAntes = semana.previstos;
    const entrada = semana.dias[0].entradas.find((e) => e.item && e.item.id === upperA.id);
    assert(agenda.podeMover(entrada), "item da agenda pode ser movido");
    const karate = semana.dias[1].entradas.find((e) => e.tipo === "sessao");
    await agenda.moverEntrada(entrada, seg, { data: ter, periodo: "noite", ordem: karate.ordem - 1 });

    semana = await agenda.carregarSemana(seg);
    assert(!semana.dias[0].entradas.some((e) => e.item && e.item.id === upperA.id), "saiu da segunda");
    eq(semana.dias[0].entradas.filter((e) => e.tipo === "avulsa").length, 0, "o 'não feito' não vira avulsa");
    const terca = semana.dias[1].entradas;
    eq(terca.map((e) => e.item.rotulo).join(","), "Upper A,Intenso", "dois treinos à noite, musculação antes do karatê");
    eq(terca[0].periodo, "noite");
    eq(terca[0].log, null, "remarcado volta a ficar pendente");
    eq(semana.naoFeitos, 0, "o 'não feito' da segunda saiu");
    eq(semana.previstos, previstosAntes, "continua previsto uma vez só");
    eq((await repo.listarAgenda()).find((i) => i.id === upperA.id).diaSemana, 1, "a agenda-padrão não muda");

    // marcar feito na terça e mover de novo: o registro acompanha, sem duplicar
    await agenda.marcarSessao(upperA, ter, "feito");
    semana = await agenda.carregarSemana(seg);
    eq(semana.feitos >= 1, true);
    const naTerca = semana.dias[1].entradas.find((e) => e.item.id === upperA.id);
    await agenda.moverEntrada(naTerca, ter, { data: "2026-10-28", periodo: "manha", ordem: 5 });
    semana = await agenda.carregarSemana(seg);
    const naQuarta = semana.dias[2].entradas.find((e) => e.item && e.item.id === upperA.id);
    eq(naQuarta.log && naQuarta.log.status, "feito", "o 'feito' foi junto");
    eq(naQuarta.movimento.dataOrigem, seg, "a origem continua sendo a segunda");
    eq((await repo.listarSessoes()).filter((s) => s.scheduleItemId === upperA.id).length, 1, "um registro ativo só");
    eq((await repo.listarMovimentos()).length, 1, "mover de novo edita o mesmo movimento");

    // voltar ao previsto: segunda de manhã, levando o feito (reaproveita o registro da segunda)
    await agenda.voltarAoPrevisto(naQuarta);
    semana = await agenda.carregarSemana(seg);
    const deVolta = semana.dias[0].entradas.find((e) => e.item && e.item.id === upperA.id);
    eq(deVolta.periodo, "manha"); eq(deVolta.movimento, null);
    eq(deVolta.log && deVolta.log.status, "feito", "o feito voltou junto");
    eq((await repo.listarMovimentos()).length, 0, "movimento desfeito");
    eq((await repo.contarTudo()).sessionLogs, 3, "segunda (reativado), terça e quarta (removidos): nada duplicado");

    // a semana seguinte não é afetada
    const seguinte = await agenda.carregarSemana("2026-11-02");
    assert(seguinte.dias[0].entradas.some((e) => e.item && e.item.id === upperA.id), "segunda que vem segue normal");
  });

  await test("mover: corrida muda de dia e período (reagenda) e a registrada não se move", async () => {
    await reset();
    const w = await repo.salvarPlanned({ id: "w1", planId: "p", semana: 1, dataPlanejada: "2026-10-29", status: "futuro", titulo: "T" }, { novo: true });
    const r = await repo.reposicionarPlanned(w.id, { data: "2026-10-30", periodo: "noite", ordemDia: 2 });
    eq(r.dataPlanejada, "2026-10-30"); eq(r.dataOriginal, "2026-10-29"); eq(r.status, "reagendado");
    eq(r.periodo, "noite"); eq(r.sequence, 1);
    const dia = agenda.montarDia({ agenda: [], sessoes: [], corridas: [r], data: "2026-10-30" });
    eq(dia[0].periodo, "noite", "período da corrida vem do treino");
    const r2 = await repo.reposicionarPlanned(w.id, { data: "2026-10-30", periodo: "manha", ordemDia: 0 });
    eq(r2.sequence, 1, "mesmo dia: não reagenda de novo");
    await repo.marcarStatusPlanned(w.id, "concluido");
    let lancou = false;
    try { await repo.reposicionarPlanned(w.id, { data: "2026-10-31", periodo: "manha", ordemDia: 0 }); } catch { lancou = true; }
    assert(lancou, "corrida concluída não se move");
    assert(!agenda.podeMover({ tipo: "corrida", planned: { status: "concluido" } }));
  });

  // =========================================================================
  // v4: merge de sessões e registro retroativo de refeições
  // =========================================================================

  await test("migração v3→v4: todos os registros intactos, índices funcionando e sessionMerges vazio", async () => {
    await reset();
    const T = "2026-10-20T10:00:00.000Z";
    const dadosV3 = {
      plans: [{ id: "p1", nome: "Plano", ativo: true, criadoEm: T, atualizadoEm: T }],
      phases: [{ id: "f1", planId: "p1", numero: 1, nome: "F1", atualizadoEm: T }],
      plannedWorkouts: [{ id: "w1", planId: "p1", phaseId: "f1", semana: 1, dataPlanejada: "2026-10-22", status: "concluido", titulo: "T", periodo: "manha", ordemDia: 0, atualizadoEm: T }],
      completedWorkouts: [{ id: "c1", plannedWorkoutId: "w1", avulso: false, data: "2026-10-22", duracaoSeg: 1500, atualizadoEm: T }],
      discomforts: [{ id: "d1", completedWorkoutId: "c1", data: "2026-10-22", regiao: "joelho", intensidade: 1, atualizadoEm: T }],
      settings: [{ chave: "metas", valor: { proteinaMinG: 150, proteinaMaxG: 170, lowerPorSemana: 2 }, atualizadoEm: T }],
      weeklySchedule: [{ id: "a1", diaSemana: 4, periodo: "noite", tipo: "musculacao", rotulo: "Lower A", opcional: false, ordem: 0, atualizadoEm: T }],
      sessionLogs: [{ id: "s1", data: "2026-10-22", scheduleItemId: "a1", tipo: "musculacao", rotulo: "Lower A", periodo: "noite", opcional: false, status: "pulado", removido: false, atualizadoEm: T }],
      foodLogs: [{ id: "uuid-antigo", tipo: "refeicao", data: "2026-10-22", refeicaoId: "cafe", varianteIndex: 0, fracao: 1, macros: { kcal: 500, prot: 43, carb: 50, gord: 15 }, removido: false, atualizadoEm: T }],
      scheduleMoves: [{ id: "m1", scheduleItemId: "a1", dataOrigem: "2026-10-22", data: "2026-10-23", periodo: "manha", ordem: 0, removido: false, atualizadoEm: T }],
    };
    const v3 = await new Promise((resolve, reject) => {
      const r = globalThis.indexedDB.open(DB_NOME, 3);
      r.onupgradeneeded = () => { migrarPara1(r.result); migrarPara2(r.result); migrarPara3(r.result); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    eq(v3.objectStoreNames.length, 10, "v3 tem 10 stores");
    await new Promise((resolve, reject) => {
      const tx = v3.transaction(Object.keys(dadosV3), "readwrite");
      for (const [s, recs] of Object.entries(dadosV3)) for (const r of recs) tx.objectStore(s).put(r);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    v3.close();

    const db = await abrirDB();
    eq(db.version, 5, "versão 5");
    const dump = await repo.exportarTudo();
    for (const [s, recs] of Object.entries(dadosV3)) {
      eq(JSON.stringify(dump.stores[s]), JSON.stringify(recs), `${s} idêntico byte a byte`);
    }
    eq(dump.stores.sessionMerges.length, 0, "sessionMerges vazio");
    eq((await repo.plannedNaData("2026-10-22")).length, 1, "índice dataPlanejada");
    eq((await repo.listarSessoes({ de: "2026-10-22", ate: "2026-10-22" })).length, 1, "índice data de sessionLogs");
    eq((await repo.listarMovimentos({ de: "2026-10-23", ate: "2026-10-23" })).length, 1, "índice data de scheduleMoves");
    eq((await repo.listarRegistrosAlimentares({ de: "2026-10-22", ate: "2026-10-22" })).length, 1, "índice data de foodLogs");
    eq((await repo.listarMerges({ de: "2026-10-01", ate: "2026-10-31" })).length, 0, "índice data de sessionMerges");

    // a refeição antiga (UUID) continua sendo a do dia: registrar de novo edita
    const ed = await repo.registrarRefeicao({ data: "2026-10-22", refeicaoId: "cafe", fracao: 0.5, macros: { prot: 43 } });
    eq(ed.id, "uuid-antigo", "edita o registro antigo, não cria outro");
  });

  await test("merge (repository): origens viram 'mesclada'; desfazer restaura o estado de antes", async () => {
    await reset();
    const la = await repo.salvarItemAgenda({ diaSemana: 4, periodo: "noite", tipo: "musculacao", rotulo: "Lower A" });
    const lb = await repo.salvarItemAgenda({ diaSemana: 0, periodo: "manha", tipo: "musculacao", rotulo: "Lower B" });
    const antes = await agenda.marcarSessao(la, "2026-10-29", "nao_feito", { duracaoMin: 5 });
    const origens = [
      { scheduleItemId: la.id, dataOcorrencia: "2026-10-29", tipo: "musculacao", rotulo: "Lower A", periodo: "noite" },
      { scheduleItemId: lb.id, dataOcorrencia: "2026-11-01", tipo: "musculacao", rotulo: "Lower B", periodo: "manha" },
    ];
    const m = await repo.juntarSessoes({ origens, data: "2026-10-31", periodo: "manha", rotulo: "Lower A + Lower B" });
    eq(m.origens[0].logAnterior.status, "nao_feito", "guarda o registro de antes");
    eq(m.origens[1].logAnterior, null, "Lower B não tinha registro");
    let ses = await repo.listarSessoes();
    eq(ses.length, 2);
    assert(ses.every((s) => s.status === "mesclada" && s.mergeId === m.id), "as duas origens mescladas, com vínculo");
    eq(ses.find((s) => s.scheduleItemId === la.id).id, antes.id, "reaproveita o registro do Lower A (1 por data e item)");

    let lancou = false;
    try { await agenda.marcarSessao(la, "2026-10-29", "feito"); } catch { lancou = true; }
    assert(lancou, "origem mesclada não muda pelo check");
    lancou = false;
    try { await repo.juntarSessoes({ origens, data: "2026-10-31", periodo: "manha", rotulo: "x" }); } catch { lancou = true; }
    assert(lancou, "origem já mesclada não entra em outro merge");

    await repo.desfazerMerge(m.id);
    ses = await repo.listarSessoes();
    eq(ses.length, 1, "só o Lower A tinha registro");
    eq(ses[0].status, "nao_feito"); eq(ses[0].duracaoMin, 5); eq(ses[0].id, antes.id);
    eq(ses[0].mergeId, undefined, "sem vínculo depois de desfazer");
    eq((await repo.listarMerges()).length, 0, "merge desfeito some da lista");
    eq((await repo.contarTudo()).sessionMerges, 1, "mas fica no banco (tombstone)");

    // com a combinada feita, não desfaz
    const m2 = await repo.juntarSessoes({ origens, data: "2026-10-31", periodo: "manha", rotulo: "Lower A + Lower B" });
    await repo.atualizarMerge(m2.id, { status: "feito", duracaoMin: 70 });
    lancou = false;
    try { await repo.desfazerMerge(m2.id); } catch { lancou = true; }
    assert(lancou, "combinada feita não desfaz");
  });

  await test("merge (repository): recusa sessão feita, corrida/karatê e a mesma sessão duas vezes", async () => {
    await reset();
    const ua = await repo.salvarItemAgenda({ diaSemana: 1, periodo: "manha", tipo: "musculacao", rotulo: "Upper A" });
    const ub = await repo.salvarItemAgenda({ diaSemana: 3, periodo: "manha", tipo: "musculacao", rotulo: "Upper B" });
    await agenda.marcarSessao(ua, "2026-10-26", "feito");
    const o = (item, data, tipo = "musculacao") => ({ scheduleItemId: item.id, dataOcorrencia: data, tipo, rotulo: item.rotulo, periodo: "manha" });
    const recusa = async (args, msg) => {
      let lancou = false;
      try { await repo.juntarSessoes({ data: "2026-10-31", periodo: "manha", rotulo: "x", ...args }); } catch { lancou = true; }
      assert(lancou, msg);
    };
    await recusa({ origens: [o(ua, "2026-10-26"), o(ub, "2026-10-28")] }, "sessão feita");
    await recusa({ origens: [o(ub, "2026-10-28"), o(ub, "2026-10-28")] }, "a mesma sessão duas vezes");
    await recusa({ origens: [o(ub, "2026-10-28"), { ...o(ua, "2026-10-29"), tipo: "karate" }] }, "karatê");
    await recusa({ origens: [o(ub, "2026-10-28"), { ...o(ua, "2026-10-29"), tipo: "corrida" }] }, "corrida");
    await recusa({ origens: [o(ub, "2026-10-28")] }, "uma sessão só");
    eq((await repo.contarTudo()).sessionMerges, 0, "nada gravado");
  });

  await test("merge: Lower A + Lower B sem duplicados, compostos primeiro, bi-set e dentro do teto", () => {
    const s = merge.montarSugestao(["Lower A", "Lower B"]);
    const nomes = s.itens.map((i) => i.nome);
    eq(nomes.filter((n) => n === "Flexora").length, 1, "uma flexora só");
    eq(nomes.filter((n) => n === "Panturrilha").length, 1, "uma panturrilha só");
    eq(s.itens.slice(0, 3).map((i) => i.papel).join(","), "composto,composto,composto", "compostos primeiro");
    eq(s.itens.slice(0, 3).map((i) => i.slot).join(","), "quad_composto,dobradica,quad_secundario");
    const iExt = nomes.indexOf("Extensora");
    eq(nomes[iExt + 1], "Flexora", "extensora e flexora juntas");
    eq(s.itens[iExt].bisetCom, "Flexora", "em bi-set");
    assert(s.series <= 20, `séries ${s.series} ≤ 20`);
    assert(s.minutos <= 70, `minutos ${s.minutos} ≤ 70`);
    eq(s.cortes.map((c) => c.nome).join(","), "Core,Adução", "acessórios saem primeiro");
    eq(s.excede, false);
    const vol = Object.fromEntries(s.volume.map((v) => [v.grupo, v]));
    eq(vol.quadriceps.series, 10); eq(vol.quadriceps.meta, 10);
    eq(vol.posterior_gluteo.series, 7); eq(vol.posterior_gluteo.meta, 8);
    eq(vol.panturrilha.series, 3); eq(vol.panturrilha.meta, 6);
    eq(s.volume.slice(0, 3).map((v) => v.grupo).join(","), "quadriceps,posterior_gluteo,panturrilha", "grupos com meta primeiro");

    // teto menor: depois dos acessórios, corta séries de isoladores
    const apertado = { ...merge.CONFIG_PADRAO, LIMITES: { ...merge.CONFIG_PADRAO.LIMITES, tetoSeries: 18 } };
    const s2 = merge.montarSugestao(["Lower A", "Lower B"], apertado);
    eq(s2.series, 18);
    eq(s2.cortes.slice(0, 2).map((c) => c.tipo).join(","), "item,item");
    eq(s2.cortes.slice(2).every((c) => c.tipo === "serie"), true, "depois, séries de isoladores");
    eq(merge.montarSugestao(["Lower A", "Treino X"]).semConfig.join(), "Treino X", "rótulo sem configuração é avisado");
  });

  await test("merge: bloqueia feita, corrida/karatê, semanas diferentes e combinada fora da semana; avisa Upper + Lower", () => {
    const item = (id, tipo, rotulo) => ({ id, tipo, rotulo, diaSemana: 1, periodo: "manha" });
    const ses = (it, log = null) => ({ tipo: "sessao", item: it, log, remanejado: null, merge: null, periodo: "manha", ordem: 0 });
    const la = ses(item("la", "musculacao", "Lower A"));
    const lb = ses(item("lb", "musculacao", "Lower B"));
    const ua = ses(item("ua", "musculacao", "Upper A"));
    const inicio = "2026-10-26";
    const v = (escolhidas, data = "2026-10-31") => merge.validarMerge({ escolhidas, data, inicio });
    eq(v([{ entrada: la, data: "2026-10-29" }, { entrada: lb, data: "2026-11-01" }]).erros.length, 0, "Lower A + Lower B ok");
    const feito = ses(item("lb", "musculacao", "Lower B"), { status: "feito" });
    assert(v([{ entrada: la, data: "2026-10-29" }, { entrada: feito, data: "2026-11-01" }]).erros.length, "feita bloqueia");
    assert(!merge.podeJuntar(feito));
    const kar = ses(item("k", "karate", "Intenso"));
    assert(v([{ entrada: la, data: "2026-10-29" }, { entrada: kar, data: "2026-10-27" }]).erros.length, "karatê bloqueia");
    assert(v([{ entrada: la, data: "2026-10-29" }, { entrada: { tipo: "corrida", planned: {} }, data: "2026-10-29" }]).erros.length, "corrida bloqueia");
    assert(v([{ entrada: la, data: "2026-10-29" }, { entrada: lb, data: "2026-11-08" }]).erros.length, "outra semana bloqueia");
    assert(v([{ entrada: la, data: "2026-10-29" }, { entrada: lb, data: "2026-11-01" }], "2026-11-02").erros.length, "combinada fora da semana");
    assert(v([{ entrada: la, data: "2026-10-29" }, { entrada: la, data: "2026-10-29" }]).erros.length, "a mesma sessão");
    const ul = v([{ entrada: ua, data: "2026-10-26" }, { entrada: la, data: "2026-10-29" }]);
    eq(ul.erros.length, 0, "Upper + Lower é permitido");
    eq(ul.avisos[0], merge.AVISO_FULL_BODY, "com aviso de full body");

    // dia seguinte
    assert(merge.diaSeguintePesado([{ tipo: "corrida", planned: {} }]), "corrida no dia seguinte");
    assert(merge.diaSeguintePesado([kar]), "karatê intenso no dia seguinte");
    assert(!merge.diaSeguintePesado([ses(item("k2", "karate", "Leve"))]), "karatê leve não avisa");
  });

  await test("merge: caso de 31/10 — Lower A + B no sábado, Upper A para domingo, 4 de 4 cobertas (1 mesclada)", async () => {
    await reset();
    await seedMod.semearHub();
    await repo.definirConfig("primeiroDiaSemana", 1);
    const ag = await repo.listarAgenda();
    const por = (r) => ag.find((i) => i.rotulo === r && i.tipo === "musculacao");
    const SAB = "2026-10-31", DOM = "2026-11-01";
    await agenda.marcarSessao(por("Upper B"), "2026-10-28", "feito");
    await agenda.marcarSessao(por("Lower A"), "2026-10-29", "nao_feito");

    let semana = await agenda.carregarSemana(SAB);
    const pend = merge.pendentesDaSemana(semana);
    eq(pend.map((p) => p.entrada.item.rotulo).join(","), "Upper A,Lower A,Lower B", "três pendentes");
    eq(merge.atrasadasDaSemana(semana, SAB).map((p) => p.entrada.item.rotulo).join(","), "Upper A", "atrasada (com ✕ fica de fora)");
    const escolhidas = pend.filter((p) => agenda.ehLower(p.entrada.item.rotulo));

    // juntar e desfazer: volta ao estado de antes
    let m = await merge.juntar({ escolhidas, data: SAB, periodo: "manha" });
    eq(m.rotulo, "Lower A + Lower B");
    eq(m.plano.itens.filter((i) => i.nome === "Flexora").length, 1, "snapshot da sugestão no merge");
    semana = await agenda.carregarSemana(SAB);
    eq(semana.musculacao.mescladas, 1);
    eq(semana.musculacao.cobertas, 1, "combinada pendente: origens não contam ainda");
    eq(semana.naoFeitos, 0, "o não feito virou mesclada");
    await merge.desfazer(m);
    semana = await agenda.carregarSemana(SAB);
    const laDepois = semana.dias[3].entradas.find((e) => e.item && e.item.rotulo === "Lower A");
    eq(laDepois.log.status, "nao_feito", "Lower A voltou a não feito");
    const lbDepois = semana.dias[6].entradas.find((e) => e.item && e.item.rotulo === "Lower B");
    eq(lbDepois.log, null, "Lower B voltou sem registro");
    eq(semana.musculacao.mescladas, 0);
    eq(semana.dias[5].entradas.filter((e) => e.tipo === "mesclada").length, 0, "combinada sumiu do sábado");

    // juntar de novo, reorganizar e cumprir a semana
    m = await merge.juntar({ escolhidas: merge.pendentesDaSemana(await agenda.carregarSemana(SAB)).filter((p) => agenda.ehLower(p.entrada.item.rotulo)), data: SAB, periodo: "manha" });
    semana = await agenda.carregarSemana(SAB);
    const sab = semana.dias[5].entradas;
    eq(sab[0].tipo, "mesclada", "combinada no sábado de manhã, antes da corrida");
    const domingo = semana.dias[6].entradas.find((e) => e.item && e.item.rotulo === "Lower B");
    eq(domingo.merge && domingo.merge.id, m.id, "origem aponta para a combinada");
    assert(!agenda.podeMover(domingo), "origem mesclada não se move");

    const reorg = merge.sugerirReorganizacao(semana, SAB);
    eq(reorg.length, 1);
    eq(reorg[0].entrada.item.rotulo, "Upper A");
    eq(reorg[0].destino, DOM, "Upper A vai para o domingo (dia livre)");
    await merge.aplicarReorganizacao(reorg[0]);

    await merge.alternarCombinada(m, "feito");
    await agenda.marcarSessao(por("Upper A"), DOM, "feito");
    semana = await agenda.carregarSemana(SAB);
    eq(semana.musculacao.previstas, 4);
    eq(semana.musculacao.cobertas, 4, "4 de 4 cobertas");
    eq(semana.musculacao.mescladas, 1, "1 mesclada");
    eq(semana.lower, 2, "Lower 2 de 2");
    eq(semana.naoFeitos, 0, "nada perdido");
    const extrasAntes = semana.extras;
    eq(semana.dias[6].entradas.filter((e) => e.item && e.item.rotulo === "Upper A").length, 1, "Upper A no domingo");
    eq(extrasAntes, 0, "a combinada não conta como extra");
    let lancou = false;
    try { await merge.desfazer(m); } catch { lancou = true; }
    assert(lancou, "depois de feita não desfaz");

    // backup traz o merge e o import não duplica
    const dump = await repo.exportarTudo();
    eq(dump.stores.sessionMerges.length, 2, "o desfeito vai como tombstone");
    eq(dump.stores.sessionMerges.filter((x) => !x.removido).length, 1, "um merge ativo");
    assert(dump.stores.sessionLogs.filter((s) => s.mergeId === m.id).length === 2, "vínculo das origens no backup");
    eq((await repo.importarBackup(dump)).criados, 0, "reimportar não duplica");
  });

  await test("retroativo: registrar num dia passado atualiza o total do dia e a média de 7 dias", async () => {
    await reset();
    const hj = hojeDeHoje();
    const d = (n) => somarDias(hj, -n);
    await nutri.registrarProteinaExtra({ data: d(1), proteinaG: 150 });
    await nutri.registrarProteinaExtra({ data: d(3), proteinaG: 130 });
    let dia = await nutri.carregarDia(d(2));
    eq(dia.totais.proteina, 0, "dia esquecido começa zerado");
    eq(dia.media7d.diasComRegistro, 1, "só um dia com registro até d-2 (d-3)");
    eq(dia.media7d.media, 130);
    let agora = await nutri.carregarDia(hj);
    eq(agora.media7d.media, 140, "(150 + 130) / 2: dias vazios fora");

    // completa o dia esquecido (d-2): café + almoço
    await nutri.registrarRefeicao({ data: d(2), refeicaoId: "cafe", varianteIndex: 0 });   // 43
    await nutri.registrarRefeicao({ data: d(2), refeicaoId: "almoco", varianteIndex: 0 }); // 48
    dia = await nutri.carregarDia(d(2));
    eq(dia.totais.proteina, 91, "total do dia recalculado");
    eq(dia.porRefeicao.cafe.data, d(2), "data = o dia a que se refere");
    assert(nutri.registradoDepois(dia.porRefeicao.cafe), "marcado como lançado depois");
    agora = await nutri.carregarDia(hj);
    eq(agora.media7d.diasComRegistro, 3);
    eq(agora.media7d.media, Math.round((150 + 91 + 130) / 3), "média de 7 dias recalculada");

    // editar e remover no dia passado
    await nutri.registrarRefeicao({ data: d(2), refeicaoId: "almoco", varianteIndex: 0, fracao: 0.5 });
    eq((await nutri.carregarDia(d(2))).totais.proteina, 67, "43 + 24");
    await nutri.desfazerRegistro((await nutri.carregarDia(d(2))).porRefeicao.cafe);
    eq((await nutri.carregarDia(d(2))).totais.proteina, 24, "café removido");

    // semana de proteína marca o dia lançado depois
    const sem = nutri.resumirSemanaProteina({
      registros: await repo.listarRegistrosAlimentares(), inicio: inicioDaSemana(d(2), 1), metas: METAS_PADRAO, hoje: hj,
    });
    assert(sem.dias.find((x) => x.data === d(2)).retroativo, "🕐 no dia lançado depois");
  });

  await test("retroativo: dia sem registro fica fora da média de 7 dias (não entra como zero)", () => {
    const R = (data, prot) => ({ tipo: "extra", data, proteinaG: prot });
    const m = nutri.mediaMovel7d({ registros: [R("2026-10-20", 160), R("2026-10-22", 140)], dataRef: "2026-10-24", hoje: "2026-10-31" });
    eq(m.dias.length, 7, "18 a 24");
    eq(m.diasComRegistro, 2); eq(m.diasSemRegistro, 5);
    eq(m.media, 150, "e não (160+140)/7");
    eq(m.dias.find((x) => x.data === "2026-10-21").proteina, null, "sem registro = null, não 0");
    const futuro = nutri.mediaMovel7d({ registros: [R("2026-10-30", 100)], dataRef: "2026-11-02", hoje: "2026-10-31" });
    eq(futuro.dias.length, 5, "dias futuros não contam");
    eq(nutri.mediaMovel7d({ registros: [], dataRef: "2026-10-24", hoje: "2026-10-31" }).media, null, "nenhum registro = sem média");
    // lançado no próprio dia: sem 🕐; lançado depois: com
    eq(nutri.registradoDepois({ data: "2026-10-20", criadoEm: new Date(2026, 9, 20, 21, 0).toISOString() }), false);
    eq(nutri.registradoDepois({ data: "2026-10-20", criadoEm: new Date(2026, 9, 21, 8, 0).toISOString() }), true);
  });

  await test("retroativo: lembrete de lacuna de ontem, dispensar e duplicado de backup contado uma vez", async () => {
    await reset();
    const hj = hojeDeHoje();
    eq(await nutri.lacunaOntem(hj), null, "sem nenhum registro ainda: não cobra");
    await nutri.registrarProteinaExtra({ data: somarDias(hj, -3), proteinaG: 20 });
    eq(await nutri.lacunaOntem(hj), somarDias(hj, -1), "ontem vazio => aviso");
    await nutri.dispensarLacuna(somarDias(hj, -1));
    eq(await nutri.lacunaOntem(hj), null, "dispensado para aquele dia");
    await repo.definirConfig("lacunaDispensada", null);
    await nutri.registrarRefeicao({ data: somarDias(hj, -1), refeicaoId: "jantar", varianteIndex: 0 });
    eq(await nutri.lacunaOntem(hj), null, "ontem registrado => sem aviso");

    // backup de outro aparelho com a mesma (data, refeição) e outro ID: conta uma vez, vale o mais recente
    const ontem = somarDias(hj, -1);
    await repo.importarBackup({ stores: { foodLogs: [{
      id: "uuid-de-outro-aparelho", tipo: "refeicao", data: ontem, refeicaoId: "jantar", fracao: 0.5,
      macros: { kcal: 0, prot: 40, carb: 0, gord: 0 }, removido: false, atualizadoEm: "2999-01-01T00:00:00.000Z",
    }] } });
    const dia = await nutri.carregarDia(ontem);
    eq(dia.registros.filter((r) => r.refeicaoId === "jantar").length, 1, "um jantar só");
    eq(dia.totais.proteina, 20, "vale o mais recente (40 × 0,5)");
  });

  await test("refeições: dia futuro recusado; mesmo dia e refeição duas vezes não duplica (ID estável)", async () => {
    await reset();
    let lancou = false;
    try { await nutri.registrarRefeicao({ data: somarDias(hojeDeHoje(), 1), refeicaoId: "cafe" }); } catch { lancou = true; }
    assert(lancou, "amanhã recusado");
    lancou = false;
    try { await nutri.registrarProteinaExtra({ data: somarDias(hojeDeHoje(), 1), proteinaG: 20 }); } catch { lancou = true; }
    assert(lancou, "extra amanhã recusado");

    const d = "2026-10-25";
    const a = await nutri.registrarRefeicao({ data: d, refeicaoId: "almoco", varianteIndex: 0 });
    const b = await nutri.registrarRefeicao({ data: d, refeicaoId: "almoco", varianteIndex: 0, fracao: 0.5 });
    eq(a.id, repo.idRefeicao(d, "almoco"), "ID estável por dia e refeição");
    eq(b.id, a.id, "mesmo registro");
    await nutri.desfazerRegistro(b);
    const c = await nutri.registrarRefeicao({ data: d, refeicaoId: "almoco", varianteIndex: 0 });
    eq(c.id, a.id, "reativa o mesmo registro");
    eq((await repo.contarTudo()).foodLogs, 1, "um registro só no banco");
    eq(c.criadoEm, a.criadoEm, "criadoEm não muda ao editar");
  });

  // -------------------------------------------------------------------------
  // Aba Semana (v5): banco, serviço e motor ligados aos dados
  // -------------------------------------------------------------------------
  await test("migração v4→v5: stores novos vazios, resto idêntico e 'pulado' lido como não feito", async () => {
    await reset();
    const T = "2026-10-20T10:00:00.000Z";
    const dados = {
      plans: [{ id: "p1", nome: "Plano", ativo: true, criadoEm: T, atualizadoEm: T }],
      weeklySchedule: [{ id: "a1", diaSemana: 4, periodo: "noite", tipo: "musculacao", rotulo: "Lower A", opcional: false, ordem: 0, atualizadoEm: T }],
      sessionLogs: [{ id: "s1", data: "2026-10-22", scheduleItemId: "a1", tipo: "musculacao", rotulo: "Lower A", periodo: "noite", opcional: false, status: "pulado", removido: false, atualizadoEm: T }],
      sessionMerges: [{ id: "m1", tipo: "musculacao", data: "2026-10-24", periodo: "manha", rotulo: "Lower A + Lower B", origens: [], status: "pulado", removido: false, atualizadoEm: T }],
    };
    const v4 = await new Promise((resolve, reject) => {
      const r = globalThis.indexedDB.open(DB_NOME, 4);
      r.onupgradeneeded = () => { migrarPara1(r.result); migrarPara2(r.result); migrarPara3(r.result); migrarPara4(r.result); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise((resolve, reject) => {
      const tx = v4.transaction(Object.keys(dados), "readwrite");
      for (const [s, recs] of Object.entries(dados)) for (const x of recs) tx.objectStore(s).put(x);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    v4.close();

    const db = await abrirDB();
    eq(db.version, 5, "versão 5");
    const dump = await repo.exportarTudo();
    for (const [s, recs] of Object.entries(dados)) eq(JSON.stringify(dump.stores[s]), JSON.stringify(recs), `${s} idêntico byte a byte`);
    for (const s of ["dailyCheckins", "weekExceptions", "weekHistory"]) eq(dump.stores[s].length, 0, `${s} vazio`);
    eq((await repo.listarSessoes())[0].status, "nao_feito", "pulado antigo é lido como não feito");
    eq((await repo.listarMerges())[0].status, "nao_feito", "combinada pulada também");
    let lancou = false;
    try { await repo.registrarSessao({ data: "2026-10-29", status: "pulado" }); } catch { lancou = true; }
    assert(lancou, "o app não grava mais 'pulado'");
  });

  // Semana de 02 a 08/11/2026 com agenda-padrão e corridas na quinta e no sábado.
  const prepararSemanaDeTeste = async () => {
    await reset();
    await seedMod.semearHub();
    await repo.definirConfig("primeiroDiaSemana", 1);
    const plano = await repo.salvarPlano({ nome: "Plano", ativo: true, totalSemanas: 22, dataInicio: "2026-11-02" }, { novo: true });
    const corrida = (id, dataPlanejada) => repo.salvarPlanned({ id, planId: plano.id, semana: 1, dataPlanejada, status: "futuro", titulo: "Corrida", duracaoMin: 30, descricao: "", rpeMin: 3, rpeMax: 4 }, { novo: true });
    await corrida("run-qui", "2026-11-05");
    await corrida("run-sab", "2026-11-07");
    const ag = await repo.listarAgenda();
    const item = (dia, rotulo) => ag.find((i) => i.diaSemana === dia && i.rotulo === rotulo);
    return {
      marcar: (dia, rotulo, data, status) => agenda.marcarSessao(item(dia, rotulo), data, status),
      item,
      quando: (d, h, m = 0) => new Date(2026, 10, d, h, m),
    };
  };
  const semanaEmDiaAteQuarta = async (s) => {
    await s.marcar(1, "Upper A", "2026-11-02", "feito");
    await s.marcar(1, "Leve", "2026-11-02", "feito");
    await s.marcar(2, "Intenso", "2026-11-03", "feito");
    await s.marcar(3, "Upper B", "2026-11-04", "feito");
    await s.marcar(3, "Leve", "2026-11-04", "feito");
  };

  await test("semana: aceitar rota aplica pelas funções existentes e volta a 'segue como está'", async () => {
    const s = await prepararSemanaDeTeste();
    await semanaEmDiaAteQuarta(s);
    const agora = s.quando(6, 12, 47);
    const antes = await semanaSrv.situacaoSemana(agora);
    assert(antes.aviso && antes.avaliacao.perdidas.length === 2, "corrida e Lower A de quinta sem registro");
    const calc = await semanaSrv.recalcular(agora);
    eq(calc.tipo, "rotas");
    const rota = calc.rotas.find((r) => r.ops.some((o) => o.tipo === "juntar"));
    assert(rota, "há rota que junta os Lower");
    eq((await repo.listarMerges()).length, 0, "nada muda antes de aceitar");

    await semanaSrv.aceitarRota(rota, agora);
    const depois = await semanaSrv.situacaoSemana(agora);
    eq(depois.aviso, false, depois.avaliacao.motivo);
    const m = (await repo.listarMerges())[0];
    eq(m.rotulo, "Lower A + Lower B", "usou o merge existente");
    assert(m.plano && m.plano.itens.length, "com o snapshot da sugestão");
    const hist = await repo.obterHistoricoSemana("2026-11-02");
    assert(hist.planoOriginal.length >= 10, "plano original guardado");
    eq(hist.escolhas.length, 1, "rota aceita no histórico");
    eq(hist.escolhas[0].mudancas.length, rota.mudancas.length);
    assert(hist.escolhas[0].custo === rota.custo && hist.escolhas[0].em, "custo, data e hora");
    eq(hist.planoOriginal.find((p) => p.plannedWorkoutId === "run-qui").data, "2026-11-05", "a corrida segue no dia original");
  });

  await test("semana: rota que move, encurta ou deixa de fazer grava nos status existentes", async () => {
    const s = await prepararSemanaDeTeste();
    await semanaEmDiaAteQuarta(s);
    await s.marcar(4, "Lower A", "2026-11-05", "feito");
    await repo.marcarStatusPlanned("run-qui", "concluido");
    const agora = s.quando(7, 7, 30);
    await semanaSrv.salvarCheckinDeHoje({ fascia: true }, agora);
    const sit = await semanaSrv.situacaoSemana(agora);
    assert(sit.aviso, "fáscia gera aviso sozinha");
    const calc = await semanaSrv.recalcular(agora);
    const encurtar = calc.rotas.find((r) => r.ops.some((o) => o.tipo === "encurtar"));
    const naoFazer = calc.rotas.find((r) => r.ops.some((o) => o.tipo === "naoFazer" && o.id === "run:run-sab"));
    assert(encurtar && naoFazer, "encurtar e não fazer");
    assert(!calc.rotas.some((r) => r.ops.some((o) => o.tipo === "mover" && o.id === "run:run-sab")), "não vai para outro dia");

    await semanaSrv.aceitarRota(encurtar, agora);
    let w = await repo.obterPlanned("run-sab");
    assert(w.encurtada, "marcada como encurtada");
    eq(w.status, "futuro", "continua pendente: só vira encurtado ao registrar");
    eq((await semanaSrv.situacaoSemana(agora)).aviso, false, "a corrida encurtada respeita a fáscia");
    assert(agenda.podeMover({ tipo: "corrida", planned: w }), "pendente ainda pode mudar");

    await repo.registrarTreino({ plannedWorkoutId: "run-sab", data: "2026-11-07", duracaoSeg: 720, encurtada: true });
    w = await repo.obterPlanned("run-sab");
    eq(w.status, "encurtado");
    eq(w.duracaoRealMin, 12, "soma o tempo informado");
    assert(!agenda.podeMover({ tipo: "corrida", planned: w }), "conta como feita");
    eq(statusEfetivo(w, "2026-11-20"), "encurtado");
    const prog = progressoSemana(await repo.listarPlanned({ planId: w.planId }), 1);
    eq(prog.feitos, 2, "conta como feita no progresso");
    eq(prog.minFeitos, 42, "30 da corrida inteira + 12 da encurtada");
    const res = (await agenda.carregarSemana("2026-11-07"));
    eq(res.feitos, 8, "conta como feita na semana");
    await repo.definirCorridaEncurtada("run-sab", false, 720);
    eq((await repo.obterPlanned("run-sab")).status, "concluido", "o formulário de edição corrige");
  });

  await test("semana: marcar o que faltava resolve o aviso; ✕ novo pede recálculo; ✕ de rota aceita não volta", async () => {
    const s = await prepararSemanaDeTeste();
    const agora = s.quando(4, 8);
    let sit = await semanaSrv.situacaoSemana(agora);
    eq(sit.avaliacao.perdidas.length, 3, "segunda e terça sem registro");

    await s.marcar(1, "Upper A", "2026-11-02", "feito");
    await s.marcar(1, "Leve", "2026-11-02", "feito");
    await s.marcar(2, "Intenso", "2026-11-03", "feito");
    sit = await semanaSrv.situacaoSemana(agora);
    assert(!sit.avaliacao.fora, "tudo marcado");
    eq(sit.aviso, false, "sem nada a fazer, não pede recálculo");
    const emDia = await semanaSrv.recalcular(agora);
    eq(emDia.tipo, "em_dia");

    await s.marcar(1, "Upper A", "2026-11-02", "nao_feito");
    sit = await semanaSrv.situacaoSemana(agora);
    assert(sit.aviso && sit.pendente, "✕ novo pede recálculo");
    eq((await semanaSrv.situacaoSemana(agora)).pendente, true, "continua depois de reler, como ao reabrir o app");
    await s.marcar(1, "Upper A", "2026-11-02", "feito");
    eq((await semanaSrv.situacaoSemana(agora)).aviso, false, "tirar o ✕ tira o aviso");
    await s.marcar(1, "Upper A", "2026-11-02", "nao_feito");
    const calc = await semanaSrv.recalcular(agora);
    eq((await semanaSrv.situacaoSemana(agora)).pendente, false, "depois de recalcular, o ✕ já foi visto");
    eq(calc.tipo, "ofertas");
    const mover = calc.rotas.find((r) => r.mudancas[0] === "Mover Upper A para sexta de manhã");
    assert(mover, `oferece mover: ${calc.rotas.map((r) => r.mudancas[0])}`);

    await semanaSrv.manterComoEsta(agora);
    eq((await repo.obterHistoricoSemana("2026-11-02")).escolhas.at(-1).tipo, "manter", "manter fica no histórico");
    eq((await semanaSrv.situacaoSemana(agora)).aviso, false);

    await semanaSrv.aceitarRota(mover, agora);
    const semana = await agenda.carregarSemana("2026-11-04");
    const sexta = semana.dias[4].entradas.find((e) => e.item && e.item.rotulo === "Upper A");
    assert(sexta && !sexta.log, "o ✕ saiu e o treino está pendente na sexta");
    eq((await semanaSrv.situacaoSemana(agora)).aviso, false);
    eq((await semanaSrv.recalcular(agora)).tipo, "em_dia", "nada mais a oferecer");
  });

  await test("semana: semana comprometida fecha o resto como não feito só ao aceitar", async () => {
    const s = await prepararSemanaDeTeste();
    const agora = s.quando(7, 8);
    const calc = await semanaSrv.recalcular(agora);
    eq(calc.tipo, "comprometida");
    const rota = calc.rotas[0];
    eq(rota.ops.filter((o) => o.tipo === "juntar").length, 2);
    eq((await repo.listarSessoes()).length, 0, "nada gravado antes de aceitar");
    await semanaSrv.aceitarRota(rota, agora);
    eq((await repo.listarMerges()).length, 2, "dois merges");
    assert((await repo.listarSessoes()).filter((x) => x.status === "nao_feito").length >= 3, "karatês como não feitos");
    eq((await repo.obterPlanned("run-qui")).status, "nao_realizado");
    const sit = await semanaSrv.situacaoSemana(agora);
    eq(sit.aviso, false, sit.avaliacao.motivo);
    await s.marcar(1, "Leve", "2026-11-02", "feito");
    eq((await repo.listarSessoes()).find((x) => x.scheduleItemId === s.item(1, "Leve").id).status, "feito", "marcação retroativa continua valendo");
  });

  await test("semana: fecha na primeira abertura depois de domingo e a semana seguinte começa limpa", async () => {
    const s = await prepararSemanaDeTeste();
    await semanaEmDiaAteQuarta(s);
    await semanaSrv.prepararSemana(s.quando(6, 10));
    await semanaSrv.definirExcecao("2026-11-06", { bloqueio: "manha", feriado: false });
    await semanaSrv.salvarCheckinDeHoje({ disposicao: 2 }, s.quando(6, 10));

    const segunda = new Date(2026, 10, 9, 7);
    const sit = await semanaSrv.situacaoSemana(segunda);
    const hist = await repo.obterHistoricoSemana("2026-11-02");
    assert(hist.fechadaEm, "semana anterior fechada");
    eq(hist.resultado.naoFeitos, 4, "corrida e Lower pendentes de quinta, corrida de sábado e Lower B");
    const logs = await repo.listarSessoes({ de: "2026-11-02", ate: "2026-11-08" });
    assert(!logs.some((x) => x.rotulo === "Leve" && x.data === "2026-11-06"), "aula opcional não é cobrada");
    eq((await repo.obterPlanned("run-sab")).status, "nao_realizado");

    assert(await repo.obterHistoricoSemana("2026-11-09"), "plano original da semana nova");
    eq(sit.semana.inicio, "2026-11-09");
    eq(Object.keys(sit.estado.ctx.excecoes).length, 0, "exceções zeradas");
    eq(sit.checkin, null, "check-in zerado");
    eq((await repo.listarCheckins()).length, 1, "o check-in antigo fica no histórico");

    await s.marcar(4, "Lower A", "2026-11-05", "feito");
    await semanaSrv.atualizarResultadoSemana("2026-11-02");
    eq((await repo.obterHistoricoSemana("2026-11-02")).resultado.naoFeitos, 3, "marcação retroativa atualiza o resultado");

    const dump = await repo.exportarTudo();
    assert(dump.stores.weekHistory.length === 2 && dump.stores.dailyCheckins.length === 1 && dump.stores.weekExceptions.length === 1, "entram no backup");
    eq((await repo.importarBackup(dump)).criados, 0, "reimportar não duplica");
  });

  await test("semana: desfazer a rota volta tudo como estava, enquanto os treinos não mudarem", async () => {
    const s = await prepararSemanaDeTeste();
    await semanaEmDiaAteQuarta(s);
    const agora = s.quando(6, 12, 47);
    await semanaSrv.situacaoSemana(agora);
    const antes = await repo.fotografarSemana({ de: "2026-11-02", ate: "2026-11-08" });
    const estado = (foto) => Object.values(foto).flat().filter((r) => !r.removido).map(({ atualizadoEm, ...r }) => JSON.stringify(r)).sort().join("|");
    eq(await semanaSrv.rotaParaDesfazer(agora), null, "nada a desfazer antes de aceitar");

    // rota com merge e corrida movida
    let calc = await semanaSrv.recalcular(agora);
    const comMover = calc.rotas.find((r) => r.ops.some((o) => o.tipo === "juntar") && r.ops.some((o) => o.tipo === "mover"));
    assert(comMover, "há rota que junta e move");
    await semanaSrv.aceitarRota(comMover, agora);
    eq((await repo.listarMerges()).length, 1);
    assert((await repo.obterPlanned("run-qui")).dataOriginal, "corrida movida");
    assert(await semanaSrv.rotaParaDesfazer(agora), "agora dá para desfazer");
    eq((await semanaSrv.rotaParaDesfazer(agora)).mudancas.length, comMover.mudancas.length, "lista o que a rota mudou");

    await semanaSrv.desfazerRota(agora);
    const depois = await repo.fotografarSemana({ de: "2026-11-02", ate: "2026-11-08" });
    eq(estado(depois), estado(antes), "registros voltam ao que eram");
    eq((await repo.listarMerges()).length, 0, "o merge saiu");
    const sit = await semanaSrv.situacaoSemana(agora);
    assert(sit.aviso && sit.avaliacao.perdidas.length === 2, "os dois treinos voltam a ficar sem registro");
    eq(await semanaSrv.rotaParaDesfazer(agora), null, "só desfaz uma vez");
    eq((await repo.obterHistoricoSemana("2026-11-02")).escolhas.map((e) => e.tipo).join(), "rota,desfeita", "o histórico guarda as duas coisas");

    // depois de desfazer, a mesma rota pode ser aceita de novo
    calc = await semanaSrv.recalcular(agora);
    await semanaSrv.aceitarRota(calc.rotas[0], agora);
    eq((await semanaSrv.situacaoSemana(agora)).aviso, false);

    // marcou um treino depois de aceitar: não desfaz mais
    assert(await semanaSrv.rotaParaDesfazer(agora));
    await s.marcar(5, "Leve", "2026-11-06", "feito");
    eq(await semanaSrv.rotaParaDesfazer(agora), null, "a semana mudou");
    let lancou = false;
    try { await semanaSrv.desfazerRota(agora); } catch { lancou = true; }
    assert(lancou, "desfazer é recusado");

    // check-in não trava o desfazer
    const s2 = await prepararSemanaDeTeste();
    await semanaEmDiaAteQuarta(s2);
    await semanaSrv.aceitarRota((await semanaSrv.recalcular(agora)).rotas[0], agora);
    await semanaSrv.salvarCheckinDeHoje({ disposicao: 2 }, agora);
    assert(await semanaSrv.rotaParaDesfazer(agora), "check-in não muda treinos");

    // recuperar um ✕: desfazer devolve o ✕
    const s3 = await prepararSemanaDeTeste();
    const quarta = s3.quando(4, 8);
    await s3.marcar(1, "Upper A", "2026-11-02", "nao_feito");
    await s3.marcar(1, "Leve", "2026-11-02", "feito");
    await s3.marcar(2, "Intenso", "2026-11-03", "feito");
    const oferta = (await semanaSrv.recalcular(quarta)).rotas.find((r) => r.mudancas[0].startsWith("Mover Upper A"));
    await semanaSrv.aceitarRota(oferta, quarta);
    await semanaSrv.desfazerRota(quarta);
    const upper = (await repo.listarSessoes()).find((x) => x.scheduleItemId === s3.item(1, "Upper A").id);
    eq(upper.status, "nao_feito", "o ✕ voltou");
    const semanaFinal = await agenda.carregarSemana("2026-11-04");
    eq(semanaFinal.dias[0].entradas.some((e) => e.item && e.item.rotulo === "Upper A"), true, "o Upper A voltou para segunda");
  });

  await test("semana: dois treinos no mesmo período e horários fora da grade", async () => {
    const s = await prepararSemanaDeTeste();
    await semanaEmDiaAteQuarta(s);
    const agora = s.quando(5, 7);
    const semana = await agenda.carregarSemana("2026-11-05");
    const lowerA = semana.dias[3].entradas.find((e) => e.item && e.item.rotulo === "Lower A");
    await agenda.moverEntrada(lowerA, "2026-11-05", { data: "2026-11-06", periodo: "noite", ordem: 1 });
    const sit = await semanaSrv.situacaoSemana(agora);
    eq(sit.aviso, false, sit.avaliacao.motivo);
    eq(sit.semana.dias[4].entradas.filter((e) => e.periodo === "noite").length, 2, "Lower A e karatê juntos");

    const padrao = await semanaSrv.obterDisponibilidade();
    eq(padrao[5].manha, true, "a grade começa toda marcada");
    await semanaSrv.salvarDisponibilidade({ ...padrao, 5: { manha: false, noite: true } });
    eq((await semanaSrv.obterDisponibilidade())[5].manha, false);
  });

  await test("semana: ajuste à mão alerta sem bloquear; desfazer volta; manter vale mais que a regra", async () => {
    const s = await prepararSemanaDeTeste();
    await semanaEmDiaAteQuarta(s);
    const agora = s.quando(5, 7);
    await semanaSrv.situacaoSemana(agora);
    const SAB = { data: "2026-11-07", periodo: "noite", ordem: 0 };
    const lowerA = async () => (await agenda.carregarSemana("2026-11-05")).dias.flatMap((d) => d.entradas).find((e) => e.item && e.item.rotulo === "Lower A");
    const idLower = `item:${s.item(4, "Lower A").id}`;

    const alerta = await semanaSrv.moverComAlerta(await lowerA(), "2026-11-05", SAB, agora);
    assert(alerta && alerta.motivos.some((m) => m.includes("dias seguidos")), "Lower no sábado e no domingo");
    eq((await lowerA()).movimento.data, "2026-11-07", "o treino foi para onde foi mandado");
    assert((await semanaSrv.situacaoSemana(agora)).aviso, "sem decidir, o aviso continua");

    await semanaSrv.desfazerMudanca(alerta, agora);
    assert(!(await lowerA()).movimento, "desfazer devolve o treino");
    eq((await semanaSrv.situacaoSemana(agora)).aviso, false);

    const deNovo = await semanaSrv.moverComAlerta(await lowerA(), "2026-11-05", SAB, agora);
    await semanaSrv.manterMudanca(deNovo, agora);
    let sit = await semanaSrv.situacaoSemana(agora);
    eq(sit.aviso, false, sit.avaliacao.motivo);
    eq(sit.avaliacao.mantidas.length, 1, "a tela mostra o que foi mantido");
    eq((await repo.obterHistoricoSemana("2026-11-02")).escolhas.at(-1).tipo, "mantida", "fica no histórico");

    // No dia seguinte a corrida ficou sem registro: as rotas tratam dela, não do Lower mantido.
    const sexta = s.quando(6, 12, 47);
    const calc = await semanaSrv.recalcular(sexta);
    eq(calc.tipo, "rotas");
    assert(!calc.rotas.some((r) => r.ops.some((o) => (o.ids || [o.id]).includes(idLower) && o.tipo !== "naoFazer")), "o Lower mantido fica onde está");
    await semanaSrv.aceitarRota(calc.rotas[0], sexta);
    sit = await semanaSrv.situacaoSemana(sexta);
    eq(sit.aviso, false, sit.avaliacao.motivo);
    eq(sit.avaliacao.mantidas.length, 1, "aceitar uma rota não apaga a escolha");

    // Na semana seguinte a escolha já não vale, e outra semana não passa pelo motor.
    const segunda = new Date(2026, 10, 9, 7);
    eq((await semanaSrv.situacaoSemana(segunda)).estado.ctx.mantidas.regras.size, 0, "a escolha vale só para a semana");
    const proxima = (await agenda.carregarSemana("2026-11-19")).dias.flatMap((d) => d.entradas).find((e) => e.item && e.item.rotulo === "Lower A");
    eq(await semanaSrv.moverComAlerta(proxima, "2026-11-19", { data: "2026-11-21", periodo: "noite", ordem: 0 }, segunda), null);
  });

  await test("semana: ✕ que não tinha para onde ir não avisa depois, quando um horário fica livre", async () => {
    const s = await prepararSemanaDeTeste();
    await semanaEmDiaAteQuarta(s);
    await s.marcar(4, "Lower A", "2026-11-05", "feito");
    const agora = s.quando(6, 18);
    await repo.marcarStatusPlanned("run-qui", "nao_realizado");
    eq((await semanaSrv.situacaoSemana(agora)).aviso, false, "a corrida não tem para onde ir");

    const lowerB = (await agenda.carregarSemana("2026-11-06")).dias.flatMap((d) => d.entradas).find((e) => e.item && e.item.rotulo === "Lower B");
    await semanaSrv.manterMudanca(await semanaSrv.moverComAlerta(lowerB, "2026-11-08", { data: "2026-11-06", periodo: "noite", ordem: 0 }, agora), agora);
    eq((await semanaSrv.situacaoSemana(agora)).aviso, false, "o domingo de manhã abriu, mas o ✕ já tinha sido visto");
    assert((await semanaSrv.recalcular(agora)).rotas.some((r) => r.ops.some((o) => o.id === "run:run-qui")), "se pedir, Recalcular oferece recuperar");
  });

  await test("semana: Manter Atual desarma os alertas sem passar por Reorganizar; só algo novo arma de novo", async () => {
    const s = await prepararSemanaDeTeste();
    await semanaEmDiaAteQuarta(s);
    const agora = s.quando(6, 12, 47);
    await semanaSrv.situacaoSemana(agora);
    await s.marcar(3, "Upper B", "2026-11-04", "nao_feito");
    let sit = await semanaSrv.situacaoSemana(agora);
    assert(sit.aviso && sit.pendente, "treinos sem registro e ✕ novo");

    await semanaSrv.manterSemana(agora);
    sit = await semanaSrv.situacaoSemana(agora);
    eq(sit.aviso, false, sit.avaliacao.motivo);
    eq(sit.pendente, false, "o ✕ conta como visto");
    const mantidos = await semanaSrv.semRegistroMantido(agora);
    assert(mantidos.has(`item:${s.item(4, "Lower A").id}`), "o Hoje não cobra mais o Lower A");

    await s.marcar(5, "Leve", "2026-11-06", "feito");
    eq((await semanaSrv.situacaoSemana(agora)).aviso, false, "marcar treino sem problema novo não arma");
    await s.marcar(3, "Leve", "2026-11-04", "nao_feito");
    eq((await semanaSrv.situacaoSemana(agora)).aviso, false, "karatê leve não arma");
    await s.marcar(1, "Upper A", "2026-11-02", "nao_feito");
    assert((await semanaSrv.situacaoSemana(agora)).aviso, "✕ novo em treino importante arma");
  });

  await test("semana: Manter Atual depois de ver as opções também cala o aviso e não apaga o sem registro", async () => {
    const s = await prepararSemanaDeTeste();
    await semanaEmDiaAteQuarta(s);
    const agora = s.quando(6, 12, 47);
    assert((await semanaSrv.situacaoSemana(agora)).aviso, "corrida e Lower A de quinta sem registro");
    await semanaSrv.recalcular(agora);
    await semanaSrv.manterSemana(agora);
    const sit = await semanaSrv.situacaoSemana(agora);
    eq(sit.aviso, false);
    eq(sit.avaliacao.perdidas.length, 2, "continuam para marcar");
    eq((await semanaSrv.recalcular(agora)).tipo, "rotas", "Recalcular ainda sugere, se pedir");
    await s.marcar(5, "Leve", "2026-11-06", "nao_feito");
    eq((await semanaSrv.situacaoSemana(agora)).aviso, false, "karatê leve não traz o aviso de volta");
    await s.marcar(3, "Upper B", "2026-11-04", "nao_feito");
    assert((await semanaSrv.situacaoSemana(agora)).aviso, "um ✕ novo importante traz");
  });

  await reset();
  return { ok, fail, total: ok + fail };
}
