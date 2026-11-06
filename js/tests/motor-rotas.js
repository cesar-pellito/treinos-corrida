// motor-rotas.js (testes) — cenários do motor de rotas. Verificam PROPRIEDADES do
// resultado, não uma rota exata. Não tocam no banco: rodam em test.html, junto com
// nucleo.js. `reportar(nome, ok, msg)` é injetado por quem chama.

import { AGENDA_PADRAO } from "../data/seed-hub.js";
import { METAS_PADRAO } from "../services/metas.js";
import { resumirSemana } from "../services/agenda.js";
import { avaliar, calcularOfertas, calcularRotas, fixosDe, impactoDaMudanca, montarEstado, slotPassou, xQuePedemAtencao } from "../services/motor-rotas.js";

const SEG = "2026-11-02", TER = "2026-11-03", QUA = "2026-11-04", QUI = "2026-11-05", SEX = "2026-11-06", SAB = "2026-11-07", DOM = "2026-11-08";
const CORRIDA_QUI = { id: "qui", dataPlanejada: QUI, status: "futuro", titulo: "Corrida curta", duracaoMin: 25 };
const CORRIDA_SAB = { id: "sab", dataPlanejada: SAB, status: "futuro", titulo: "Corrida Z2", duracaoMin: 40 };

const DIA_DA_DATA = { [SEG]: 1, [TER]: 2, [QUA]: 3, [QUI]: 4, [SEX]: 5, [SAB]: 6, [DOM]: 0 };
const itemDe = (data, rotulo, agenda = AGENDA_PADRAO) => agenda.find((i) => i.diaSemana === DIA_DA_DATA[data] && i.rotulo === rotulo);
const log = (data, rotulo, status, agenda = AGENDA_PADRAO) => {
  const item = itemDe(data, rotulo, agenda);
  return { id: `${data}-${rotulo}`, data, scheduleItemId: item.id, tipo: item.tipo, rotulo: item.rotulo, periodo: item.periodo, status };
};

function montar({ agora, logs = [], corridas = [CORRIDA_QUI, CORRIDA_SAB], agenda = AGENDA_PADRAO, movimentos = [], merges = [], ...resto }) {
  const semana = resumirSemana({ agenda, sessoes: logs, corridas, movimentos, merges, inicio: SEG, metas: METAS_PADRAO });
  return montarEstado({ semana, agora, ...resto });
}
const quando = (data, hora, minuto = 0) => {
  const [a, m, d] = data.split("-").map(Number);
  return new Date(a, m - 1, d, hora, minuto);
};
const ativas = (final) => final.filter((s) => s.status === "feito" || s.status === "pendente");

