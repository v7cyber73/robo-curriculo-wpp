const express = require('express');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ======================================================
// SESSÕES DO SIMULADOR
// ======================================================
const sessions = new Map();
let adminMessages = [];

function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, {
      step: 'idle',
      menuExibido: false,
      menuPendente: false,
      data: {
        experiencias: [],
        cursos: []
      },
      expTemp: {},
      cursoTemp: {}
    });
  }
  return sessions.get(id);
}

// ======================================================
// VALIDAÇÕES
// ======================================================
function validarDataNascimento(txt) {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(txt))
    return { ok: false, erro: 'Formato deve ser DD/MM/AAAA' };

  const [d, m, a] = txt.split('/').map(Number);

  if (m < 1 || m > 12)
    return { ok: false, erro: 'Mês inválido' };

  if (a < 1920 || a > new Date().getFullYear())
    return { ok: false, erro: 'Ano inválido' };

  const dias = [
    31,
    (a % 4 === 0 && a % 100 !== 0 || a % 400 === 0) ? 29 : 28,
    31,30,31,30,31,31,30,31,30,31
  ];

  if (d < 1 || d > dias[m - 1])
    return { ok: false, erro: 'Dia inválido para o mês informado' };

  const hoje = new Date();
  const nasc = new Date(a, m - 1, d);

  if (nasc > hoje)
    return { ok: false, erro: 'Data de nascimento não pode ser no futuro' };

  let idade = hoje.getFullYear() - a;
  if (
    hoje.getMonth() < m - 1 ||
    (hoje.getMonth() === m - 1 && hoje.getDate() < d)
  ) idade--;

  if (idade < 12)
    return { ok: false, erro: 'Idade mínima 12 anos' };

  if (idade > 100)
    return { ok: false, erro: 'Verifique a data de nascimento' };

  return { ok: true, idade };
}

function validarDataExp(txt) {
  const lower = txt.toLowerCase().trim();

  if (['atual','presente','hoje','atualmente','atualidade'].includes(lower))
    return { ok: true, valor: 'Atual' };

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(txt)) {
    const [d,m,a] = txt.split('/').map(Number);
    const dias = [
      31,
      (a % 4 === 0 && a % 100 !== 0 || a % 400 === 0) ? 29 : 28,
      31,30,31,30,31,31,30,31,30,31
    ];
    if (m < 1 || m > 12 || d < 1 || d > dias[m-1])
      return { ok:false, erro:'Data inválida' };
    return { ok:true, valor:txt };
  }

  if (/^\d{2}\/\d{4}$/.test(txt)) {
    const [m,a] = txt.split('/').map(Number);
    if (m < 1 || m > 12)
      return { ok:false, erro:'Mês inválido' };
    return { ok:true, valor:txt };
  }

  return {
    ok:false,
    erro:'Use MM/AAAA, DD/MM/AAAA ou digite atual'
  };
}

function validarEstadoCivil(txt) {
  const lower = txt.toLowerCase().trim();
  const opcoes = {
    solteiro:'Solteiro(a)',
    solteira:'Solteiro(a)',
    casado:'Casado(a)',
    casada:'Casado(a)',
    divorciado:'Divorciado(a)',
    divorciada:'Divorciado(a)',
    viuvo:'Viúvo(a)',
    viúvo:'Viúvo(a)',
    viuva:'Viúvo(a)',
    viúva:'Viúvo(a)',
    separado:'Separado(a)',
    separada:'Separado(a)',
    'uniao estavel':'União Estável',
    'união estável':'União Estável'
  };

  if (opcoes[lower]) return { ok:true, valor:opcoes[lower] };

  for (const k of Object.keys(opcoes)) {
    if (lower.includes(k))
      return { ok:true, valor:opcoes[k] };
  }

  return { ok:false };
}

function validarAno(txt) {
  if (!/^\d{4}$/.test(txt))
    return { ok:false, erro:'Digite o ano com 4 números' };

  const a = Number(txt);
  if (a < 1980 || a > new Date().getFullYear())
    return { ok:false, erro:'Ano inválido' };

  return { ok:true };
}

