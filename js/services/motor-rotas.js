// motor-rotas.js — motor de rotas da semana. Funções puras: recebe o estado e
// devolve resultados. Sem DOM e sem banco; quem lê e grava é services/semana.js.
//
// O motor só SUGERE. Nada muda no plano sem o usuário aceitar uma rota.
//
// Vocabulário:
//   - slot: dia + período ("manha" ou "noite"; no fim de semana e no feriado,
//     "noite" é a tarde/noite)
//   - sessão: um treino da semana, com status feito, nao_feito, pendente, perdida
//     (slot passou sem registro) ou passou (opcional cujo slot passou)
//   - rota: até 3 mudanças que resolvem a semana
//
// Dois treinos no mesmo período são permitidos quando o usuário arruma assim; o
// motor, por conta própria, só usa slots livres. O limite é de 2 treinos por dia.

import {
  CATALOGO, CHECKIN, CUSTOS, DISPONIBILIDADE_PADRAO, FIM_DO_SLOT, HORA_DE_REFERENCIA,
  LIMITES, NOITES_DE_KARATE, PARES_PARA_JUNTAR, PENALIDADES,
} from "../data/rotas-config.js";
import { diaDaSemana, diffDias, nomeDiaSemana, paraISODate, somarDias } from "./dates.js";
import { corridaFeita } from "./dominio.js";
import { ehLower, ehUpper, statusDaSessao } from "./agenda.js";
import { validarMerge } from "./merge.js";

const PERIODOS = ["manha", "noite"];
const ATIVOS = ["feito", "pendente"];
const ehAtiva = (s) => ATIVOS.includes(s.status);
const ehAberta = (s) => s.status !== "feito";

// ---------------------------------------------------------------------------
// Tempo e slots
// ---------------------------------------------------------------------------

export function ehFolga(ctx, data) {
  const dia = diaDaSemana(data);
  return dia === 0 || dia === 6 || !!(ctx.excecoes[data] && ctx.excecoes[data].feriado);
}

/** O slot já terminou em relação ao "agora" do estado? */
export function slotPassou(ctx, data, periodo) {
  if (data !== ctx.hoje) return data < ctx.hoje;
  const fim = periodo === "noite" ? FIM_DO_SLOT.noite : ehFolga(ctx, data) ? FIM_DO_SLOT.manhaFolga : FIM_DO_SLOT.manhaDiaUtil;
  return ctx.minutos >= fim;
}

function slotBloqueado(ctx, data, periodo) {
  const bloqueio = ctx.excecoes[data] && ctx.excecoes[data].bloqueio;
  return bloqueio === "dia" || bloqueio === periodo;
}

function slotNaGrade(ctx, data, periodo) {
  const dia = ctx.disponibilidade[diaDaSemana(data)];
  return !dia || dia[periodo] !== false;
}

function slotsLivres(sessoes, ctx) {
  const ocupados = new Set(sessoes.filter((s) => ehAtiva(s) || s.status === "perdida").map((s) => `${s.data}|${s.periodo}`));
  const livres = [];
  for (let i = 0; i < 7; i++) {
    const data = somarDias(ctx.inicio, i);
    for (const periodo of PERIODOS) {
      if (slotPassou(ctx, data, periodo) || slotBloqueado(ctx, data, periodo) || !slotNaGrade(ctx, data, periodo)) continue;
      if (!ocupados.has(`${data}|${periodo}`)) livres.push({ data, periodo });
    }
  }
  return livres;
}

function horaDeReferencia(ctx, s) {
  const folga = ehFolga(ctx, s.data);
  const minutos = s.periodo === "manha"
    ? (folga ? HORA_DE_REFERENCIA.manhaFolga : HORA_DE_REFERENCIA.manhaDiaUtil)
    : (folga ? HORA_DE_REFERENCIA.tardeFolga : HORA_DE_REFERENCIA.noiteDiaUtil);
  return diffDias(ctx.inicio, s.data) * 24 * 60 + minutos;
}

// ---------------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------------

const periodoEmTexto = (ctx, data, periodo) => (periodo === "manha" ? "de manhã" : ehFolga(ctx, data) ? "à tarde" : "à noite");
const nomeDoDia = (ctx, data) => (data === ctx.hoje ? "hoje" : nomeDiaSemana(data));
const noDia = (ctx, data) => {
  if (data === ctx.hoje) return "hoje";
  const nome = nomeDiaSemana(data);
  return (nome === "sábado" || nome === "domingo" ? "no " : "na ") + nome;
};
const paraSlot = (ctx, data, periodo) => `${nomeDoDia(ctx, data)} ${periodoEmTexto(ctx, data, periodo)}`;
const noSlot = (ctx, data, periodo) => `${noDia(ctx, data)} ${periodoEmTexto(ctx, data, periodo)}`;