export function rodarTestesMotor(reportar) {
  let ok = 0, fail = 0;
  const test = (nome, fn) => {
    try { fn(); reportar(nome, true); ok++; }
    catch (e) { reportar(nome, false, e && e.message); fail++; }
  };
  const assert = (c, m) => { if (!c) throw new Error(m || "assert falhou"); };
  const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || ""} — esperado ${JSON.stringify(b)}, obtido ${JSON.stringify(a)}`); };

  // Toda rota, depois de aceita, tem de devolver "segue como está".
  const resolveASemana = (estado, rotas) => {
    for (const r of rotas) {
      const depois = avaliar({ ctx: estado.ctx, sessoes: r.final });
      assert(!depois.fora, `"${r.mudancas.join(" + ")}" ainda fica fora: ${depois.motivo}`);
    }
  };

  // -------------------------------------------------------------------------
  // Os 7 cenários da especificação
  // -------------------------------------------------------------------------
  test("cenário 1: semana em dia devolve 'segue como está' e não há aviso", () => {
    const e = montar({ agora: quando(TER, 10), logs: [log(SEG, "Upper A", "feito"), log(SEG, "Leve", "feito")] });
    const a = avaliar(e);
    eq(a.fora, false, a.motivo);
    eq(a.perdidas.length, 0);
    eq(calcularOfertas(e).temOferta, false, "nada a oferecer");
  });

  test("cenário 2: o caso real desta semana respeita as regras em toda rota", () => {
    const e = montar({
      agora: quando(SEX, 12, 47), checkin: { disposicao: 5 },
      logs: [log(SEG, "Upper A", "feito"), log(SEG, "Leve", "nao_feito"), log(TER, "Intenso", "feito"), log(QUA, "Upper B", "feito"), log(QUA, "Leve", "feito")],
    });
    const a = avaliar(e);
    eq(a.perdidas.length, 2, "corrida e Lower A de quinta");
    const r = calcularRotas(e);
    eq(r.tipo, "rotas");
    assert(r.rotas.length >= 1 && r.rotas.length <= 3, "de 1 a 3 rotas");
    assert(r.rotas.every((x) => x.mudancas.length <= 3 && x.motivo), "até 3 mudanças e com motivo");
    for (const x of r.rotas) {
      const mexidas = x.ops.flatMap((o) => o.ids || [o.id]);
      eq(new Set(mexidas).size, mexidas.length, `"${x.mudancas.join(" + ")}" mexe duas vezes na mesma sessão`);
      for (const y of r.rotas) {
        if (x === y) continue;
        const contem = y.mudancas.length < x.mudancas.length && y.mudancas.every((m) => x.mudancas.includes(m));
        assert(!contem, `"${x.mudancas.join(" + ")}" tem mudança sobrando`);
      }
    }
    resolveASemana(e, r.rotas);
    for (const rota of r.rotas) {
      const final = ativas(rota.final);
      for (const dia of [SEG, TER, QUA, QUI, SEX, SAB, DOM]) {
        const doDia = final.filter((s) => s.data === dia);
        assert(!(doDia.some((s) => s.cat === "corrida") && doDia.some((s) => s.cat === "leve" || s.cat === "intenso")), `karatê e corrida em ${dia}`);
        assert(doDia.filter((s) => s.cat === "corrida").length <= 1, `duas corridas em ${dia}`);
      }
      const lowerSab = final.filter((s) => s.cat === "lower" && s.data === SAB);
      const lowerDom = final.filter((s) => s.cat === "lower" && s.data === DOM);
      assert(!(lowerSab.length && lowerDom.length), "Lower no sábado e no domingo");
      assert(final.some((s) => s.cat === "lower"), "mantém pelo menos 1 Lower");
      assert(!final.some((s) => s.data === SEX && s.periodo === "manha"), "a manhã de sexta já passou");
    }
    assert(r.descartadas.length > 0 && r.descartadas.length <= 3, "até 3 ideias descartadas");
    assert(r.descartadas.every((d) => d.includes(":")), "cada ideia diz a regra que quebra");
  });

  test("cenário 3: fáscia doendo no sábado: a corrida só aparece encurtada ou não feita", () => {
    const e = montar({
      agora: quando(SAB, 7, 30), checkin: { fascia: true },
      corridas: [{ ...CORRIDA_QUI, status: "concluido" }, CORRIDA_SAB],
      logs: [log(SEG, "Upper A", "feito"), log(SEG, "Leve", "feito"), log(TER, "Intenso", "feito"), log(QUA, "Upper B", "feito"), log(QUA, "Leve", "feito"), log(QUI, "Lower A", "feito")],
    });
    assert(avaliar(e).fora, "a corrida de hoje sai do plano");
    const r = calcularRotas(e);
    eq(r.tipo, "rotas");
    assert(r.rotas.length >= 2, "encurtar e não fazer");
    resolveASemana(e, r.rotas);
    for (const rota of r.rotas) {
      const c = rota.final.find((s) => s.id === "run:sab");
      eq(c.data, SAB, "não vai para outro dia");
      assert(c.encurtada || c.status === "nao_feito", "encurtada ou não feita");
    }
    assert(r.descartadas.some((d) => d.includes("fáscia")), "explica por que não vai para outro dia");
    assert(!r.rotas.some((x) => x.mudancas.join().includes("10")), "sem sugestão de tempo");
  });

  test("cenário 4: semana quase perdida: junta Upper e Lower se couber; senão, semana comprometida", () => {
    const domingo = calcularRotas(montar({ agora: quando(DOM, 8) }));
    eq(domingo.tipo, "comprometida", "domingo cedo só resta a manhã: a tarde de domingo não é sugerida");
    eq(domingo.rotas.length, 0, "não cabem Upper e Lower");

    const e = montar({ agora: quando(SAB, 8) });
    const r = calcularRotas(e);
    eq(r.tipo, "comprometida", "há mais perdidas do que mudanças");
    eq(r.rotas.length, 1, "a rota do piso existe");
    const rota = r.rotas[0];
    eq(rota.ops.filter((o) => o.tipo === "juntar").length, 2, "dois merges");
    eq(new Set(rota.ops.map((o) => `${o.data}|${o.periodo}`)).size, 2, "um em cada slot");
    assert(rota.fechar.length > 0, "o resto vira não feito ao aceitar");
    assert(!avaliar({ ctx: e.ctx, sessoes: rota.final }).fora, "depois de aceitar, segue como está");
  });

  test("cenário 5: karatê intenso perdido só pode ficar como não feito", () => {
    const e = montar({
      agora: quando(QUA, 8),
      logs: [log(SEG, "Upper A", "feito"), log(SEG, "Leve", "feito")],
    });
    const r = calcularRotas(e);
    eq(r.tipo, "rotas");
    resolveASemana(e, r.rotas);
    const id = `item:${itemDe(TER, "Intenso").id}`;
    for (const rota of r.rotas) {
      assert(!rota.ops.some((o) => o.tipo === "mover" && o.id === id), "não pode ser movido");
      assert(rota.ops.some((o) => o.tipo === "naoFazer" && o.id === id), "fica como não feito");
    }
  });

  test("cenário 6: com a quarta à noite bloqueada, o karatê leve pode ir para a sexta à noite", () => {
    const agenda = AGENDA_PADRAO.filter((i) => !(i.diaSemana === 5 && i.tipo === "karate"));
    const e = montar({
      agenda, agora: quando(QUA, 7),
      excecoes: [{ data: QUA, bloqueio: "noite", feriado: false }],
      logs: [log(SEG, "Upper A", "feito", agenda), log(SEG, "Leve", "feito", agenda), log(TER, "Intenso", "feito", agenda)],
    });
    assert(avaliar(e).fora, "karatê num slot com 'não posso'");
    const r = calcularRotas(e);
    const id = `item:${itemDe(QUA, "Leve", agenda).id}`;
    assert(r.rotas.some((x) => x.ops.some((o) => o.tipo === "mover" && o.id === id && o.data === SEX && o.periodo === "noite")), "vai para a sexta à noite");
    resolveASemana(e, r.rotas);
    const comSextaOcupada = montar({
      agora: quando(QUA, 7),
      excecoes: [{ data: QUA, bloqueio: "noite", feriado: false }],
      logs: [log(SEG, "Upper A", "feito"), log(SEG, "Leve", "feito"), log(TER, "Intenso", "feito")],
    });
    const idPadrao = `item:${itemDe(QUA, "Leve").id}`;
    assert(!calcularRotas(comSextaOcupada).rotas.some((x) => x.ops.length === 1 && x.ops[0].tipo === "mover" && x.ops[0].id === idPadrao), "com a sexta ocupada, só move se o karatê de sexta sair");
  });

  test("cenário 7: quinta com feriado usa as janelas de fim de semana", () => {
    const base = { logs: [log(SEG, "Upper A", "feito"), log(SEG, "Leve", "feito"), log(TER, "Intenso", "feito"), log(QUA, "Upper B", "feito"), log(QUA, "Leve", "feito")] };
    const semFeriado = montar({ ...base, agora: quando(QUI, 10) });
    eq(avaliar(semFeriado).perdidas.length, 1, "dia útil: às 10h a manhã já passou");
    const comFeriado = montar({ ...base, agora: quando(QUI, 10), excecoes: [{ data: QUI, bloqueio: null, feriado: true }] });
    eq(avaliar(comFeriado).perdidas.length, 0, "feriado: a manhã vai até 13h");
    assert(!slotPassou(comFeriado.ctx, QUI, "manha"));
    const aTarde = montar({ ...base, agora: quando(QUI, 13), excecoes: [{ data: QUI, bloqueio: null, feriado: true }] });
    eq(avaliar(aTarde).perdidas.length, 1, "feriado: às 13h a manhã passou");
  });

  // -------------------------------------------------------------------------
  // Decisões tomadas no protótipo
  // -------------------------------------------------------------------------
  test("karatê opcional pendente não conta no limite de 3 e perdê-lo não gera aviso", () => {
    const e = montar({ agora: quando(SEX, 23), corridas: [], logs: [log(SEG, "Upper A", "feito"), log(SEG, "Leve", "feito"), log(TER, "Intenso", "feito"), log(QUA, "Upper B", "feito"), log(QUA, "Leve", "feito"), log(QUI, "Lower A", "feito")] });
    const a = avaliar(e);
    eq(a.fora, false, a.motivo);
    eq(e.sessoes.find((s) => s.opcional).status, "passou");
    const hoje = montar({ agora: quando(SEG, 7), corridas: [] });
    assert(!avaliar(hoje).violacoes.some((v) => v.k === "karate-limite"), "4 aulas na agenda não quebram a regra");
  });

  test("treino com ✕ fica como está, salvo com o piso de musculação quebrado", () => {
    const umLower = montar({ agora: quando(SAB, 7), corridas: [], logs: [log(QUI, "Lower A", "nao_feito"), log(SEG, "Upper A", "feito")] });
    assert(!avaliar(umLower).violacoes.some((v) => v.k.startsWith("piso")), "Lower B garante o piso");

    const doisLower = montar({ agora: quando(SAB, 13, 30), corridas: [], logs: [log(SEG, "Upper A", "feito"), log(SEG, "Leve", "feito"), log(TER, "Intenso", "feito"), log(QUA, "Upper B", "feito"), log(QUA, "Leve", "feito"), log(QUI, "Lower A", "nao_feito"), log(DOM, "Lower B", "nao_feito")] });
    const a = avaliar(doisLower);
    assert(a.violacoes.some((v) => v.k === "piso:lower"), "piso quebrado");
    const r = calcularRotas(doisLower);
    eq(r.tipo, "rotas");
    assert(r.rotas.length >= 2, "mover um Lower ou juntar os dois");
    assert(r.rotas.every((x) => x.ops.every((o) => o.reabrir)), "reabre o ✕");
    resolveASemana(doisLower, r.rotas);
  });

  test("domingo à tarde nunca é sugerido, mas um treino colocado lá à mão não gera aviso", () => {
    const logs = [log(SEG, "Upper A", "feito"), log(SEG, "Leve", "feito"), log(TER, "Intenso", "feito"), log(QUA, "Upper B", "feito"), log(QUA, "Leve", "feito")];
    const naTardeDeDomingo = (o) => o.data === DOM && o.periodo === "noite";
    const sexta = montar({ agora: quando(SEX, 12, 47), logs });
    assert(!calcularRotas(sexta).rotas.some((r) => r.ops.some(naTardeDeDomingo)), "nem mover, nem juntar");

    const sabado = montar({ agora: quando(SAB, 8), logs: [...logs, log(QUI, "Lower A", "nao_feito")], corridas: [] });
    assert(!calcularOfertas(sabado).rotas.some((r) => r.ops.some(naTardeDeDomingo)), "nem nas ofertas de recuperar ✕");

    const tarde = montar({
      agora: quando(DOM, 8), corridas: [],
      movimentos: [{ scheduleItemId: itemDe(DOM, "Lower B").id, dataOrigem: DOM, data: DOM, periodo: "noite", ordem: 0 }],
      logs: [...logs, log(QUI, "Lower A", "feito")],
    });
    eq(avaliar(tarde).fora, false, "o treino que você colocou ali continua valendo");

    const domingoTarde = montar({ agora: quando(DOM, 13, 30), corridas: [], logs: [...logs, log(QUI, "Lower A", "nao_feito"), log(DOM, "Lower B", "nao_feito")] });
    const r = calcularRotas(domingoTarde);
    eq(r.tipo, "comprometida", "sem nenhum Lower e só a tarde de domingo livre");
    eq(r.rotas.length, 0);
  });

  test("recalcular com ✕ oferece recuperar, com 'manter' como alternativa; decididos não voltam", () => {
    const logs = [log(SEG, "Upper A", "nao_feito"), log(SEG, "Leve", "nao_feito"), log(TER, "Intenso", "nao_feito")];
    const e = montar({ agora: quando(QUA, 8), logs });
    eq(avaliar(e).fora, false, "✕ não deixa treino sem registro");
    const o = calcularOfertas(e);
    assert(o.temOferta);
    assert(o.rotas.some((r) => r.mudancas[0] === "Mover Upper A para sexta de manhã"), `oferece mover: ${o.rotas.map((r) => r.mudancas[0])}`);
    const idIntenso = `item:${itemDe(TER, "Intenso").id}`;
    assert(!o.rotas.some((r) => r.ops.some((x) => x.id === idIntenso)), "o intenso não muda de dia");
    assert(o.ficamComoEstao.includes("Upper A fica como não feito."));
    const idUpper = `item:${itemDe(SEG, "Upper A").id}`;
    const jaDecidido = montar({ agora: quando(QUA, 8), logs, decididos: [idUpper] });
    assert(!calcularOfertas(jaDecidido).rotas.some((r) => r.ops.some((x) => (x.ids || [x.id]).includes(idUpper))), "treino decidido numa rota não volta");
  });

  test("check-in: dor e disposição não geram aviso, mas oferecem alternativas e pesam no custo", () => {
    const logs = [log(SEG, "Upper A", "feito"), log(SEG, "Leve", "feito"), log(TER, "Intenso", "feito"), log(QUA, "Upper B", "feito"), log(QUA, "Leve", "feito")];
    const hoje = (checkin) => montar({ agora: quando(QUI, 7), logs, checkin });
    eq(avaliar(hoje({ dorLower: true })).fora, false, "sem aviso");
    const dor = calcularOfertas(hoje({ dorLower: true }));
    assert(dor.pesos.length === 1 && dor.pesos[0].texto.includes("dor em Lower"));
    assert(dor.rotas.length > 0, "alternativas para o Lower A");
    assert(dor.rotas.every((r) => !r.final.some((s) => s.cat === "lower" && s.data === QUI && s.status === "pendente")), "todas tiram o Lower de hoje");
    eq(calcularOfertas(hoje({ dorUpper: true })).temOferta, false, "hoje não tem Upper");
    eq(calcularOfertas(hoje({ disposicao: 3 })).temOferta, false, "disposição 3 não pesa");
    eq(calcularOfertas(hoje({ disposicao: 4 })).temOferta, false, "disposição 4 não pesa");
    const cansado = calcularOfertas(hoje({ disposicao: 2 }));
    eq(cansado.pesos.length, 2, "Lower com disposição baixa e dois treinos hoje");
    assert(avaliar(hoje({ fascia: true })).fora, "fáscia gera aviso sozinha");
  });

  test("dois treinos no mesmo período são permitidos; o limite é de 2 por dia", () => {
    const movimentos = [{ scheduleItemId: itemDe(QUI, "Lower A").id, dataOrigem: QUI, data: SEX, periodo: "noite", ordem: 0 }];
    const e = montar({ agora: quando(QUI, 7), corridas: [CORRIDA_QUI, CORRIDA_SAB], movimentos, logs: [log(SEG, "Upper A", "feito"), log(SEG, "Leve", "feito"), log(TER, "Intenso", "feito"), log(QUA, "Upper B", "feito"), log(QUA, "Leve", "feito")] });
    const a = avaliar(e);
    eq(a.fora, false, a.motivo);
    const noPeriodo = e.sessoes.filter((s) => s.data === SEX && s.periodo === "noite");
    eq(noPeriodo.length, 2, "Lower A e karatê juntos");

    const tres = montar({ agora: quando(QUI, 7), corridas: [CORRIDA_QUI], movimentos: [{ scheduleItemId: itemDe(DOM, "Lower B").id, dataOrigem: DOM, data: QUI, periodo: "manha", ordem: 1 }, { scheduleItemId: itemDe(QUA, "Upper B").id, dataOrigem: QUA, data: QUI, periodo: "noite", ordem: 1 }], logs: [log(SEG, "Upper A", "feito"), log(SEG, "Leve", "feito"), log(TER, "Intenso", "feito")] });
    assert(avaliar(tres).violacoes.some((v) => v.k.startsWith("dia-limite")), "o terceiro no dia gera aviso");
  });

  test("regra quebrada pelo usuário oferece voltar ao lugar original", () => {
    const corrida = { ...CORRIDA_QUI, dataPlanejada: SEX, dataOriginal: QUI, status: "reagendado", periodo: "manha" };
    const e = montar({ agora: quando(QUI, 7), corridas: [corrida, CORRIDA_SAB], logs: [log(SEG, "Upper A", "feito"), log(SEG, "Leve", "feito"), log(TER, "Intenso", "feito"), log(QUA, "Upper B", "feito"), log(QUA, "Leve", "feito")] });
    assert(avaliar(e).motivo.includes("Karatê e corrida"), "mesmo dia de impacto");
    const r = calcularRotas(e);
    eq(r.tipo, "rotas");
    assert(r.rotas.some((x) => x.mudancas[0].startsWith("Voltar a corrida")), r.rotas.map((x) => x.mudancas).join(";"));
    resolveASemana(e, r.rotas);
  });

  test("regra entre sessões já feitas não descarta a semana", () => {
    const e = montar({
      agora: quando(SAB, 7), corridas: [{ ...CORRIDA_QUI, dataPlanejada: SEG, status: "concluido" }, CORRIDA_SAB],
      logs: [log(SEG, "Upper A", "feito"), log(SEG, "Leve", "feito"), log(TER, "Intenso", "feito"), log(QUA, "Upper B", "feito"), log(QUA, "Leve", "feito"), log(QUI, "Lower A", "feito")],
    });
    eq(avaliar(e).fora, false, avaliar(e).motivo);
  });

  test("horário fora da grade e 'não posso' não aparecem como destino", () => {
    const disponibilidade = { 0: { manha: true, noite: false }, 1: { manha: true, noite: true }, 2: { manha: true, noite: true }, 3: { manha: true, noite: true }, 4: { manha: true, noite: true }, 5: { manha: false, noite: true }, 6: { manha: true, noite: false } };
    const e = montar({ agora: quando(QUI, 10), disponibilidade, logs: [log(SEG, "Upper A", "feito"), log(SEG, "Leve", "feito"), log(TER, "Intenso", "feito"), log(QUA, "Upper B", "feito"), log(QUA, "Leve", "feito")] });
    const r = calcularRotas(e);
    const destinos = r.rotas.flatMap((x) => x.ops.filter((o) => o.tipo === "mover"));
    assert(!destinos.some((o) => (o.data === SEX && o.periodo === "manha") || (o.data === SAB && o.periodo === "noite") || (o.data === DOM && o.periodo === "noite")), "só slots marcados na grade");
    resolveASemana(e, r.rotas);
  });

  // -------------------------------------------------------------------------
  // Mínimo para o aviso aparecer sozinho
  // -------------------------------------------------------------------------
  const emDiaAteQuarta = [log(SEG, "Upper A", "feito"), log(SEG, "Leve", "feito"), log(TER, "Intenso", "feito"), log(QUA, "Upper B", "feito"), log(QUA, "Leve", "feito")];

  test("aviso: treino de hoje sem registro só avisa depois que o dia termina", () => {
    const hoje = avaliar(montar({ agora: quando(QUI, 10), logs: emDiaAteQuarta }));
    eq(hoje.perdidas.length, 1, "a corrida de quinta já passou");
    eq(hoje.fora, true, "Recalcular ainda busca rotas");
    eq(hoje.aciona, false, "mas o aviso não aparece sozinho");
    eq(avaliar(montar({ agora: quando(SEX, 8), logs: emDiaAteQuarta })).aciona, true, "no dia seguinte, avisa");
  });

  test("aviso: karatê leve perdido e treino sem para onde ir não avisam sozinhos", () => {
    const leve = avaliar(montar({ agora: quando(TER, 8), logs: [log(SEG, "Upper A", "feito")] }));
    eq(leve.perdidas.length, 1);
    eq(leve.aciona, false, "karatê leve está abaixo do mínimo");
    const intenso = avaliar(montar({ agora: quando(QUA, 8), logs: [log(SEG, "Upper A", "feito"), log(SEG, "Leve", "feito")] }));
    eq(intenso.perdidas.length, 1);
    eq(intenso.aciona, false, "o intenso só acontece na terça");
  });

  test("aviso: ✕ só pede atenção em treino importante e com para onde ir", () => {
    const idUpper = `item:${itemDe(SEG, "Upper A").id}`;
    const idLeve = `item:${itemDe(SEG, "Leve").id}`;
    const logs = [log(SEG, "Upper A", "nao_feito"), log(SEG, "Leve", "nao_feito"), log(TER, "Intenso", "feito")];
    const quarta = montar({ agora: quando(QUA, 8), logs });
    eq(xQuePedemAtencao(quarta, [idUpper, idLeve]).join(), idUpper, "Upper dá para recuperar; karatê leve não avisa");
    eq(xQuePedemAtencao(montar({ agora: quando(DOM, 21), logs }), [idUpper]).length, 0, "domingo à noite não há horário");
  });

  // -------------------------------------------------------------------------
  // A escolha do usuário vale mais que as regras
  // -------------------------------------------------------------------------
  const corridaNaSexta = { ...CORRIDA_QUI, dataPlanejada: SEX, dataOriginal: QUI, status: "reagendado", periodo: "manha" };
  const comCorridaNaSexta = (extras = {}) => montar({ agora: quando(QUI, 7), corridas: [corridaNaSexta, CORRIDA_SAB], logs: emDiaAteQuarta, ...extras });

  test("escolha mantida: a regra aceita não avisa, mas outro problema avisa", () => {
    const a = avaliar(comCorridaNaSexta({ mantidas: { regras: [`impacto:${SEX}`] } }));
    eq(a.fora, false, a.motivo);
    eq(a.aciona, false);
    eq(a.mantidas.length, 1, "a tela mostra o que foi mantido");
    eq(avaliar(comCorridaNaSexta({ mantidas: { regras: [`impacto:${SEG}`] } })).aciona, true, "aceitar outro dia não cala este");
  });

  test("escolha mantida: as rotas não movem o treino fixo enquanto ele continuar no mesmo slot", () => {
    const moveACorrida = (r) => r.ops.some((o) => o.tipo === "mover" && o.id === "run:qui");
    assert(calcularRotas(comCorridaNaSexta()).rotas.some(moveACorrida), "sem escolha, oferece voltar");
    const fixos = fixosDe(comCorridaNaSexta().sessoes, ["run:qui"]);
    assert(!calcularRotas(comCorridaNaSexta({ mantidas: { fixos } })).rotas.some(moveACorrida), "fixa, fica onde está");
    assert(calcularRotas(comCorridaNaSexta({ mantidas: { fixos: [`run:qui|${SEG}|manha`] } })).rotas.some(moveACorrida), "fixa em outro slot não conta");
  });

  test("escolha mantida: a dor na fáscia aceita vale só para aquele dia", () => {
    const k = `fascia:run:sab:${SAB}`;
    const concluida = { ...CORRIDA_QUI, status: "concluido" };
    const sabado = avaliar(montar({ agora: quando(SAB, 7, 30), checkin: { fascia: true }, corridas: [concluida, CORRIDA_SAB], logs: emDiaAteQuarta, mantidas: { regras: [k] } }));
    assert(!sabado.violacoes.some((v) => v.k.startsWith("fascia")), "no dia, não avisa");
    const noDomingo = { ...CORRIDA_SAB, dataPlanejada: DOM, periodo: "noite" };
    const domingo = avaliar(montar({ agora: quando(DOM, 7), checkin: { fascia: true }, corridas: [concluida, noDomingo], logs: emDiaAteQuarta, mantidas: { regras: [k] } }));
    assert(domingo.violacoes.some((v) => v.k.startsWith("fascia")), "no dia seguinte, avisa de novo");
  });

  test("alerta do ajuste à mão: regra nova sempre; penalidade só a partir do mínimo", () => {
    const moverLowerA = (data, periodo) => [{ scheduleItemId: itemDe(QUI, "Lower A").id, dataOrigem: QUI, data, periodo, ordem: 0 }];
    const base = { agora: quando(SEG, 6) };

    const regra = impactoDaMudanca(montar(base), montar({ ...base, movimentos: moverLowerA(TER, "manha") }));
    assert(regra && regra.regras.length === 1, "Lower no dia do intenso");
    assert(regra.motivos.some((m) => m.includes("dia do karatê intenso")), regra && regra.motivos.join());

    const penalidade = impactoDaMudanca(montar(base), montar({ ...base, movimentos: moverLowerA(SEX, "manha") }));
    assert(penalidade && penalidade.regras.length === 0, "sem regra quebrada");
    assert(penalidade.motivos.includes("Esta mudança deixa Lower na véspera de corrida."), penalidade.motivos.join());

    const agenda = AGENDA_PADRAO.filter((i) => !(i.diaSemana === 1 && i.rotulo === "Upper A") && !(i.diaSemana === 3 && i.rotulo === "Leve"));
    const dia = { ...base, agenda };
    const movimentos = [{ scheduleItemId: itemDe(QUA, "Upper B", agenda).id, dataOrigem: QUA, data: TER, periodo: "manha", ordem: 0 }];
    eq(impactoDaMudanca(montar(dia), montar({ ...dia, movimentos })), null, "dia com dois treinos (5 pontos) não alerta");
  });

  return { total: ok + fail, ok, fail };
}