function formatarCEP(txt) {
  const n = txt.replace(/\D/g,'');
  return n.length === 8 ? n.slice(0,5) + '-' + n.slice(5) : txt;
}

function validarCEP(txt) {
  return /^\d{5}-\d{3}$/.test(txt);
}

function formatarTelefone(txt) {
  const n = txt.replace(/\D/g,'');
  if (n.length === 11)
    return `(${n.slice(0,2)}) ${n.slice(2,7)}-${n.slice(7)}`;
  if (n.length === 10)
    return `(${n.slice(0,2)}) ${n.slice(2,6)}-${n.slice(6)}`;
  return null;
}

function validarTelefone(txt) {
  return /^\(\d{2}\) \d{4,5}-\d{4}$/.test(txt);
}

function validarEmail(txt) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(txt);
}

// ======================================================
// CURRÍCULO FINAL
// ======================================================
function montarCurriculo(jid, d) {
  const exps = d.experiencias.map((e,i) =>
`${i+1}. ${e.empresa.toUpperCase()}
Cargo: ${e.cargo}
Período: ${e.inicio} até ${e.fim}`
  ).join('\n\n') || 'Primeiro emprego';

  const cursos = d.cursos.map((c,i) =>
`${i+1}. ${c.nome} - ${c.instituicao} (${c.ano})`
  ).join('\n') || 'Nenhum';

  const endereco =
`${d.rua}, ${d.numero}${d.complemento ? ' - ' + d.complemento : ''}
- ${d.bairro} - ${d.cidade}/${d.estado}
- CEP ${d.cep}`;

  return `🔔 *NOVO CURRÍCULO - Conexão v7cyber*

*👤 DADOS PESSOAIS*

*Nome:* ${d.nome}
*Nascimento:* ${d.dataNascimento}
*Nacionalidade:* ${d.nacionalidade}
*Estado Civil:* ${d.estadoCivil}
*Idade:* ${d.idade} anos

*Endereço:* ${endereco}
*Telefone:* ${d.telefone}
*Email:* ${d.email}

*🎯 OBJETIVO*
${d.objetivo}

*💼 EXPERIÊNCIAS*
${exps}

*🎓 FORMAÇÃO*
${d.formacao}

*📚 CURSOS*
${cursos}

*💡 HABILIDADES*
${d.habilidades || 'Não informado'}

*📝 RESUMO PROFISSIONAL*
${d.resumo || 'Não informado'}

-------------------------

📱 Candidato: ${jid}
🤖 Conexão v7cyber

*✉️ CARTA DE APRESENTAÇÃO*

Prezados,

Meu nome é ${d.nome}, nascido em ${d.dataNascimento}, ${d.nacionalidade}, ${d.idade} anos, email ${d.email}.

Moro em ${endereco}.

Meu objetivo é atuar como ${d.objetivo}.

${d.experiencias[0]
  ? `Experiência como ${d.experiencias[0].cargo} na ${d.experiencias[0].empresa.toUpperCase()}.`
  : 'Em busca do primeiro emprego.'}

Formação: ${d.formacao}

Telefone: ${d.telefone} | Email: ${d.email}

${d.habilidades ? `Habilidades: ${d.habilidades}` : ''}
${d.resumo ? `Resumo: ${d.resumo}` : ''}

Atenciosamente,

${d.nome}`;
}

// ======================================================
// MENU INICIAL E INFORMAÇÕES DO ATENDIMENTO
// ======================================================

function menuPrincipal() {
  return `👋 Olá! Seja bem-vindo à *v7cyber* 🤖

*Como podemos ajudar?*

1️⃣ Horário de Funcionamento
2️⃣ Localização
3️⃣ Tabela de Preços
4️⃣ Criar Currículo
5️⃣ Chave Pix

Digite *1, 2, 3, 4 ou 5* para escolher.
Durante a conversa, você pode digitar *menu* para ver estas opções novamente.`;
}