/** "Upper A", "a corrida de quinta", "o karatê leve de segunda". */
function nomeDaSessao(ctx, s) {
  if (s.cat === "corrida") return `a corrida de ${nomeDoDia(ctx, s.data)}`;
  if (s.cat === "intenso") return `o karatê intenso de ${nomeDoDia(ctx, s.data)}`;
  if (s.cat === "leve") return `o karatê de ${nomeDoDia(ctx, s.data)}`;
  return s.rotulo;
}
const rotuloCurto = (s) => (s.cat === "lower" || s.cat === "upper" || s.cat === "outro" ? s.rotulo : CATALOGO[s.cat].nome);
/** "a corrida" vira "da corrida"; "Upper A" vira "de Upper A". */
const comDe = (nome) => (nome.startsWith("a ") ? `da ${nome.slice(2)}` : nome.startsWith("o ") ? `do ${nome.slice(2)}` : `de ${nome}`);

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

function categoria(tipo, rotulo) {
  if (tipo === "corrida") return "corrida";
  if (tipo === "karate") return /intens/i.test(String(rotulo || "")) ? "intenso" : "leve";
  if (ehLower(rotulo)) return "lower";
  return ehUpper(rotulo) ? "upper" : "outro";
}

/** Status do motor a partir do status do app e do horário. */
function statusNoMotor(status, ctx, data, periodo, opcional) {
  if (status === "feito" || status === "nao_feito") return status;
  if (!slotPassou(ctx, data, periodo)) return "pendente";
  return opcional ? "passou" : "perdida";
}

function sessoesDaSemana(semana, ctx) {
  const sessoes = [];
  for (const dia of semana.dias) {
    for (const e of dia.entradas) {
      const base = { data: dia.data, periodo: e.periodo, fonte: e };
      if (e.tipo === "sessao") {
        if (e.remanejado || (e.log && e.log.status === "mesclada")) continue; // conta na avulsa ou na combinada
        const opcional = !!e.item.opcional;
        sessoes.push({
          ...base, id: `item:${e.item.id}`, rotulo: e.item.rotulo, cat: categoria(e.item.tipo, e.item.rotulo), opcional,
          status: statusNoMotor(statusDaSessao(e), ctx, dia.data, e.periodo, opcional),
        });
      } else if (e.tipo === "corrida") {
        const st = e.planned.status;
        const feita = corridaFeita(st);
        sessoes.push({
          ...base, id: `run:${e.planned.id}`, rotulo: "Corrida", cat: "corrida", opcional: false, encurtada: !!e.planned.encurtada,
          status: statusNoMotor(feita ? "feito" : st === "nao_realizado" ? "nao_feito" : null, ctx, dia.data, e.periodo, false),
        });
      } else if (e.tipo === "mesclada") {
        sessoes.push({
          ...base, id: `merge:${e.merge.id}`, rotulo: e.merge.rotulo, cat: categoria("musculacao", e.merge.rotulo), opcional: false, combinada: true,
          status: statusNoMotor(e.merge.status, ctx, dia.data, e.periodo, false),
        });
      } else if (e.log.status === "feito") {
        sessoes.push({ ...base, id: `log:${e.log.id}`, rotulo: e.log.rotulo, cat: categoria(e.log.tipo, e.log.rotulo), opcional: false, status: "feito" });
      }
    }
  }
  return sessoes;
}

/**
 * Monta o estado do motor (puro). `semana` vem de agenda.resumirSemana; `excecoes`
 * são {data, bloqueio, feriado}; `decididos` são ids de treinos com ✕ que vieram
 * de uma rota aceita e não voltam a ser oferecidos para recuperar.
 */
export function montarEstado({ semana, agora, disponibilidade = DISPONIBILIDADE_PADRAO, excecoes = [], checkin = null, decididos = [] }) {
  const ctx = {
    inicio: semana.inicio,
    hoje: paraISODate(agora),
    minutos: agora.getHours() * 60 + agora.getMinutes(),
    disponibilidade,
    excecoes: Object.fromEntries(excecoes.map((x) => [x.data, x])),
    checkin: { ...CHECKIN.padrao, ...(checkin || {}) },
    decididos: new Set(decididos),
  };
  return { ctx, sessoes: sessoesDaSemana(semana, ctx) };
}

// ---------------------------------------------------------------------------
// Regras obrigatórias
// ---------------------------------------------------------------------------

function grupoAusenteNoPiso(sessoes, cat) {
  return !sessoes.some((s) => s.cat === cat && (ehAtiva(s) || s.status === "perdida"));
}

