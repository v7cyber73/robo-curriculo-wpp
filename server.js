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
  return `👋 Olá! Seja bem-vindo à *Conexão v7cyber* 🤖

Como podemos ajudar?

1️⃣ Horário de Funcionamento
2️⃣ Localização
3️⃣ Tabela de Preços
4️⃣ Criar Currículo

💬 Digite o número da opção desejada.

Se você digitar outra coisa, sua mensagem continuará normalmente no WhatsApp.`;
}

function respostaMenu(opcao) {
  switch (opcao) {
    case '1':
      return `🕐 *HORÁRIO DE ATENDIMENTO*

📍 Rua Três Américas, 403 — Mauá/SP

*Segunda a sexta:* até *17h*
*Sábado:* *10h às 17h*

🍽️ *Não fechamos para almoço*

Para voltar ao menu principal, digite *menu*.`;

    case '2':
      return `📍 *LOCALIZAÇÃO*

*Conexão v7cyber*

📍 *Rua Três Américas, 403 — Mauá/SP*

Para voltar ao menu principal, digite *menu*.`;

    case '3':
      return `💰 *TABELA DE PREÇOS*

📍 Rua Três Américas, 403 — Mauá/SP

🖨️ *XEROX E IMPRESSÃO*

*Xerox P&B* ......................... *R$ 0,75*
*Xerox Colorida* ................... *R$ 1,00*
*Impressão P&B* .................... *R$ 1,00*
*Frente e Verso* ................... *R$ 1,15*

📄 *SCANNER*

*Até 3 folhas* ...................... *R$ 2,00*
*Até 8 folhas* ...................... *R$ 5,00*
*Acima de 8 folhas* .............. *R$ 8,00*

📲 *Envio pelo WhatsApp: INCLUSO*

📋 *CURRÍCULO*

*Currículo* .......................... *R$ 8,00*

⏱️ Prazo: *até 2 horas*
✅ Primeiro Emprego
✅ Jovem Aprendiz

💻 *SERVIÇOS DIGITAIS*

*Segunda via de contas* ........ *R$ 5,00*

*Consultas na internet* ........ *R$ 3,00*
• *R$ 1,00 por impressão*

Exemplo: consulta + 10 folhas impressas = *R$ 13,00*

*Boletim de Ocorrência* ........ *R$ 7,00*
*Abertura de MEI* ................ *R$ 10,00*
*Nota Fiscal NFS-e* ............... *R$ 5,00*

📱 *CADASTROS E SERVIÇOS*

*Gov.br*
*Meu INSS*
*CNIS*
*CNH Digital*
*Carteira de Trabalho Digital*

*R$ 5,00*

*Agendamento Poupatempo* .... *R$ 5,00*

💳 *PAGAMENTO*

*Pix • Dinheiro • Cartão*

❌ *NÃO FAZEMOS*

❌ Plastificação
❌ Foto 3x4
❌ Encadernação
❌ Entregas

Para voltar ao menu principal, digite *menu*.`;

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
  // Depois, somente 1/2/3/4 são tratados como menu.
  // Qualquer outra mensagem segue normalmente.
  // ======================================================

  if (s.step === 'idle') {
    if (lower === 'menu' || lower === 'voltar' || lower === 'inicio' || lower === 'início') {
      return [menuPrincipal()];
    }

    if (['1', '2', '3'].includes(lower)) {
      return [respostaMenu(lower)];
    }

    if (lower === '4') {
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

    // Qualquer outra mensagem inicia mostrando o menu.
    return [menuPrincipal()];
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
// API DO SIMULADOR
// ======================================================
app.post('/api/message', async (req, res) => {
  const jid = req.body.jid || '5511999999999';
  const text = String(req.body.text || '').trim();

  if (!text)
    return res.json({ replies: [] });

  const replies = await processarMensagem(jid, text);

  res.json({
    replies,
    adminCount: adminMessages.length
  });
});

app.get('/api/admin', (req, res) => {
  res.json(adminMessages);
});

app.post('/api/reset', (req, res) => {
  sessions.clear();
  adminMessages = [];
  res.json({ ok:true });
});

// ======================================================
// INTERFACE WEB — SIMULAÇÃO DO WHATSAPP
// ======================================================
app.get('/', (req, res) => {
res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WhatsApp - Simulador Conexão v7cyber</title>
<style>
*{box-sizing:border-box}
body{
  margin:0;
  font-family:Arial,sans-serif;
  background:#d9dbd5;
}
.top{
  background:#075e54;
  color:white;
  padding:14px 20px;
  display:flex;
  justify-content:space-between;
  align-items:center;
}
.top b{font-size:18px}
.container{
  max-width:1100px;
  margin:20px auto;
  display:grid;
  grid-template-columns:1fr 380px;
  gap:20px;
}
.phone{
  background:#efeae2;
  border-radius:12px;
  overflow:hidden;
  box-shadow:0 4px 20px #777;
  min-height:720px;
  display:flex;
  flex-direction:column;
}
.chathead{
  background:#075e54;
  color:#fff;
  padding:12px 16px;
}
.chathead small{opacity:.8}
.chat{
  flex:1;
  padding:20px;
  overflow-y:auto;
  min-height:560px;
  background:
    radial-gradient(#ddd 1px,transparent 1px);
  background-size:20px 20px;
}
.msg{
  max-width:82%;
  padding:10px 12px;
  margin:8px 0;
  border-radius:8px;
  white-space:pre-wrap;
  line-height:1.4;
  box-shadow:0 1px 1px #bbb;
}
.bot{
  background:white;
  margin-right:auto;
}
.user{
  background:#dcf8c6;
  margin-left:auto;
}
.input{
  display:flex;
  padding:10px;
  background:#f0f0f0;
  gap:8px;
}
.input input{
  flex:1;
  padding:13px;
  border:0;
  border-radius:22px;
  outline:none;
  font-size:15px;
}
button{
  border:0;
  border-radius:22px;
  padding:0 18px;
  background:#128c7e;
  color:white;
  cursor:pointer;
  font-weight:bold;
}
.panel{
  background:white;
  border-radius:12px;
  padding:18px;
  box-shadow:0 3px 12px #aaa;
}
.panel h2{margin-top:0}
.status{
  padding:10px;
  background:#e8f5e9;
  border-radius:8px;
  margin-bottom:12px;
}
.admin{
  background:#f5f5f5;
  padding:12px;
  border-radius:8px;
  max-height:560px;
  overflow:auto;
}
.adminMsg{
  background:white;
  padding:12px;
  margin-bottom:10px;
  border-radius:8px;
  border-left:4px solid #128c7e;
}
pre{
  white-space:pre-wrap;
  font-family:Arial;
}
.reset{
  background:#777;
  margin-top:10px;
  width:100%;
  padding:12px;
}
@media(max-width:850px){
  .container{grid-template-columns:1fr;margin:10px}
}
</style>
</head>
<body>

<div class="top">
  <b>🤖 Conexão v7cyber — Simulador</b>
  <span>🟢 Modo TESTE</span>
</div>

<div class="container">

<div class="phone">
  <div class="chathead">
    <b>Conexão v7cyber</b><br>
    <small>Simulação local — nenhum WhatsApp real conectado</small>
  </div>

  <div id="chat" class="chat">
    <div class="msg bot">
👋 Olá! Este é o simulador do WhatsApp.

Envie qualquer mensagem para visualizar o menu de atendimento.
    </div>
  </div>

  <div class="input">
    <input id="message" placeholder="Digite sua mensagem..." autocomplete="off">
    <button onclick="sendMessage()">Enviar</button>
  </div>
</div>

<div class="panel">
  <h2>📥 Caixa do administrador</h2>

  <div class="status">
    🟢 <b>Modo local</b><br>
    Nenhum WhatsApp foi conectado.<br>
    Os currículos são simulados nesta tela.
  </div>

  <p>
    <b>Destino simulado:</b><br>
    55 11 94204-7248
  </p>

  <div id="admin" class="admin">
    <p>Nenhum currículo recebido ainda.</p>
  </div>

  <button class="reset" onclick="resetTest()">
    🔄 Reiniciar teste
  </button>
</div>

</div>

<script>
const input = document.getElementById('message');
const chat = document.getElementById('chat');

input.addEventListener('keydown', e => {
  if(e.key === 'Enter') sendMessage();
});

function addMessage(text, type){
  const div = document.createElement('div');
  div.className = 'msg ' + type;
  div.textContent = text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

async function sendMessage(){
  const text = input.value.trim();
  if(!text) return;

  addMessage(text,'user');
  input.value='';
  input.focus();

  const r = await fetch('/api/message',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      jid:'5511999999999',
      text
    })
  });

  const data = await r.json();

  for(const reply of data.replies){
    if(reply === '__CURRICULO_ENVIADO__'){
      addMessage('📤 Currículo enviado para a CAIXA DO ADMINISTRADOR (simulação).','bot');
    }else{
      addMessage(reply,'bot');
    }
  }

  loadAdmin();
}

async function loadAdmin(){
  const r = await fetch('/api/admin');
  const data = await r.json();
  const admin = document.getElementById('admin');

  if(!data.length){
    admin.innerHTML='<p>Nenhum currículo recebido ainda.</p>';
    return;
  }

  admin.innerHTML='';

  data.slice().reverse().forEach((item,index)=>{
    const div=document.createElement('div');
    div.className='adminMsg';

    const title=document.createElement('b');
    title.textContent='📄 ' + item.candidato;

    const date=document.createElement('small');
    date.style.display='block';
    date.style.margin='5px 0 10px';
    date.textContent=item.data;

    const pre=document.createElement('pre');
    pre.textContent=item.texto;

    div.appendChild(title);
    div.appendChild(date);
    div.appendChild(pre);
    admin.appendChild(div);
  });
}

async function resetTest(){
  await fetch('/api/reset',{method:'POST'});
  location.reload();
}
</script>

</body>
</html>`);
});

app.listen(PORT, () => {
  console.log('');
  console.log('==============================================');
  console.log(' 🤖 CONEXÃO V7CYBER - SIMULADOR WHATSAPP');
  console.log('==============================================');
  console.log(`🟢 Servidor: http://localhost:${PORT}`);
  console.log(`📱 Simulador: http://localhost:${PORT}/`);
  console.log('🚫 Nenhum WhatsApp real conectado');
  console.log('==============================================');
});