function respostaMenu(opcao) {
  switch (opcao) {
    case '1':
      return `🕐 *HORÁRIO DE ATENDIMENTO*

📍 Rua Três Américas, 403 — Mauá/SP

🗓️ Segunda a sexta: *10h às 17h*
🗓️ Sábado: *10h às 13h*
🍽️ Não fechamos para almoço.

Digite *menu* para voltar às opções.`;

    case '2':
      return `📍 *LOCALIZAÇÃO*

*v7cyber*
Rua Três Américas, 403
Mauá — SP

Digite *menu* para voltar às opções.`;

    case '3':
      return `💰 *TABELA DE PREÇOS*
📍 Rua Três Américas, 403 — Mauá/SP

🖨️ *XEROX E IMPRESSÃO*
Xerox P&B — *R$ 0,75*
Xerox colorida — *R$ 1,00*
Impressão P&B — *R$ 1,00*
Frente e verso — *R$ 1,15*

📄 *SCANNER*
Até 3 folhas — *R$ 2,00*
Até 8 folhas — *R$ 5,00*
Acima de 8 folhas — *R$ 8,00*
📲 Envio pelo WhatsApp incluso.

📋 *CURRÍCULO*
Currículo — *R$ 8,00*
⏱️ Prazo: até 2 horas
✅ Primeiro emprego e Jovem Aprendiz

💻 *SERVIÇOS DIGITAIS*
Segunda via de contas — *R$ 5,00*
Consulta na internet — *R$ 3,00*
Impressão de consulta — *R$ 1,00 por folha*
Boletim de Ocorrência — *R$ 7,00*
Abertura de MEI — *R$ 10,00*
Nota Fiscal NFS-e — *R$ 5,00*

📱 *CADASTROS E SERVIÇOS*
Gov.br — *R$ 5,00*
Meu INSS — *R$ 5,00*
CNIS — *R$ 5,00*
CNH Digital — *R$ 5,00*
Carteira de Trabalho Digital — *R$ 5,00*
Agendamento Poupatempo — *R$ 5,00*
Outros Cadastros e Agendamentos — *R$ 5,00*

💳 *PAGAMENTO*
Pix • Dinheiro • Cartão

❌ *NÃO FAZEMOS*
Plastificação
Foto 3x4
Encadernação
Entregas

Digite *menu* para voltar às opções.`;

    case '5':
      return `💳 *CHAVE PIX*

🔑 *Chave:* 12123718000154
👤 *Titular:* Jefferson Alessandro Rossi
🏦 *Banco:* Nubank

Digite *menu* para voltar às opções.`;

    default:
      return null;
  }
}
function respostaSimNao(txt) {
  const lower = txt.toLowerCase().trim();

  if (['1', 'sim', 's', 'yes'].includes(lower))
    return 'sim';

  if (['2', 'não', 'nao', 'n', 'no'].includes(lower))
    return 'nao';

  if (['3', 'pular', 'skip'].includes(lower))
    return 'pular';

  return null;
}