/** Todas as regras quebradas. Violação só entre sessões feitas não conta: feita não muda. */
export function violacoes(sessoes, ctx) {
  const v = [];
  const a = sessoes.filter(ehAtiva);
  const add = (k, texto) => v.push({ k, texto });

  for (const s of a.filter(ehAberta)) {
    const dia = diaDaSemana(s.data);
    if (s.cat === "intenso" && !(s.periodo === "noite" && NOITES_DE_KARATE.intenso.includes(dia))) add(`karate-dia:${s.id}`, "O karatê intenso só acontece na terça à noite.");
    if (s.cat === "leve" && !(s.periodo === "noite" && NOITES_DE_KARATE.leve.includes(dia))) add(`karate-dia:${s.id}`, "O karatê leve só acontece nas noites de aula: segunda, quarta ou sexta.");
    if (slotBloqueado(ctx, s.data, s.periodo)) add(`bloqueio:${s.id}`, `${rotuloCurto(s)} ${noSlot(ctx, s.data, s.periodo)}: você marcou que não pode.`);
    if (ctx.checkin.fascia && s.cat === "corrida" && s.data === ctx.hoje && !s.encurtada) {
      add(`fascia:${s.id}`, "Dor na fáscia hoje: a corrida de hoje só pode ser encurtada ou ficar como não feita.");
    }
  }

  const karates = a.filter((s) => (s.cat === "intenso" || s.cat === "leve") && !(s.opcional && ehAberta(s)));
  if (karates.length > LIMITES.karatesPorSemana && karates.some(ehAberta)) add("karate-limite", `Mais de ${LIMITES.karatesPorSemana} karatês na semana.`);

  const porDia = new Map();
  for (const s of a) porDia.set(s.data, [...(porDia.get(s.data) || []), s]);
  for (const [data, doDia] of porDia) {
    if (doDia.length > LIMITES.treinosPorDia && doDia.some(ehAberta)) add(`dia-limite:${data}`, `Mais de ${LIMITES.treinosPorDia} treinos ${noDia(ctx, data)}.`);
  }

  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j < a.length; j++) {
      const [p, q] = [a[i], a[j]];
      if (!ehAberta(p) && !ehAberta(q)) continue;
      const par = (c1, c2) => (p.cat === c1 && q.cat === c2) || (p.cat === c2 && q.cat === c1);
      const mesmoDia = p.data === q.data;
      if (mesmoDia && (par("leve", "corrida") || par("intenso", "corrida"))) add(`impacto:${p.data}`, `Karatê e corrida ${noDia(ctx, p.data)}, mesmo dia de impacto.`);
      if (mesmoDia && par("corrida", "corrida")) add(`corrida-dupla:${p.data}`, `Duas corridas ${noDia(ctx, p.data)}.`);
      if (mesmoDia && par("lower", "intenso")) add(`lower-intenso:${p.data}`, `Lower ${noDia(ctx, p.data)}, dia do karatê intenso.`);
      if (mesmoDia && par("lower", "lower")) add(`lower-seguido:${p.data}`, `Dois Lower ${noDia(ctx, p.data)}.`);
      if (par("lower", "lower") && Math.abs(diffDias(p.data, q.data)) === 1) {
        const [d1, d2] = p.data < q.data ? [p.data, q.data] : [q.data, p.data];
        add(`lower-seguido:${d1}`, `Lower em dias seguidos: ${nomeDiaSemana(d1)} e ${nomeDiaSemana(d2)}.`);
      }
    }
  }

  if (grupoAusenteNoPiso(sessoes, "lower")) add("piso:lower", "A semana terminaria sem nenhum Lower.");
  if (grupoAusenteNoPiso(sessoes, "upper")) add("piso:upper", "A semana terminaria sem nenhum Upper.");
  return v;
}

// ---------------------------------------------------------------------------
// Check-in e penalidades
// ---------------------------------------------------------------------------

