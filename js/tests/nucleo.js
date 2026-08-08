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
import { apagarDB } from "../data/db.js";
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

  await reset();
  return { ok, fail, total: ok + fail };
}
