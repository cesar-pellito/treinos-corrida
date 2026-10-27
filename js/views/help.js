// help.js — como funcionam os lembretes e seus limites. Texto honesto, para
// você não descobrir em dois meses que o lembrete nunca funcionou.

import { voltar } from "./router.js";
import { el, card, cabecalhoVoltar } from "./components/ui.js";

export async function renderAjuda(container) {
  container.appendChild(cabecalhoVoltar("Ajuda — lembretes", voltar));

  container.appendChild(
    card([
      el("div", { class: "ajuda-doc stack" }, [
        el("p", { text: "Este app não envia notificações push. Em vez disso, ele gera um arquivo de calendário (.ics) que você importa no seu Google Agenda uma vez. O sistema do celular cuida do lembrete — de forma confiável, com o app fechado, sem servidor e sem custo." }),

        el("h3", { text: "Como usar" }),
        el("p", { text: "Em Ajustes, toque em “Exportar calendário (.ics)”. Abra o arquivo no Google Agenda e importe. Cada treino vira um evento com o resumo (objetivo, duração, RPE, estrutura)." }),

        el("h3", { text: "Importante sobre o Google Agenda" }),
        el("p", { class: "aviso", text: "O Google Agenda ignora o horário de alarme definido no arquivo e usa a notificação padrão da sua conta. O alarme de “20:00 do dia anterior” só é respeitado pelo Apple Calendar." }),
        el("p", { text: "Os eventos têm um horário real (manhã, por padrão) para que a notificação padrão do Google tenha a que se ancorar. Você pode mover o horário no próprio calendário." }),

        el("h3", { text: "Quando você reagendar um treino" }),
        el("p", { text: "Reexporte o .ics. Em vez de reimportar por cima (o Google pode duplicar), o caminho seguro é usar um calendário dedicado só para o plano: apague-o e importe o arquivo novo inteiro. Assim nunca duplica." }),

        el("h3", { text: "No app aberto" }),
        el("p", { text: "Quando você abrir o app e houver um treino de hoje ainda não registrado, ele aparece em destaque na tela Hoje. Esse é o lembrete dentro do app." }),

        el("h3", { text: "Seus dados" }),
        el("p", { text: "Tudo fica salvo só no seu celular — o app não tem servidor. Para não perder nada: instale o app na tela inicial (protege os dados no iOS) e exporte o backup JSON com alguma frequência, salvando no Google Drive ou no app Arquivos pelo menu de compartilhar. O app avisa quando o último backup passa de 14 dias." }),
      ]),
    ])
  );
}