// ======================================================
// MOTOR DO BOT
// ======================================================
async function processarMensagem(jid, txt) {
  const lower = txt.toLowerCase().trim();
  const respostas = [];
  const s = getSession(jid);
  const d = s.data;

  // ======================================================
  // MENU INICIAL
  // Qualquer primeira mensagem mostra o menu.
  // Os números 1/2/3/4 só são opções logo após o menu ser exibido.
  // Fora desse momento, todos os números seguem como conversa normal.
  // ======================================================

  if (s.step === 'idle') {
    // Comandos para abrir o menu novamente a qualquer momento.
    if (lower === 'menu' || lower === 'voltar' || lower === 'inicio' || lower === 'início') {
      s.menuExibido = true;
      s.menuPendente = true;
      return [menuPrincipal()];
    }

    // TODOS os números do menu (1, 2, 3 e 4) só funcionam se o menu
    // acabou de ser exibido e ainda aguarda uma escolha. Fora disso,
    // números como 1, 2, 3 ou 4 não acionam nenhuma opção.
    if (s.menuPendente && ['1', '2', '3'].includes(lower)) {
      s.menuPendente = false;
      s.menuExibido = true;
      return [respostaMenu(lower)];
    }

    if (s.menuPendente && lower === '5') {
      s.menuPendente = false;
      s.menuExibido = true;
      return [respostaMenu('5')];
    }

    if (s.menuPendente && lower === '4') {
      s.menuPendente = false;
      sessions.set(jid, {
        step:'nome',
        menuExibido:true,
        data:{ experiencias:[], cursos:[] },
        expTemp:{},
        cursoTemp:{}
      });

      return [`👋 Olá! Sou o Robô da Conexão v7cyber 🤖

Vamos montar seu currículo profissional!

💡 A qualquer momento digite *sair* ou *cancelar* para cancelar.

1️⃣ Qual seu nome e sobrenome completo?`];
    }

    // Permite iniciar o currículo digitando o nome da opção.
    const gatilhoInicial =
      lower.includes('criar curriculum') ||
      lower.includes('criar curriculo') ||
      lower.includes('criar currículo') ||
      (lower.includes('criar') && lower.includes('curric')) ||
      lower === 'curriculo' ||
      lower === 'curriculum';

    if (gatilhoInicial) {
      sessions.set(jid, {
        step:'nome',
        menuExibido:true,
        data:{ experiencias:[], cursos:[] },
        expTemp:{},
        cursoTemp:{}
      });

      return [`👋 Olá! Sou o Robô da Conexão v7cyber 🤖

Vamos montar seu currículo profissional!

💡 A qualquer momento digite *sair* ou *cancelar* para cancelar.

1️⃣ Qual seu nome e sobrenome completo?`];
    }

    // Primeira mensagem: mostra o menu e aguarda uma escolha.
    if (!s.menuExibido) {
      s.menuExibido = true;
      s.menuPendente = true;
      return [menuPrincipal()];
    }

    // Se a pessoa enviar texto fora do menu, encerra a espera pela escolha.
    // Assim, números enviados durante uma conversa não acionam opções por engano.
    s.menuPendente = false;
    return [];
  }

  const sair = [
    'sair','cancelar','parar','desistir',
    'exit','cancel','stop','sai','cancela'
  ];

  if (
    sair.includes(lower) ||
    lower.includes('quero sair') ||
    lower.includes('quero cancelar')
  ) {
    sessions.delete(jid);
    return ['❌ Cadastro cancelado com sucesso!\n\nSe quiser recomeçar, digite *Criar Curriculum*'];
  }

  const gatilho =
    lower.includes('criar curriculum') ||
    lower.includes('criar curriculo') ||
    lower.includes('criar currículo') ||
    (lower.includes('criar') && lower.includes('curric')) ||
    lower === 'curriculo' ||
    lower === 'curriculum';

  if (gatilho) {
    sessions.set(jid, {
      step:'nome',
      data:{ experiencias:[], cursos:[] },
      expTemp:{},
      cursoTemp:{}
    });

    return [`👋 Olá! Sou o Robô da Conexão v7cyber 🤖

Vamos montar seu currículo profissional!

💡 A qualquer momento digite *sair* ou *cancelar* para cancelar.

1️⃣ Qual seu nome e sobrenome completo?`];
  }

  if (s.step === 'idle')
    return [];

  if (s.step === 'nome') {
    if (txt.split(/\s+/).length < 2)
      return ['⚠️ Digite nome e sobrenome completo.\nEx: João Silva'];

    d.nome = txt;
    s.step = 'nascimento';
    return ['2️⃣ Data de nascimento?\n\n📅 Formato: DD/MM/AAAA\nEx: 15/03/1998'];
  }

  if (s.step === 'nascimento') {
    const v = validarDataNascimento(txt);
    if (!v.ok) return [`⚠️ ${v.erro}\n\nUse DD/MM/AAAA.`];

    d.dataNascimento = txt;
    d.idade = v.idade;
    s.step = 'nacionalidade';
    return ['3️⃣ Nacionalidade?\nEx: Brasileiro'];
  }

  if (s.step === 'nacionalidade') {
    d.nacionalidade = txt;
    s.step = 'estadoCivil';
    return ['4️⃣ Estado civil?\n\nEx: Solteiro, Casado, Divorciado ou União Estável'];
  }

  if (s.step === 'estadoCivil') {
    const v = validarEstadoCivil(txt);
    if (!v.ok)
      return ['⚠️ Estado civil não reconhecido.\nDigite Solteiro, Casado, Divorciado, Viúvo, Separado ou União Estável.'];

    d.estadoCivil = v.valor;
    s.step = 'rua';
    return ['5️⃣ Nome da RUA / Avenida?\nEx: Rua das Flores'];
  }

  if (s.step === 'rua') {
    d.rua = txt;
    s.step = 'numero';
    return ['6️⃣ NÚMERO da casa?\nEx: 123'];
  }

  if (s.step === 'numero') {
    d.numero = txt;
    s.step = 'complemento';
    return ['7️⃣ COMPLEMENTO?\n\nEx: Apto 101, Bloco B\nSe não tiver, digite *não*'];
  }

  if (s.step === 'complemento') {
    d.complemento = ['não','nao','sem','n','nenhum'].includes(lower) ? '' : txt;
    s.step = 'bairro';
    return ['8️⃣ BAIRRO?\nEx: Centro'];
  }

  if (s.step === 'bairro') {
    d.bairro = txt;
    s.step = 'cidade';
    return ['9️⃣ CIDADE?\nEx: São Paulo'];
  }

  if (s.step === 'cidade') {
    d.cidade = txt;
    s.step = 'estado';
    return ['🔟 ESTADO (sigla 2 letras)?\nEx: SP, RJ, MG'];
  }

  if (s.step === 'estado') {
    if (txt.length !== 2)
      return ['⚠️ Digite somente a sigla com 2 letras.\nEx: SP'];

    d.estado = txt.toUpperCase();
    s.step = 'cep';
    return ['1️⃣1️⃣ CEP?\n\nFormato: 00000-000\nEx: 08500-000\n\nPode digitar só números: 08500000'];
  }

  if (s.step === 'cep') {
    const cep = formatarCEP(txt);
    if (!validarCEP(cep))
      return ['⚠️ CEP inválido!\nEx: 08500-000'];

    d.cep = cep;
    s.step = 'telefone';
    return ['1️⃣2️⃣ TELEFONE / WhatsApp?\n\nEx: (11) 94204-7248\nPode digitar só números: 11942047248'];
  }

  if (s.step === 'telefone') {
    let tel = txt;
    const fmt = formatarTelefone(txt);
    if (fmt) tel = fmt;

    if (!validarTelefone(tel))
      return ['⚠️ Telefone inválido!\nEx: (11) 94204-7248'];

    d.telefone = tel;
    s.step = 'email';
    return ['1️⃣3️⃣ EMAIL?\n\nEx: joao@gmail.com'];
  }

  if (s.step === 'email') {
    const email = txt.toLowerCase().trim();
    if (!validarEmail(email))
      return ['⚠️ Email inválido!\nEx: joao@gmail.com'];

    d.email = email;
    s.step = 'objetivo';
    return ['1️⃣4️⃣ Objetivo profissional?\n\nEx: Auxiliar administrativo, Vendedor, Motorista'];
  }

  if (s.step === 'objetivo') {
    d.objetivo = txt;
    s.step = 'exp_empresa';
    return ['1️⃣5️⃣ Nome da última empresa?\n\nSe for seu primeiro emprego digite *primeiro emprego*'];
  }

  if (s.step === 'exp_empresa') {
    if (lower.includes('primeiro')) {
      d.experiencias = [];
      s.step = 'formacao';
      return ['Primeiro emprego 💪\n\nQual sua formação?\nEx: Ensino médio completo, Superior em Administração'];
    }

    s.expTemp.empresa = txt;
    s.step = 'exp_cargo';
    return [`Cargo na ${txt}?`];
  }

  if (s.step === 'exp_cargo') {
    s.expTemp.cargo = txt;
    s.step = 'exp_inicio';
    return ['Data INÍCIO?\nEx: 03/2022 ou 15/03/2022'];
  }

  if (s.step === 'exp_inicio') {
    const v = validarDataExp(txt);
    if (!v.ok) return [`⚠️ Data inválida!\n${v.erro}`];

    s.expTemp.inicio = v.valor;
    s.step = 'exp_fim';
    return ['Data SAÍDA?\nEx: 12/2023\n\nOu digite *atual* se ainda trabalha lá.'];
  }

  if (s.step === 'exp_fim') {
    const v = validarDataExp(txt);
    if (!v.ok) return [`⚠️ Data inválida!\n${v.erro}`];

    s.expTemp.fim = v.valor;
    d.experiencias.push({...s.expTemp});
    s.expTemp = {};
    s.step = 'exp_mais';

    return ['✅ Empresa adicionada!\n\nTem mais empresas?\n\n1️⃣ Sim\n2️⃣ Não\n3️⃣ Pular\n\nVocê também pode digitar sim ou não.'];
  }

  if (s.step === 'exp_mais') {
    const escolha = respostaSimNao(txt);

    if (escolha === 'sim') {
      s.step = 'exp_empresa';
      return ['Próxima empresa?'];
    }

    if (escolha === 'nao' || escolha === 'pular') {
      s.step = 'formacao';
      return ['Qual sua formação?'];
    }

    return ['⚠️ Opção inválida.\n\nDigite:\n1️⃣ Sim\n2️⃣ Não\n3️⃣ Pular'];
  }

  if (s.step === 'formacao') {
    d.formacao = txt;
    s.step = 'curso_pergunta';
    return ['Tem cursos?\n\n1️⃣ Sim\n2️⃣ Não\n3️⃣ Pular\n\nVocê também pode digitar sim ou não.'];
  }

  if (s.step === 'curso_pergunta') {
    const escolha = respostaSimNao(txt);

    if (escolha === 'sim') {
      s.step = 'curso_nome';
      return ['Nome do curso?'];
    }

    if (escolha === 'nao' || escolha === 'pular') {
      s.step = 'habilidades';
      return ['💡 HABILIDADES - Opcional\n\nDigite suas habilidades ou *pular*.'];
    }

    return ['⚠️ Opção inválida.\n\nDigite:\n1️⃣ Sim\n2️⃣ Não\n3️⃣ Pular'];
  }

  if (s.step === 'curso_nome') {
    s.cursoTemp.nome = txt;
    s.step = 'curso_inst';
    return [`Onde fez ${txt}?`];
  }

  if (s.step === 'curso_inst') {
    s.cursoTemp.instituicao = txt;
    s.step = 'curso_ano';
    return ['Ano do curso?\nEx: 2023\n\nSe não lembrar, digite *não lembro*.'];
  }

  if (s.step === 'curso_ano') {
    const la = lower;

    if (la.includes('lembro') || la.includes('sei') || ['nao','não','n'].includes(la)) {
      s.cursoTemp.ano = 'Não informado';
    } else {
      const v = validarAno(txt);
      if (!v.ok) return [`⚠️ Ano inválido!\n${v.erro}`];
      s.cursoTemp.ano = txt;
    }

    d.cursos.push({...s.cursoTemp});
    s.cursoTemp = {};
    s.step = 'curso_mais';

    return ['✅ Curso adicionado!\n\nMais cursos?\n\n1️⃣ Sim\n2️⃣ Não\n3️⃣ Pular\n\nVocê também pode digitar sim ou não.'];
  }

  if (s.step === 'curso_mais') {
    const escolha = respostaSimNao(txt);

    if (escolha === 'sim') {
      s.step = 'curso_nome';
      return ['Próximo curso?'];
    }

    if (escolha === 'nao' || escolha === 'pular') {
      s.step = 'habilidades';
      return ['💡 HABILIDADES - Opcional\n\nDigite suas habilidades ou *pular*.'];
    }

    return ['⚠️ Opção inválida.\n\nDigite:\n1️⃣ Sim\n2️⃣ Não\n3️⃣ Pular'];
  }

  if (s.step === 'habilidades') {
    d.habilidades =
      ['pular','nao','não','n','sem','nenhum'].includes(lower) ||
      lower.includes('pular') ? '' : txt;

    s.step = 'resumo';
    return ['📝 RESUMO PROFISSIONAL - Opcional\n\nDigite seu resumo ou *pular*.'];
  }

  if (s.step === 'resumo') {
    d.resumo =
      ['pular','nao','não','n','sem','nenhum'].includes(lower) ||
      lower.includes('pular') ? '' : txt;

    const curriculo = montarCurriculo(jid, d);

    // Simulação do envio para o número administrador.
    adminMessages.push({
      data: new Date().toLocaleString('pt-BR'),
      candidato: d.nome,
      texto: curriculo
    });

    sessions.delete(jid);

    return [
      `✅ Obrigado, ${d.nome}!\n\nSeu currículo foi recebido com sucesso!\n\n📧 Email: ${d.email}\n📱 Tel: ${d.telefone}\n\n🚀 Conexão v7cyber agradece seu cadastro!`,
      '__CURRICULO_ENVIADO__'
    ];
  }

  return [];
}