/** O que pesa nos treinos pendentes de hoje, segundo o check-in. */
export function pesoCheckin(sessoes, ctx) {
  const { checkin } = ctx;
  const cansado = checkin.disposicao <= CHECKIN.cansadoAte;
  const deHoje = sessoes.filter((s) => s.data === ctx.hoje && ehAtiva(s));
  const pesos = [];
  for (const s of deHoje.filter((x) => x.status === "pendente")) {
    if (s.cat === "lower" && checkin.dorLower) pesos.push({ texto: `${s.rotulo} hoje com dor em Lower.`, custo: PENALIDADES.lowerComDorEmLower });
    if (s.cat === "upper" && checkin.dorUpper) pesos.push({ texto: `${s.rotulo} hoje com dor em Upper.`, custo: PENALIDADES.upperComDorEmUpper });
    if (cansado && CATALOGO[s.cat] && CATALOGO[s.cat].prioridade <= CHECKIN.altaPrioridadeAte) {
      pesos.push({ texto: `${rotuloCurto(s)} hoje com disposição baixa.`, custo: PENALIDADES.altaPrioridadeCansado });
    }
  }
  if (cansado && deHoje.length >= 2 && deHoje.some((s) => s.status === "pendente")) {
    pesos.push({ texto: "Dois treinos hoje com disposição baixa.", custo: PENALIDADES.diaComDoisTreinosCansado - PENALIDADES.diaComDoisTreinos });
  }
  return pesos;
}
const somaPesos = (lista) => lista.reduce((soma, p) => soma + p.custo, 0);

function penalidades(sessoes, ctx) {
  const a = sessoes.filter(ehAtiva);
  const lista = [...pesoCheckin(sessoes, ctx).map((p) => ({ custo: p.custo, texto: "pesa no check-in de hoje" }))];
  const add = (custo, texto) => lista.push({ custo, texto });
  const familia = (s) => (CATALOGO[s.cat] ? CATALOGO[s.cat].familia : s.cat);

  for (const l of a.filter((s) => s.cat === "lower")) {
    for (const o of a) {
      const dias = diffDias(l.data, o.data);
      if (o.cat === "intenso" && dias === 1) add(PENALIDADES.lowerVesperaIntenso, "deixa Lower na véspera do karatê intenso");
      if (o.cat === "corrida" && dias === 1) add(PENALIDADES.lowerVesperaCorrida, "deixa Lower na véspera de corrida");
      if (o.cat === "corrida" && dias === 0 && l.periodo === "manha" && o.periodo === "noite") add(PENALIDADES.lowerAntesDaCorrida, "faz Lower antes da corrida no mesmo dia");
    }
  }
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j < a.length; j++) {
      const [p, q] = [a[i], a[j]];
      if (p.cat === "corrida" && q.cat === "corrida" && Math.abs(diffDias(p.data, q.data)) === 1) add(PENALIDADES.corridaDiasSeguidos, "faz corrida em dias seguidos");
      if (familia(p) === familia(q) && familia(p) !== "outro" && Math.abs(horaDeReferencia(ctx, p) - horaDeReferencia(ctx, q)) < 48 * 60) add(PENALIDADES.mesmoGrupoMenosDe48h, "deixa menos de 48h entre treinos do mesmo grupo");
      if (p.data === q.data) add(PENALIDADES.diaComDoisTreinos, "deixa um dia com dois treinos");
    }
  }
  return lista;
}

// ---------------------------------------------------------------------------
// Rota 0
// ---------------------------------------------------------------------------

/** Avaliação sem mudanças. É barata: roda sozinha para decidir se há aviso. */
export function avaliar(estado) {
  const v = violacoes(estado.sessoes, estado.ctx);
  const perdidas = estado.sessoes.filter((s) => s.status === "perdida");
  return { fora: v.length > 0 || perdidas.length > 0, violacoes: v, perdidas, motivo: v.length ? v[0].texto : null };
}

// ---------------------------------------------------------------------------
// Operações
// ---------------------------------------------------------------------------

const normalizado = (t) => String(t || "").trim().toLowerCase();

function gerarOperacoes(sessoes, ctx, reabrir = new Set()) {
  const ops = [];
  const candidatas = sessoes.filter((s) => s.cat !== "outro" && !s.criada && (s.status === "pendente" || s.status === "perdida" || reabrir.has(s.id)));
  const livres = slotsLivres(sessoes, ctx);

  for (const s of candidatas) {
    const presaPelaFascia = ctx.checkin.fascia && s.cat === "corrida" && s.data === ctx.hoje && s.status === "pendente";
    if (!s.combinada && !presaPelaFascia) {
      for (const l of livres) ops.push({ tipo: "mover", id: s.id, data: l.data, periodo: l.periodo, reabrir: reabrir.has(s.id), custo: CUSTOS.mover });
    }
    if (ctx.checkin.fascia && s.cat === "corrida" && s.data === ctx.hoje && s.status === "pendente" && !s.encurtada) {
      ops.push({ tipo: "encurtar", id: s.id, custo: CUSTOS.encurtar });
    }
    if (!reabrir.has(s.id)) ops.push({ tipo: "naoFazer", id: s.id, custo: CUSTOS.naoFazer[s.cat] });
  }

  for (const [a, b] of PARES_PARA_JUNTAR) {
    const sa = candidatas.find((s) => s.fonte && s.fonte.tipo === "sessao" && normalizado(s.rotulo) === normalizado(a));
    const sb = candidatas.find((s) => s.fonte && s.fonte.tipo === "sessao" && normalizado(s.rotulo) === normalizado(b));
    if (!sa || !sb) continue;
    const proprios = [sa, sb].filter((s) => !slotPassou(ctx, s.data, s.periodo)).map((s) => ({ data: s.data, periodo: s.periodo }));
    for (const destino of [...proprios, ...livres]) {
      const { erros } = validarMerge({
        escolhidas: [{ entrada: sa.fonte, data: sa.data }, { entrada: sb.fonte, data: sb.data }], data: destino.data, inicio: ctx.inicio,
      });
      if (erros.length) continue;
      ops.push({ tipo: "juntar", ids: [sa.id, sb.id], rotulo: `${a} + ${b}`, data: destino.data, periodo: destino.periodo, reabrir: reabrir.has(sa.id) || reabrir.has(sb.id), custo: CUSTOS.juntar });
    }
  }
  return ops;
}

