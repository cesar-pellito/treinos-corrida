// theme.js — aplica o tema (auto/claro/escuro) via atributo data-theme no <html>.

import * as repo from "../data/repository.js";

export function aplicarTema(valor) {
  const root = document.documentElement;
  if (valor === "claro") root.setAttribute("data-theme", "light");
  else if (valor === "escuro") root.setAttribute("data-theme", "dark");
  else root.removeAttribute("data-theme");
}

export async function carregarEAplicarTema() {
  const v = await repo.obterConfig("temaEscuro", "auto");
  aplicarTema(v);
  return v;
}
