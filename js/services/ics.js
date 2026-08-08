// ics.js — gera um arquivo .ics dos treinos planejados. Sem dependências.
//
// - UID estável por treino: treino-{id}@corrida.local
// - SEQUENCE incrementado a cada reagendamento -> calendários que respeitam UID
//   (Apple) atualizam em vez de duplicar.
// - Evento com HORÁRIO real do treino (não "dia todo"), para que a notificação
//   padrão do Google Calendar tenha a que se ancorar (o Google ignora VALARM).
// - VALARM às {horarioLembrete} do dia anterior (respeitado pelo Apple Calendar).

import { deISODate, somarDias } from "./dates.js";

function pad(n) { return String(n).padStart(2, "0"); }

/** 'YYYY-MM-DD' + 'HH:MM' -> 'YYYYMMDDTHHMMSS' (horário flutuante, tz do aparelho). */
function dt(iso, hhmm) {
  const d = deISODate(iso);
  const [h, m] = hhmm.split(":").map(Number);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(h)}${pad(m)}00`;
}

/** Escapa texto para valor ICS. */
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Dobra linhas > 74 octetos conforme RFC 5545. */
function dobrar(linha) {
  if (linha.length <= 74) return linha;
  const partes = [];
  let resto = linha;
  partes.push(resto.slice(0, 74));
  resto = resto.slice(74);
  while (resto.length) { partes.push(" " + resto.slice(0, 73)); resto = resto.slice(73); }
  return partes.join("\r\n");
}

function addMinutosHHMM(hhmm, minutos) {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + minutos;
  const hh = Math.floor((total % 1440 + 1440) % 1440 / 60);
  const mm = ((total % 60) + 60) % 60;
  return `${pad(hh)}:${pad(mm)}`;
}

function corpoEvento(w) {
  const linhas = [
    w.objetivoFisiologico,
    "",
    `Duração: ${w.duracaoMin} min · RPE ${w.rpeMin}–${w.rpeMax}${w.zonaFC ? " · Zona FC " + w.zonaFC : ""}`,
    `Aquecimento: ${w.aquecimento}`,
    `Principal: ${w.partePrincipal}`,
    `Desaquecimento: ${w.desaquecimento}`,
  ];
  return linhas.join("\n");
}

/**
 * @param {Array} planned  treinos planejados (idealmente futuros/reagendados)
 * @param {{horarioTreino?:string, horarioLembrete?:string, agora?:string}} opts
 * @returns {string} conteúdo .ics
 */
export function gerarICS(planned, { horarioTreino = "06:30", horarioLembrete = "20:00", agora } = {}) {
  const dtstamp = (agora || new Date().toISOString()).replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const out = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Treinos de Corrida//PT-BR//",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Plano de Corrida",
  ];

  for (const w of planned) {
    const inicio = dt(w.dataPlanejada, horarioTreino);
    const fimHHMM = addMinutosHHMM(horarioTreino, (w.duracaoMin || 30) + 20); // +20 aquec/desaq
    const fim = dt(w.dataPlanejada, fimHHMM);
    const alarmeDia = somarDias(w.dataPlanejada, -1);
    const alarme = dt(alarmeDia, horarioLembrete);

    out.push("BEGIN:VEVENT");
    out.push(`UID:treino-${w.id}@corrida.local`);
    out.push(`SEQUENCE:${w.sequence || 0}`);
    out.push(`DTSTAMP:${dtstamp}`);
    out.push(`DTSTART:${inicio}`);
    out.push(`DTEND:${fim}`);
    out.push(dobrar(`SUMMARY:${esc(`${w.titulo} — Sem ${w.semana}`)}`));
    out.push(dobrar(`DESCRIPTION:${esc(corpoEvento(w))}`));
    out.push("BEGIN:VALARM");
    out.push("ACTION:DISPLAY");
    out.push(dobrar(`DESCRIPTION:${esc(w.titulo)}`));
    out.push(`TRIGGER;VALUE=DATE-TIME:${alarme}`);
    out.push("END:VALARM");
    out.push("END:VEVENT");
  }

  out.push("END:VCALENDAR");
  return out.join("\r\n");
}