function aplicarOperacao(sessoes, op) {
  if (op.tipo === "mover") return sessoes.map((s) => (s.id === op.id ? { ...s, data: op.data, periodo: op.periodo, status: "pendente" } : s));
  if (op.tipo === "encurtar") return sessoes.map((s) => (s.id === op.id ? { ...s, encurtada: true } : s));
  if (op.tipo === "naoFazer") return sessoes.map((s) => (s.id === op.id ? { ...s, status: "nao_feito" } : s));
  const origem = sessoes.find((s) => s.id === op.ids[0]);
  return [
    ...sessoes.map((s) => (op.ids.includes(s.id) ? { ...s, status: "mesclada" } : s)),
    { id: `juntar:${op.rotulo}`, rotulo: op.rotulo, cat: origem.cat, data: op.data, periodo: op.periodo, status: "pendente", combinada: true, criada: true, opcional: false },
  ];
}

const assinaturaSessoes = (sessoes) => sessoes.map((s) => `${s.id}:${s.status}:${s.data}:${s.periodo}:${s.encurtada ? 1 : 0}`).sort().join("|");

/** Identifica a situação da semana: mudou algo, as rotas calculadas antes já não valem. */
export function assinaturaDoEstado(estado) {
  return `${assinaturaSessoes(estado.sessoes)}#${JSON.stringify(estado.ctx.checkin)}#${JSON.stringify(estado.ctx.excecoes)}`;
}

/** Mudança em linguagem natural. `sessoes` = o estado ANTES da operação. */
function descreverOperacao(op, sessoes, ctx) {
  if (op.tipo === "juntar") return `Juntar ${op.rotulo.replace(" + ", " + ")} ${noSlot(ctx, op.data, op.periodo)}`;
  const s = sessoes.find((x) => x.id === op.id);
  const nome = nomeDaSessao(ctx, s);
  if (op.tipo === "mover") return `${voltaAoPrevisto(s, op) ? "Voltar" : "Mover"} ${nome} para ${paraSlot(ctx, op.data, op.periodo)}`;
  if (op.tipo === "encurtar") return `Encurtar ${nome}`;
  if (s.status !== "perdida") return `Não fazer ${nome}`;
  return `Marcar ${nome} como não ${s.cat === "corrida" ? "feita" : "feito"}`;
}

function voltaAoPrevisto(s, op) {
  const e = s.fonte;
  if (!e) return false;
  if (e.tipo === "sessao" && e.movimento) return e.movimento.dataOrigem === op.data && e.item.periodo === op.periodo;
  return e.tipo === "corrida" && e.planned.dataOriginal === op.data;
}

function fraseDeMotivo(ops, sessoesIniciais, final, ctx, textoPadrao) {
  const tipos = new Set(ops.map((o) => o.tipo));
  const deixa = ops.filter((o) => o.tipo === "naoFazer").map((o) => nomeDaSessao(ctx, sessoesIniciais.find((s) => s.id === o.id)));
  const abreMao = deixa.map(comDe).join(" e ");
  let base;
  if (textoPadrao) base = textoPadrao;
  else if (ops.some((o) => o.reabrir)) base = "O ✕ sai e o treino volta a ficar pendente para garantir o piso de musculação";
  else if (tipos.has("juntar") && abreMao) base = `Cobre a musculação numa sessão enxuta e abre mão ${abreMao}`;
  else if (tipos.has("juntar") && tipos.has("mover")) base = "Junta os treinos numa sessão enxuta e remaneja o resto sem perder nada";
  else if (tipos.has("juntar")) base = "Cobre os dois treinos numa sessão enxuta";
  else if (tipos.has("encurtar")) base = "Mantém o hábito de correr com menos carga nos pés";
  else if (abreMao) base = `Mantém o resto da semana e abre mão ${abreMao}`;
  else base = "Mantém todos os treinos e só muda o horário";

  const antes = new Set(penalidades(sessoesIniciais, ctx).map((p) => p.texto));
  const novas = penalidades(final, ctx).filter((p) => !antes.has(p.texto)).sort((a, b) => b.custo - a.custo);
  return novas.length ? `${base}, mas ${novas[0].texto}.` : `${base}.`;
}

