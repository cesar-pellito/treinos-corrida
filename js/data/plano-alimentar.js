// plano-alimentar.js — plano da nutricionista, portado do App_Dieta/index.html.
//
// O objeto PLANO abaixo foi COPIADO SEM ALTERAÇÃO do App_Dieta (só ganhou
// `export`). Mantenha as regras do comentário original ao editar.
// Camada de dados estática: não fala com IndexedDB.

/**
 * PLANO — dados transcritos literalmente do PDF do plano alimentar.
 * Fonte: CesarPellito.pdf — Dietnet — 08/07/2026 — Nutricionista Noemi Pasquali
 *
 * REGRAS DE MANUTENÇÃO:
 * - Quantidades são LITERAIS do PDF. Não arredondar, não padronizar.
 * - quantidade: null significa que o PDF não informa quantidade para o item.
 * - blocos se SOMAM entre si (+); opções dentro de um bloco são EXCLUDENTES (ou).
 */

export const PLANO = {
  versao: "08/07/2026",
  paciente: "Cesar Pellito",
  nutricionista: {
    nome: "Noemi Pasquali",
    email: "noemi.borges@dietnet.com.br",
    instagram: "@nutri.noemi_pasquali",
    clinica: "Dietnet",
    instagramClinica: "@dietnet",
    endereco: "Rua Tabapuã, 500 Cj. 52 - Itaim Bibi - São Paulo – SP",
    telefone: "(11) 3582-0660",
    whatsapp: "(11) 99019-7794"
  },

  hidratacao: "Ingestão de 2,5 litros de água ao longo do dia, sempre nos intervalos das refeições e durante a atividade física.",

  refeicoes: [
    {
      id: "cafe",
      nome: "Café da Manhã",
      horarioSugerido: "até 10h",
      variantes: [
        {
          nome: null,
          blocos: [
            {
              grupo: "GRUPO DOS PÃES",
              obrigatorio: true,
              opcoes: [
                { alimento: "Pão de forma", quantidade: "2 fatias" },
                { alimento: "Pão francês", quantidade: "1" },
                { alimento: "Bisnaguinhas", quantidade: "3" },
                { alimento: "Torradas (integral ou branco)", quantidade: "3" },
                { alimento: "Tapioca", quantidade: "40g" },
                { alimento: "Panquecas", quantidade: "1" }
              ]
            },
            {
              grupo: "GRUPO DAS CARNES ou LEITES E DERIVADOS",
              obrigatorio: true,
              opcoes: [
                { alimento: "Queijo branco", quantidade: "2 fatias grossas (50g)" },
                { alimento: "Frango desfiado", quantidade: "70g" },
                { alimento: "Atum", quantidade: "70g" },
                { alimento: "Creme de ricota (patê)", quantidade: "60g" },
                { alimento: "Ovos", quantidade: "2" }
              ]
            },
            {
              grupo: "CAFÉ",
              obrigatorio: false,
              opcoes: [
                { alimento: "Café", quantidade: "1 xícara" }
              ]
            },
            {
              grupo: "AÇÚCAR / ADOÇANTE",
              obrigatorio: false,
              opcoes: [
                { alimento: "Açúcar", quantidade: "1 colher de chá" },
                { alimento: "Adoçante", quantidade: "3 gotas ou 1 sachê" }
              ]
            },
            {
              grupo: "SUPLEMENTO",
              obrigatorio: true,
              opcoes: [
                { alimento: "Whey Protein", quantidade: "30g" }
              ]
            }
          ]
        }
      ],
      observacao: "Água: importante beber água ao longo do dia, não só no desjejum mas durante todo o dia; pode variar com água saborizada se desejar."
    },

    {
      id: "almoco",
      nome: "Almoço",
      horarioSugerido: "10h às 15h",
      variantes: [
        {
          nome: null,
          blocos: [
            {
              grupo: "GRUPO DE SALADA E LEGUMES",
              obrigatorio: true,
              opcoes: [
                { alimento: "Salada crua e legumes cozidos ou refogados (temperar com vinagre-limão-azeite extravirgem)", quantidade: "Metade do prato" }
              ]
            },
            {
              grupo: "GRUPO DE ARROZ",
              obrigatorio: true,
              opcoes: [
                { alimento: "Arroz Integral", quantidade: "110g" },
                { alimento: "Arroz branco (sempre que possível acompanhado de uma leguminosa)", quantidade: "110g" },
                { alimento: "Macarrão", quantidade: "200g" },
                { alimento: "Batata", quantidade: "200g" },
                { alimento: "Mandioca", quantidade: "200g" }
              ]
            },
            {
              grupo: "GRUPO DAS LEGUMINOSAS",
              obrigatorio: true,
              opcoes: [
                { alimento: "Feijão", quantidade: "120g" },
                { alimento: "Ervilha", quantidade: "120g" },
                { alimento: "Vagem", quantidade: "120g" },
                { alimento: "Grão de bico", quantidade: "120g" }
              ]
            },
            {
              grupo: "GRUPO DAS CARNES",
              obrigatorio: true,
              opcoes: [
                { alimento: "Filé de frango ou sobrecoxa sem pele ou lombo assado", quantidade: "120g" },
                { alimento: "Carne magra grelhada, cozida, assada ou refogada (filé mignon, alcatra, maminha, lagarto, músculo, patinho)", quantidade: "120g" },
                { alimento: "Peixes (sardinha, atum, arenque, anchova, salmão, truta, pescada branca, tilápia, saint peter)", quantidade: "200g" },
                { alimento: "Ovos", quantidade: "3" }
              ]
            },
            {
              grupo: "GRUPO DAS FRUTAS",
              obrigatorio: true,
              opcoes: [
                { alimento: "Fruta de sobremesa", quantidade: "1" }
              ]
            }
          ]
        }
      ],
      observacao: "Coma devagar e com atenção. Ao comer devagar, você mastiga mais vezes o alimento facilitando a digestão e dá tempo ao cérebro associar que você comeu, fazendo com que você passe a comer uma quantidade suficiente de alimentos."
    },

    {
      id: "lanche",
      nome: "Lanche da Tarde",
      horarioSugerido: "15h às 19h",
      variantes: [
        {
          nome: "1ª Alternativa",
          blocos: [
            {
              grupo: "GRUPO DOS PÃES",
              obrigatorio: true,
              opcoes: [
                { alimento: "Tapioca", quantidade: "50 gramas" },
                { alimento: "Pão Francês", quantidade: "01 unidade" },
                { alimento: "Cuscuz", quantidade: "60 gramas" }
              ]
            },
            {
              grupo: "GRUPO DAS CARNES ou LEITES E DERIVADOS",
              obrigatorio: true,
              opcoes: [
                { alimento: "Ovo Mexido", quantidade: "02 unidades" },
                { alimento: "Frango Desfiado", quantidade: "80 gramas" },
                { alimento: "Queijo Branco", quantidade: "02 fatias médias" },
                { alimento: "Creme Cheese", quantidade: null },
                { alimento: "Ricota", quantidade: null },
                { alimento: "Cottage", quantidade: "01 colher de sopa" }
              ]
            },
            {
              grupo: "CAFÉ",
              obrigatorio: false,
              opcoes: [
                { alimento: "Café", quantidade: "50 ml" }
              ]
            }
          ]
        },
        {
          nome: "2ª Alternativa — Vitamina ou fruta",
          blocos: [
            {
              grupo: "GRUPO DAS FRUTAS",
              obrigatorio: true,
              opcoes: [
                { alimento: "Fruta", quantidade: "120 gramas" }
              ]
            },
            {
              grupo: "CEREAIS E SEMENTES",
              obrigatorio: true,
              opcoes: [
                { alimento: "Aveia", quantidade: "20 gramas" },
                { alimento: "Chia", quantidade: "20 gramas" },
                { alimento: "Linhaça", quantidade: "20 gramas" }
              ]
            },
            {
              grupo: "SUPLEMENTO",
              obrigatorio: true,
              opcoes: [
                { alimento: "Whey Protein", quantidade: "30 gr (01 dose)" }
              ]
            },
            {
              grupo: "GRUPO DE LEITES E DERIVADOS",
              obrigatorio: true,
              opcoes: [
                { alimento: "Iogurte Desnatado", quantidade: "200 ml" },
                { alimento: "Leite", quantidade: "200 ml" }
              ]
            }
          ]
        }
      ],
      observacao: "Consumir a fruta da sua preferência com 20g de granola sem açúcar, ou 20g de aveia, ou 20g de semente de chia, ou 20g de linhaça, ou 20g de farinha de psyllium."
    },

    {
      id: "jantar",
      nome: "Jantar",
      horarioSugerido: "a partir das 19h",
      variantes: [
        {
          nome: "Prato",
          blocos: [
            {
              grupo: "GRUPO DE SALADA E LEGUMES",
              obrigatorio: true,
              opcoes: [
                { alimento: "Salada crua e legumes cozidos ou refogados", quantidade: "Metade do prato" }
              ]
            },
            {
              grupo: "GRUPO DE ARROZ",
              obrigatorio: true,
              opcoes: [
                { alimento: "Arroz", quantidade: "110g" },
                { alimento: "Macarrão", quantidade: "200g" },
                { alimento: "Batata", quantidade: "200g" },
                { alimento: "Mandioca", quantidade: "200g" }
              ]
            },
            {
              grupo: "GRUPO DAS LEGUMINOSAS",
              obrigatorio: true,
              opcoes: [
                { alimento: "Feijão", quantidade: "100g" },
                { alimento: "Ervilha", quantidade: "100g" },
                { alimento: "Vagem", quantidade: "100g" },
                { alimento: "Grão de bico", quantidade: "100g" },
                { alimento: "Soja", quantidade: "100g" }
              ]
            },
            {
              grupo: "GRUPO DAS CARNES",
              obrigatorio: true,
              opcoes: [
                { alimento: "Filé de frango ou sobrecoxa sem pele ou lombo assado", quantidade: "120g" },
                { alimento: "Carne magra grelhada, cozida, assada ou refogada (filé mignon, alcatra, maminha, lagarto, músculo, patinho)", quantidade: "120g" },
                { alimento: "Peixes (sardinha, atum, arenque, anchova, salmão, truta, pescada branca, tilápia, saint peter)", quantidade: "200g" }
              ]
            }
          ]
        },
        {
          nome: "Sanduíche",
          blocos: [
            {
              grupo: "PÃO",
              obrigatorio: true,
              opcoes: [
                { alimento: "Pão francês", quantidade: "1" },
                { alimento: "Pão de forma", quantidade: "2 fatias" },
                { alimento: "Pão de hambúrguer", quantidade: "1" },
                { alimento: "Pão sírio", quantidade: "1" },
                { alimento: "Tapioca", quantidade: "60g" },
                { alimento: "Cuscuz", quantidade: "100g" }
              ]
            },
            {
              grupo: "PROTEÍNA",
              obrigatorio: true,
              opcoes: [
                { alimento: "Hambúrguer caseiro + 2 fatias de mussarela", quantidade: "110g" },
                { alimento: "Frango desfiado + 20g de requeijão light", quantidade: "110g" },
                { alimento: "Carne magra moída ou assada/fatiada + 2 fatias de mussarela", quantidade: "110g" },
                { alimento: "Ovos", quantidade: "3" }
              ]
            },
            {
              grupo: "ACOMPANHAMENTO",
              obrigatorio: true,
              opcoes: [
                { alimento: "Folhas e legumes que você gosta", quantidade: "1 prato de sobremesa cheio" }
              ]
            }
          ]
        }
      ],
      observacao: null
    }
  ],

  substituicoes: {
    "GRUPO DOS PÃES – 1 porção": [
      { alimento: "Pão francês", medida: "1und" },
      { alimento: "Pão Integral", medida: "2 fatias" },
      { alimento: "Biscoito Polvilho", medida: "8 und" },
      { alimento: "Pão de forma", medida: "2 fatias" },
      { alimento: "Torrada tipo Bauducco", medida: "4und" },
      { alimento: "Pão de Queijo Mini", medida: "4 unidades" },
      { alimento: "Pão de aveia", medida: "2 fatias" },
      { alimento: "Torrada Caseira", medida: "4und" },
      { alimento: "Sucrilhos Integral", medida: "6csopa" },
      { alimento: "Bisnaguinha", medida: "3und" },
      { alimento: "Bolacha água e sal", medida: "6und" },
      { alimento: "Barra de cereal", medida: "1und" },
      { alimento: "Wrap Integral", medida: "1und" },
      { alimento: "Goma de Tapioca", medida: "3csopa" },
      { alimento: "Sírio", medida: "1und" }
    ],

    "GRUPO DO LEITE E DERIVADOS – 1 porção": [
      { alimento: "Leite desnatado", medida: "200 ml" },
      { alimento: "Leite Fermentado", medida: "1und" },
      { alimento: "Leite em pó desnatado", medida: "1csopa" },
      { alimento: "Leite Semi Desnatado", medida: "200 ml" },
      { alimento: "Queijo mussarela", medida: "2 fatias" },
      { alimento: "Creme de ricota", medida: "1csopa" },
      { alimento: "Queijo minas light", medida: "2 fatias" },
      { alimento: "Ricota fresca", medida: "2 fatias" },
      { alimento: "Iogurte natural", medida: "200 ml" },
      { alimento: "Requeijão light", medida: "1csopa" }
    ],

    "GRUPO DAS FRUTAS – gramas indicada no plano alimentar": [
      { alimento: "Mamão formosa", medida: null },
      { alimento: "Pera", medida: null },
      { alimento: "Melancia", medida: null },
      { alimento: "Laranja", medida: null },
      { alimento: "Figo", medida: null },
      { alimento: "Manga", medida: null },
      { alimento: "Melão", medida: null },
      { alimento: "Abacaxi", medida: null },
      { alimento: "Morango", medida: null },
      { alimento: "Banana", medida: null },
      { alimento: "Goiaba", medida: null },
      { alimento: "Maracujá", medida: null },
      { alimento: "Maçã", medida: null },
      { alimento: "Ameixa vermelha", medida: null },
      { alimento: "Caqui", medida: null },
      { alimento: "Acerola", medida: null },
      { alimento: "Pitanga", medida: null },
      { alimento: "Caju", medida: null },
      { alimento: "Salada de Frutas", medida: null },
      { alimento: "Suco de frutas", medida: "120ml" },
      { alimento: "Abacate", medida: null },
      { alimento: "Carambola", medida: null },
      { alimento: "Mexerica", medida: null },
      { alimento: "Cereja", medida: null },
      { alimento: "Lichia", medida: null },
      { alimento: "Uvas", medida: null }
    ],

    "GRUPO DE ARROZ – gramas indicada no plano alimentar": [
      { alimento: "Arroz branco", medida: null },
      { alimento: "Macarrão branco", medida: null },
      { alimento: "Mandioca", medida: null },
      { alimento: "Arroz Integral", medida: null },
      { alimento: "Macarrão Integral", medida: null },
      { alimento: "Milho verde", medida: null },
      { alimento: "Arroz risoto", medida: null },
      { alimento: "Batata doce", medida: null },
      { alimento: "Panqueca", medida: null },
      { alimento: "Batata Inglesa", medida: null },
      { alimento: "Salada de Maionese", medida: null },
      { alimento: "Polenta", medida: null }
    ],

    "GRUPO DAS PROTEÍNAS – gramas indicada no plano alimentar": [
      { alimento: "Bife grelhado", medida: null },
      { alimento: "Sobrecoxa sem pele", medida: null },
      { alimento: "Sardinha em lata", medida: null },
      { alimento: "Fígado grelhado", medida: null },
      { alimento: "Peito de frango", medida: null },
      { alimento: "Carne moída", medida: null },
      { alimento: "Coxa de Frango", medida: null },
      { alimento: "Coração de frango", medida: null },
      { alimento: "Ovo cozido", medida: null },
      { alimento: "Ovo Pochê", medida: null },
      { alimento: "Hambúrguer caseiro", medida: null },
      { alimento: "Atum in natura", medida: null },
      { alimento: "Filé pescada", medida: null },
      { alimento: "Almôndegas caseiras", medida: null }
    ],

    "GRUPO DOS LEGUMES – à vontade ou metade do prato": [
      { alimento: "Cenoura cozida", medida: null },
      { alimento: "Beterraba cozida", medida: null },
      { alimento: "Abóbora cozida", medida: null },
      { alimento: "Abobrinha cozida", medida: null },
      { alimento: "Berinjela cozida", medida: null },
      { alimento: "Quiabo cozido", medida: null },
      { alimento: "Vagem cozida", medida: null },
      { alimento: "Chuchu cozido", medida: null },
      { alimento: "Brócolis cozido", medida: null },
      { alimento: "Couve-flor cozida", medida: null },
      { alimento: "Couve manteiga refogada", medida: null }
    ],

    "BEBIDA VEGETAL / QUEIJO VEGANO": [
      { alimento: "Bebida vegetal de amêndoas", medida: "200 ml / 01 copo de requeijão" },
      { alimento: "Queijo Vegano", medida: "70 g / 02 fatias médias" },
      { alimento: "Bebida vegetal de arroz", medida: "200 ml / 01 copo de requeijão" },
      { alimento: "Bebida vegetal de soja", medida: "200 ml / 01 copo de requeijão" },
      { alimento: "Bebida vegetal de cereais", medida: "200 ml / 01 copo de requeijão" },
      { alimento: "Iogurte Vegetal", medida: "200 ml / 01 unidade" },
      { alimento: "Bebida vegetal de coco", medida: "200 ml / 01 copo de requeijão" }
    ],

    "COMPLEMENTOS": [
      { alimento: "Castanha do Pará", medida: "02 un" },
      { alimento: "Chia", medida: "20 g / 02 colh. de sopa" },
      { alimento: "Castanha de Caju", medida: "25 g / 18 un" },
      { alimento: "Linhaça", medida: "20 g / 02 colh. de sopa" },
      { alimento: "Amêndoas", medida: "25 g / 18 un" },
      { alimento: "Semente de Girassol", medida: "30 g / 02 colh. de sopa" },
      { alimento: "Pistache", medida: "25 g / 18 un" },
      { alimento: "Semente de Abóbora", medida: "30 g / 02 colh. de sopa" },
      { alimento: "Nozes", medida: "25 g / 18 un" },
      { alimento: "Gergelim", medida: "20 g / 01 colh. de sopa cheia" },
      { alimento: "Amendoim", medida: "25 g / 18 un" },
      { alimento: "Macadâmia", medida: "25 g / 18 un" }
    ],

    "OPÇÕES DE DOCES": [
      { alimento: "Frutas Secas", medida: "20 gramas" },
      { alimento: "Gelatina", medida: "200 ml" },
      { alimento: "Banana com canela no microondas", medida: null },
      { alimento: "Chocolate 70% cacau", medida: null },
      { alimento: "Doces da Flormel", medida: null }
    ]
  },

  notasSubstituicoes: {
    "GRUPO DAS PROTEÍNAS – gramas indicada no plano alimentar":
      "Tirar a gordura aparente das proteínas antes do preparo, evitar as frituras, dar preferência às preparações assadas, grelhadas ou cozidas, usar pouco óleo e evitar o uso de temperos prontos.",
    "COMPLEMENTOS":
      "Os complementos poderão ser utilizados em saladas e acrescentados nos lanches da tarde."
  },

  refeicaoLivre: "Planeje sua refeição livre: você tem 4 a 6 refeições livres no mês, para consumir alimentos que gosta muito, como por exemplo pastel, pizza (até 3 pedaços), churrasco, doce. Escolha em qual refeição você irá comer algum desses alimentos: café da manhã, almoço, lanche ou jantar. Em seguida, retome o planejamento.",

  orientacoes: [
    "Pese os alimentos prontos para ter certeza da quantidade ingerida.",
    "Faça suas refeições de forma tranquila, de preferência sentado à mesa, sem distrações (celular, TV).",
    "Comer devagar e mastigar bem os alimentos.",
    "Fazer 5 a 6 refeições/dia, respeitando os horários. Evitar pular refeições.",
    "Combine os alimentos, procurando não misturar dois tipos de carboidratos na mesma refeição.",
    "Evitar beliscar ou petiscar alimentos fora do plano alimentar.",
    "Começar as refeições preferencialmente com saladas cruas ou frutas.",
    "Preferir os óleos vegetais.",
    "Dar preferência às carnes brancas e magras, evitando a pele de frango e peixe.",
    "Usar queijos magros (ricota, minas, quark, requeijão light), leite e iogurtes desnatados.",
    "Evitar: banha, toucinho, bacon, embutidos em geral (esses contêm, além de gordura, muito sal).",
    "Substituir os doces e sobremesas por frutas.",
    "Consumir fibras, ingerindo frutas e verduras cruas, cereais integrais (pão de centeio, arroz integral, aveia, farelos de trigo e aveia).",
    "Aumentar a ingestão de líquidos, principalmente água e sucos naturais (como laranja, acerola, abacaxi, caju, limão, mexerica, morango) e chás.",
    "Na última refeição do dia dê preferência a alimentos mais leves.",
    "Evitar o excesso de sal e principalmente o saleiro de mesa.",
    "Ler os rótulos dos alimentos.",
    "Manter atividade física regular."
  ],

  links: [
    { nome: "Dux Nutrition (whey protein)", url: "https://www.duxnutrition.com/", cupom: "PACNOEMIPASQUALI", desconto: "20%" },
    { nome: "Vitafor (whey protein)", url: "https://www.vitafor.com.br/", cupom: "NP62643VITAFOR", desconto: "25%" },
    { nome: "Panelinha Fit (marmitas fitness)", url: "https://panelinhafit.com.br/", cupom: "pasquali20", desconto: "20% em todo o site, menos kits de marmitas" }
  ],

  mensagemAbertura: "Esse processo é uma caminhada e não uma corrida, portanto tenha calma que os resultados estão por vir e estamos juntos nesta jornada."
};

/*
 * Estimativas de macros por refeição — e por variante, na ordem em que as
 * variantes aparecem no plano. Calculadas a partir dos alimentos do plano
 * (escolha "típica" em cada grupo). São APROXIMAÇÕES, não valores oficiais
 * da nutricionista. gord = gordura; valores em gramas; kcal arredondado.
 * (Copiado do App_Dieta.)
 */
export const MACROS = {
  cafe:   [{ kcal: 380, prot: 43, carb: 28, gord: 11 }],
  almoco: [{ kcal: 620, prot: 48, carb: 72, gord: 16 }],
  lanche: [{ kcal: 280, prot: 18, carb: 31, gord: 9 },
           { kcal: 340, prot: 34, carb: 43, gord: 4 }],
  jantar: [{ kcal: 530, prot: 47, carb: 50, gord: 16 },
           { kcal: 450, prot: 37, carb: 34, gord: 18 }]
};

export const ROTULO_CURTO = {
  cafe:   "Café",
  almoco: "Almoço",
  lanche: "Lanche",
  jantar: "Jantar"
};

export const ROTULO_HORA = {
  cafe:   "até 10h",
  almoco: "10–15h",
  lanche: "15–19h",
  jantar: "19h+"
};