// ======================================================
// WHATSAPP REAL — BAILEYS
// ======================================================
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const fs = require('fs');

let qrCodeData = null;
let isConnected = false;
let whatsappSock = null;
let logs = [];

const ADMIN_JID =
  process.env.ADMIN_JID || '5511942047248@s.whatsapp.net';

function log(msg) {
  const linha = `[${new Date().toLocaleString('pt-BR')}] ${msg}`;
  console.log(linha);
  logs.push(linha);
  if (logs.length > 200) logs.shift();
}

async function iniciarWhatsApp() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState('./auth');

    let version;
    try {
      version = (await fetchLatestBaileysVersion()).version;
    } catch (e) {
      version = undefined;
    }

    const sock = makeWASocket({
      ...(version ? { version } : {}),
      auth: state,
      browser: ['Conexão v7cyber', 'Chrome', '1.0.0'],
      markOnlineOnConnect: false
    });

    whatsappSock = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        qrCodeData = qr;
        isConnected = false;
        log('📱 QR Code gerado. Acesse /whatsapp para escanear.');
      }

      if (connection === 'open') {
        isConnected = true;
        qrCodeData = null;
        const numero = sock.user?.id?.split(':')[0] || 'desconhecido';
        log(`✅ WhatsApp conectado: ${numero}`);
      }

      if (connection === 'close') {
        isConnected = false;
        whatsappSock = null;
        log('❌ WhatsApp desconectado. Tentando reconectar em 5 segundos...');
        setTimeout(() => iniciarWhatsApp(), 5000);
      }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
      for (const m of messages) {
        try {
          if (!m.message || m.key.fromMe) continue;

          const jid = m.key.remoteJid;
          if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') continue;

          const txt = (
            m.message.conversation ||
            m.message.extendedTextMessage?.text ||
            ''
          ).trim();

          if (!txt) continue;

          log(`📩 Mensagem de ${jid}: ${txt.substring(0, 80)}`);

          const replies = await processarMensagem(jid, txt);

          for (const reply of replies) {
            if (!reply) continue;

            if (reply === '__CURRICULO_ENVIADO__') {
              continue;
            }

            await sock.sendMessage(jid, { text: reply });
          }

          // Quando o currículo termina, processarMensagem já colocou
          // o currículo na caixa adminMessages. Enviamos o último currículo
          // para o número administrador.
          if (replies.includes('__CURRICULO_ENVIADO__')) {
            const ultimo = adminMessages[adminMessages.length - 1];

            if (ultimo) {
              await sock.sendMessage(ADMIN_JID, {
                text: ultimo.texto
              });

              log(`📤 Currículo de ${ultimo.candidato} enviado para ${ADMIN_JID}`);
            }
          }
        } catch (err) {
          log(`❌ Erro ao processar mensagem: ${err.message}`);
        }
      }
    });

  } catch (err) {
    isConnected = false;
    whatsappSock = null;
    log(`❌ Erro ao iniciar WhatsApp: ${err.message}`);
    setTimeout(() => iniciarWhatsApp(), 5000);
  }
}