function montarRota(ops, sessoesIniciais, final, ctx, extras = {}) {
  let atual = sessoesIniciais;
  const descritas = [];
  for (const op of ops) {
    descritas.push({ op, texto: descreverOperacao(op, atual, ctx) });
    atual = aplicarOperacao(atual, op);
  }
  descritas.sort((a, b) => ORDEM_NA_TELA.indexOf(a.op.tipo) - ORDEM_NA_TELA.indexOf(b.op.tipo));
  const custo = ops.reduce((soma, o) => soma + o.custo, 0) + somaPesosPenalidades(final, ctx);
  return { ops, mudancas: descritas.map((d) => d.texto), custo, motivo: fraseDeMotivo(ops, sessoesIniciais, final, ctx, extras.textoMotivo), final, fechar: extras.fechar || [] };
}
const ORDEM_NA_TELA = ["juntar", "mover", "encurtar", "naoFazer"];
const somaPesosPenalidades = (sessoes, ctx) => penalidades(sessoes, ctx).reduce((soma, p) => soma + p.custo, 0);

/** Menor custo primeiro; com diferença pequena, a rota com menos mudanças vem antes. */
function ordenarRotas(rotas) {
  const lista = [...rotas].sort((a, b) => a.custo - b.custo);
  for (let i = 0; i < lista.length; i++) {
    for (let j = 0; j < lista.length - 1; j++) {
      const [a, b] = [lista[j], lista[j + 1]];
      if (b.ops.length < a.ops.length && b.custo - a.custo <= LIMITES.folgaParaPreferirMenosMudancas) [lista[j], lista[j + 1]] = [b, a];
    }
  }
  return lista;
}

/**
 * Tira rotas que só mudam um detalhe: o horário de destino, ou um caminho diferente
 * que termina na mesma semana (mesmos tipos de treino nos mesmos slots).
 */
function rotasDiferentes(rotas, limite) {
  const vistas = new Set();
  const escolhidas = [];
  for (const r of rotas) {
    const chave = r.ops.map((o) => `${o.tipo}:${o.ids ? o.ids.join("+") : o.id}`).sort().join("|");
    const semanaFinal = `final:${r.final.filter(ehAtiva).map((s) => `${s.cat}:${s.data}:${s.periodo}:${s.encurtada ? 1 : 0}:${s.combinada ? 1 : 0}`).sort().join("|")}`;
    if (vistas.has(chave) || vistas.has(semanaFinal)) continue;
    vistas.add(chave);
    vistas.add(semanaFinal);
    escolhidas.push(r);
    if (escolhidas.length === limite) break;
  }
  return escolhidas;
}

// ---------------------------------------------------------------------------
// Busca de rotas
// ---------------------------------------------------------------------------

/** Treinos com ✕ que o motor pode reabrir: só com o piso de musculação quebrado. */
function reabrirParaOPiso(sessoes) {
  const faltam = ["lower", "upper"].filter((cat) => grupoAusenteNoPiso(sessoes, cat));
  return new Set(sessoes.filter((s) => s.status === "nao_feito" && !s.combinada && faltam.includes(s.cat)).map((s) => s.id));
}

