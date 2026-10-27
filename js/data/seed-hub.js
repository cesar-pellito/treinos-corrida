// seed-hub.js — dados iniciais do hub, com UUIDs FIXOS.
//
// Os IDs abaixo foram gerados uma única vez com crypto.randomUUID() e ficam
// congelados no arquivo. Assim o seed é idempotente em qualquer aparelho:
// reinstalar o app, restaurar backup ou sincronizar outro celular nunca duplica
// estes registros (o merge é por ID). Não troque os IDs.
//
// Tudo aqui é ponto de partida: a agenda é editável em Ajustes → Agenda semanal.

// diaSemana segue Date.getDay(): 0 = domingo … 6 = sábado.
export const AGENDA_PADRAO = [
  { id: "9f2a5a93-96eb-49f8-b9aa-24e6c8c58141", diaSemana: 1, periodo: "manha", tipo: "musculacao", rotulo: "Upper A", opcional: false, ordem: 0 },
  { id: "104e1596-87f2-4f6d-9fe6-413f5604c247", diaSemana: 1, periodo: "noite", tipo: "karate", rotulo: "Leve", opcional: false, ordem: 0 },
  { id: "d8b58006-31b1-456e-ad3d-442e51ceb70d", diaSemana: 2, periodo: "noite", tipo: "karate", rotulo: "Intenso", opcional: false, ordem: 0 },
  { id: "05b10f2d-28e5-4f84-af56-0340e2c588c5", diaSemana: 3, periodo: "manha", tipo: "musculacao", rotulo: "Upper B", opcional: false, ordem: 0 },
  { id: "e2522d61-ac2b-4a9a-9e0e-543af3cb5c2b", diaSemana: 3, periodo: "noite", tipo: "karate", rotulo: "Leve", opcional: false, ordem: 0 },
  { id: "a1b21973-a4e3-413e-8216-2602e813f95c", diaSemana: 4, periodo: "manha", tipo: "corrida", rotulo: "Corrida curta", opcional: false, ordem: 0 },
  { id: "3991f603-5199-4140-846c-888efd8c2953", diaSemana: 4, periodo: "noite", tipo: "musculacao", rotulo: "Lower A", opcional: false, ordem: 0 },
  { id: "627ebe5b-a890-48e6-bdc7-f3d5af2dca13", diaSemana: 5, periodo: "noite", tipo: "karate", rotulo: "Leve", opcional: true, ordem: 0 },
  { id: "690c2543-22e7-46c3-a2a4-c6be149b50c6", diaSemana: 6, periodo: "manha", tipo: "corrida", rotulo: "Corrida Z2", opcional: false, ordem: 0 },
  { id: "45f44f53-b0b2-4433-b59e-bc58cd361f45", diaSemana: 0, periodo: "manha", tipo: "musculacao", rotulo: "Lower B", opcional: false, ordem: 0 },
];

// Suas avaliações InBody (referência). Massas em kg; gorduraPct em %.
export const INBODY_INICIAIS = [
  { id: "aa0e4502-1abf-4b47-bf67-e627234caf47", tipo: "inbody", fonte: "inbody", data: "2026-07-08", pesoKg: 91.5, massaGorduraKg: 26.4, massaLivreGorduraKg: 65.1, massaMuscularEsqueleticaKg: 37.2, gorduraPct: 28.8 },
  { id: "b7903695-c883-439d-a501-1d874c197c1d", tipo: "inbody", fonte: "inbody", data: "2026-08-21", pesoKg: 89.8, massaGorduraKg: 24.4, massaLivreGorduraKg: 65.4, massaMuscularEsqueleticaKg: 37.2, gorduraPct: 27.2 },
  { id: "9770a190-1876-41cb-a323-19aa619dd6af", tipo: "inbody", fonte: "inbody", data: "2026-10-02", pesoKg: 85.8, massaGorduraKg: 23.1, massaLivreGorduraKg: 62.7, massaMuscularEsqueleticaKg: 35.7, gorduraPct: 26.9 },
];