// ======================================================
// PAINEL WEB DO RENDER
// ======================================================
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Conexão v7cyber</title>
<style>
body{font-family:Arial,sans-serif;background:#f0f2f5;text-align:center;padding:30px}
.card{max-width:700px;margin:auto;background:white;padding:30px;border-radius:15px;box-shadow:0 3px 15px #bbb}
.ok{color:green}.no{color:#b00020}
a{display:inline-block;margin:8px;padding:12px 18px;background:#128c7e;color:white;text-decoration:none;border-radius:8px}
pre{text-align:left;background:#eee;padding:15px;border-radius:8px;white-space:pre-wrap}
</style>
</head>
<body>
<div class="card">
<h1>🤖 Conexão v7cyber</h1>
<h2 class="${isConnected ? 'ok' : 'no'}">
${isConnected ? '🟢 WhatsApp conectado' : '🔴 WhatsApp aguardando conexão'}
</h2>
<p><b>Administrador:</b> ${ADMIN_JID}</p>
<a href="/whatsapp">📱 Conectar WhatsApp / QR Code</a>
<a href="/logs">📋 Logs</a>
<a href="/status">📊 Status</a>
<pre>${logs.slice(-20).join('\n')}</pre>
</div>
</body>
</html>
  `);
});

app.get('/whatsapp', async (req, res) => {
  if (isConnected) {
    return res.send(`
      <body style="font-family:Arial;text-align:center;padding:40px">
        <h1 style="color:green">✅ WhatsApp conectado</h1>
        <p>O bot está funcionando.</p>
        <a href="/">Voltar</a>
        <pre style="text-align:left;background:#eee;padding:15px">${logs.slice(-20).join('\n')}</pre>
      </body>
    `);
  }

  if (!qrCodeData) {
    return res.send(`
      <body style="font-family:Arial;text-align:center;padding:40px">
        <h1>⏳ Aguardando QR Code...</h1>
        <p>Esta página será atualizada automaticamente.</p>
        <script>setTimeout(()=>location.reload(),3000)</script>
      </body>
    `);
  }

  const img = await QRCode.toDataURL(qrCodeData);

  res.send(`
    <body style="font-family:Arial;text-align:center;padding:30px">
      <h1>📱 Conectar WhatsApp</h1>
      <p>Abra o WhatsApp no celular → Aparelhos conectados → Conectar aparelho</p>
      <img src="${img}" style="width:350px;max-width:90%;border:10px solid #25D366;border-radius:15px">
      <p>Depois de escanear, aguarde a conexão.</p>
      <a href="/">Voltar</a>
      <script>setTimeout(()=>location.reload(),5000)</script>
    </body>
  `);
});

app.get('/qr', async (req, res) => {
  if (isConnected) return res.send('<h1 style="color:green">✅ CONECTADO</h1>');
  if (!qrCodeData) return res.send('<h1>⏳ Aguardando QR Code...</h1>');

  const img = await QRCode.toDataURL(qrCodeData);
  res.send(`
    <body style="text-align:center;font-family:Arial">
      <h1>📱 Escaneie o QR Code</h1>
      <img src="${img}" style="width:350px">
    </body>
  `);
});

app.get('/status', (req, res) => {
  res.json({
    connected: isConnected,
    hasQR: !!qrCodeData,
    uptime: process.uptime(),
    adminJid: ADMIN_JID
  });
});

app.get('/logs', (req, res) => {
  res.send(`
    <body style="font-family:Arial;padding:20px">
      <h1>📋 Logs</h1>
      <pre>${logs.join('\n')}</pre>
      <a href="/">Voltar</a>
    </body>
  `);
});

app.get('/admin', (req, res) => {
  res.json(adminMessages);
});

app.listen(PORT, () => {
  log(`🚀 Servidor rodando na porta ${PORT}`);
  log(`📱 QR Code: /whatsapp`);
  log(`📤 Administrador: ${ADMIN_JID}`);
  iniciarWhatsApp();
});