function buscaEmCamadas(sessoes, ctx, { reabrir, ehFim, filtroOp = () => true, aoDescartar = () => {}, seguirDepoisDoFim = false, mudancasNecessarias = () => 0 }) {
  const iniciais = new Set(violacoes(sessoes, ctx).map((v) => v.k));
  const vistos = new Set([assinaturaSessoes(sessoes)]);
  const fins = [];
  let camada = [{ sessoes, ops: [] }];
  for (let profundidade = 1; profundidade <= LIMITES.mudancasPorRota && camada.length; profundidade++) {
    const proxima = [];
    for (const no of camada) {
      // Uma sessão só muda uma vez na rota; a exceção é mover e depois encurtar.
      const tocadas = new Set(no.ops.filter((o) => o.tipo !== "encurtar").flatMap((o) => o.ids || [o.id]));
      for (const op of gerarOperacoes(no.sessoes, ctx, reabrir)) {
        if (!filtroOp(op, no.sessoes)) continue;
        if (op.tipo !== "encurtar" && (op.ids || [op.id]).some((id) => tocadas.has(id))) continue;
        const sessoesNovas = aplicarOperacao(no.sessoes, op);
        const assinatura = assinaturaSessoes(sessoesNovas);
        if (vistos.has(assinatura)) continue;
        vistos.add(assinatura);
        const novas = violacoes(sessoesNovas, ctx).filter((v) => !iniciais.has(v.k));
        if (novas.length) {
          if (profundidade === 1) aoDescartar(op, no.sessoes, novas[0]);
          continue;
        }
        const ops = [...no.ops, op];
        const fim = ehFim(sessoesNovas);
        if (fim) fins.push({ ops, sessoes: sessoesNovas });
        const aindaCabe = profundidade + mudancasNecessarias(sessoesNovas) <= LIMITES.mudancasPorRota;
        if ((!fim || seguirDepoisDoFim) && aindaCabe) proxima.push({ sessoes: sessoesNovas, ops });
      }
    }
    camada = proxima;
  }
  return fins;
}

/** Tira rotas que contêm outra rota inteira: a mudança a mais não resolve nada. */
function semMudancaSobrando(fins) {
  const chaveDaOp = (o) => `${o.tipo}:${o.ids ? o.ids.join("+") : o.id}:${o.data || ""}:${o.periodo || ""}`;
  const comChaves = fins.map((f) => ({ fim: f, chaves: new Set(f.ops.map(chaveDaOp)) }));
  return comChaves.filter(({ chaves }) => !comChaves.some((outra) =>
    outra.chaves.size < chaves.size && [...outra.chaves].every((k) => chaves.has(k))
  )).map((x) => x.fim);
}

function ideiasDescartadas(lista, ctx) {
  const porRegra = new Map();
  for (const item of [...lista].sort((a, b) => b.perdida - a.perdida)) {
    const regra = item.violacao.k.split(":")[0];
    if (regra !== "karate-dia" && !porRegra.has(regra)) porRegra.set(regra, `${item.texto}: ${item.violacao.texto}`);
  }
  const textos = [...porRegra.values()];
  if (ctx.checkin.fascia) textos.unshift("Levar a corrida de hoje inteira para outro dia: com dor na fáscia, só encurtar ou não fazer.");
  return textos.slice(0, LIMITES.ideiasDescartadas);
}

/**
 * Busca as rotas para uma semana fora do plano: camadas de 1, 2 e 3 mudanças,
 * descartando o que quebra regra. Sem rota para tudo, devolve "comprometida", com
 * a rota que pelo menos garante o piso de musculação; o que continuar sem registro
 * entra em `fechar` e vira não feito ao aceitar.
 */
