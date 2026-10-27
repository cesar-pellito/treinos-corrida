// csv.js — parser CSV mínimo e tolerante (RFC 4180). Sem DOM, sem dependências.
//   - campos entre aspas com vírgula, quebra de linha e aspas duplicadas ("")
//   - separador detectado na 1ª linha: vírgula, ponto e vírgula ou tab
//   - BOM e CRLF

/** Separador mais frequente na 1ª linha, fora de aspas. */
export function detectarSeparador(texto) {
  const cont = { ",": 0, ";": 0, "\t": 0 };
  let aspas = false;
  for (const ch of texto) {
    if (ch === '"') aspas = !aspas;
    else if (!aspas && (ch === "\n" || ch === "\r")) break;
    else if (!aspas && ch in cont) cont[ch]++;
  }
  const [melhor, n] = Object.entries(cont).sort((a, b) => b[1] - a[1])[0];
  return n > 0 ? melhor : ",";
}

/** Texto -> matriz de strings. Linhas totalmente vazias são descartadas. */
export function parseCSV(texto, sep = detectarSeparador(texto)) {
  const s = texto.replace(/^﻿/, "");
  const linhas = [];
  let linha = [], campo = "", aspas = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (aspas) {
      if (ch === '"') {
        if (s[i + 1] === '"') { campo += '"'; i++; }
        else aspas = false;
      } else campo += ch;
    } else if (ch === '"') {
      aspas = true;
    } else if (ch === sep) {
      linha.push(campo); campo = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      linha.push(campo); campo = "";
      if (linha.some((c) => c !== "")) linhas.push(linha);
      linha = [];
    } else campo += ch;
  }
  linha.push(campo);
  if (linha.some((c) => c !== "")) linhas.push(linha);
  return linhas;
}

/** Texto -> {cabecalho, linhas:[{coluna: valor}]}. Cabeçalho sem espaços nas pontas. */
export function lerTabela(texto) {
  const m = parseCSV(texto);
  if (!m.length) return { cabecalho: [], linhas: [] };
  const cabecalho = m[0].map((c) => c.trim());
  const linhas = m.slice(1).map((l) => Object.fromEntries(cabecalho.map((c, i) => [c, (l[i] ?? "").trim()])));
  return { cabecalho, linhas };
}