export function calcularRotas(estado) {
  const { sessoes, ctx } = estado;
  const reabrir = reabrirParaOPiso(sessoes);
  const descartes = [];
  const resolvida = (lista) => violacoes(lista, ctx).length === 0 && !lista.some((s) => s.status === "perdida");
  const perdidasDe = (lista) => lista.filter((s) => s.status === "perdida").length;

  // Cada operação resolve no máximo duas perdidas (juntar).
  const mudancasNecessarias = (lista) => Math.ceil(perdidasDe(lista) / 2);
  const fins = mudancasNecessarias(sessoes) <= LIMITES.mudancasPorRota
    ? buscaEmCamadas(sessoes, ctx, {
        reabrir, ehFim: resolvida, mudancasNecessarias,
        aoDescartar: (op, atuais, violacao) => {
          if (op.tipo !== "mover") return;
          const perdida = atuais.find((s) => s.id === op.id).status === "perdida" ? 1 : 0;
          descartes.push({ texto: descreverOperacao(op, atuais, ctx), violacao, perdida });
        },
      })
    : [];
  if (fins.length) {
    const catDe = (id) => sessoes.find((s) => s.id === id).cat;
    // Mover uma corrida e deixar de fazer outra é o mesmo que deixar de fazer a primeira.
    const semTroca = fins.filter((f) => {
      const deixadas = f.ops.filter((o) => o.tipo === "naoFazer").map((o) => catDe(o.id));
      return !f.ops.some((o) => o.tipo === "mover" && deixadas.includes(catDe(o.id)));
    });
    const rotas = ordenarRotas(semMudancaSobrando(semTroca.length ? semTroca : fins).map((f) => montarRota(f.ops, sessoes, f.sessoes, ctx)));
    return { tipo: "rotas", rotas: rotasDiferentes(rotas, LIMITES.rotasNaTela), descartadas: ideiasDescartadas(descartes, ctx) };
  }

  const semPerdidas = (lista) => lista.map((s) => (s.status === "perdida" ? { ...s, status: "nao_feito" } : s));
  const pisoGarantido = (lista) => {
    const fechada = semPerdidas(lista);
    const k = new Set(violacoes(sessoes.filter((s) => s.status !== "perdida"), ctx).map((v) => v.k).filter((x) => !x.startsWith("piso:")));
    return violacoes(fechada, ctx).every((v) => k.has(v.k));
  };
  // Entre as saídas que garantem o piso, vale a que cobre mais musculação.
  const musculacaoCoberta = (lista) => lista.filter((s) => ["lower", "upper"].includes(s.cat) && !s.criada && ["feito", "pendente", "mesclada"].includes(s.status)).length;
  const fimComPiso = [
    ...(pisoGarantido(sessoes) ? [{ ops: [], sessoes }] : []),
    ...buscaEmCamadas(sessoes, ctx, {
      reabrir, ehFim: pisoGarantido, seguirDepoisDoFim: true,
      filtroOp: (op, atuais) => op.tipo === "juntar" || (op.tipo === "mover" && ["lower", "upper"].includes(atuais.find((s) => s.id === op.id).cat)),
    }),
  ];
  const rotasPiso = fimComPiso.map((f) => {
    const final = semPerdidas(f.sessoes);
    const fechar = f.sessoes.filter((s) => s.status === "perdida").map((s) => ({ id: s.id, rotulo: rotuloCurto(s), dia: nomeDiaSemana(s.data) }));
    const rota = montarRota(f.ops, sessoes, final, ctx, { fechar, textoMotivo: "Garante o piso de musculação com o que ainda dá tempo de fazer" });
    return { rota, cobertura: musculacaoCoberta(f.sessoes) };
  }).sort((a, b) => b.cobertura - a.cobertura || a.rota.custo - b.rota.custo);
  return {
    tipo: "comprometida",
    rotas: rotasPiso.length ? [rotasPiso[0].rota] : [],
    descartadas: ideiasDescartadas(descartes, ctx),
  };
}

// ---------------------------------------------------------------------------
// Ofertas: semana em dia, mas com algo que dá para ajustar se o usuário quiser
// ---------------------------------------------------------------------------

/**
 * Opções ao tocar em Recalcular com a semana em dia. Sempre há "Manter como está";
 * as alternativas tiram peso do check-in de hoje ou recuperam um treino com ✕.
 */
export function calcularOfertas(estado) {
  const { sessoes, ctx } = estado;
  const pesos = pesoCheckin(sessoes, ctx);
  const comX = sessoes.filter((s) => s.status === "nao_feito" && !s.combinada && !s.opcional && s.cat !== "outro" && !ctx.decididos.has(s.id));
  const reabrir = new Set(comX.map((s) => s.id));
  const operacoes = gerarOperacoes(sessoes, ctx, reabrir).filter((o) => o.tipo === "mover" || o.tipo === "juntar");
  const pesoAtual = somaPesos(pesos);
  const candidatas = [];
  const valida = (lista) => violacoes(lista, ctx).length === 0 && !lista.some((s) => s.status === "perdida");

  for (const op of operacoes) {
    const final = aplicarOperacao(sessoes, op);
    if (!valida(final)) continue;
    const alivia = pesoAtual > 0 && somaPesos(pesoCheckin(final, ctx)) < pesoAtual;
    if (op.reabrir) {
      const textoMotivo = op.tipo === "juntar" ? "Recupera os dois treinos numa sessão enxuta" : "O ✕ sai e o treino volta a ficar pendente";
      candidatas.push(montarRota([op], sessoes, final, ctx, { textoMotivo }));
    } else if (alivia) {
      const textoMotivo = op.tipo === "juntar" ? "Tira o treino de hoje e cobre os dois numa sessão enxuta" : "Tira o treino de hoje sem perder nada";
      candidatas.push(montarRota([op], sessoes, final, ctx, { textoMotivo }));
    }
  }
  const rotas = rotasDiferentes(ordenarRotas(candidatas), LIMITES.rotasNaTela);
  const aRecuperar = comX.filter((s) => rotas.some((r) => r.ops.some((o) => (o.ids || [o.id]).includes(s.id))));
  return {
    pesos,
    rotas,
    ficamComoEstao: aRecuperar.map((s) => `${rotuloCurto(s)} fica como não ${s.cat === "corrida" ? "feita" : "feito"}.`),
    temOferta: pesos.length > 0 || rotas.length > 0,
  };
}
