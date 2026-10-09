const express = require('express');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ======================================================
// PROTEÇÃO DO PAINEL ADMINISTRATIVO
// Configure ADMIN_PASSWORD nas variáveis de ambiente do Render.
// Não coloque a senha diretamente neste arquivo.
// ======================================================
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

function compararSeguramente(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function protegerPainel(req, res, next) {
  if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) {
    return res.status(503).send(
      'Painel bloqueado: configure ADMIN_PASSWORD com pelo menos 12 caracteres nas variáveis de ambiente do Render.'
    );
  }

  const header = req.headers.authorization || '';
  if (header.startsWith('Basic ')) {
    let credenciais = '';
    try {
      credenciais = Buffer.from(header.slice(6), 'base64').toString('utf8');
    } catch (_) {}
    const separador = credenciais.indexOf(':');
    if (separador >= 0) {
      const usuario = credenciais.slice(0, separador);
      const senha = credenciais.slice(separador + 1);
      if (compararSeguramente(usuario, ADMIN_USER) && compararSeguramente(senha, ADMIN_PASSWORD)) {
        return next();
      }
    }
  }

  res.set('WWW-Authenticate', 'Basic realm="Painel Conexão v7cyber", charset="UTF-8"');
  return res.status(401).send('Acesso restrito. Informe o usuário e a senha do painel.');
}

// Protege o painel e as páginas administrativas.
// /status fica público para o UptimeRobot, sem expor credenciais ou dados administrativos.
app.get('/', protegerPainel, (req, res, next) => next());
app.use(['/whatsapp', '/qr', '/logs', '/admin'], protegerPainel);

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
      lastActivityAt: 0,
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
// CADASTRO PARA CONTRATO DE LOCAÇÃO
// ======================================================
function valorPorExtenso(valor) {
  const bruto = String(valor).trim();
  const numero = Number(bruto.includes(',') ? bruto.replace(/\./g, '').replace(',', '.') : bruto);
  if (!Number.isFinite(numero) || numero < 0 || numero >= 1000000) return '';
  const totalCentavos = Math.round(numero * 100);
  const inteiro = Math.floor(totalCentavos / 100);
  const centavos = totalCentavos % 100;
  const un = 'zero um dois tres quatro cinco seis sete oito nove dez onze doze treze quatorze quinze'.split(' ');
  const teen = ['dezesseis','dezessete','dezoito','dezenove'];
  const dez = ['','','vinte','trinta','quarenta','cinquenta','sessenta','setenta','oitenta','noventa'];
  const cen = ['','cento','duzentos','trezentos','quatrocentos','quinhentos','seiscentos','setecentos','oitocentos','novecentos'];
  function grupo(n) {
    if (n < 16) return un[n];
    if (n < 20) return teen[n-16];
    if (n < 100) return dez[Math.floor(n/10)] + (n%10 ? ' e ' + grupo(n%10) : '');
    if (n === 100) return 'cem';
    if (n < 1000) return cen[Math.floor(n/100)] + (n%100 ? ' e ' + grupo(n%100) : '');
    if (n < 1000000) { const mil=Math.floor(n/1000), resto=n%1000; return (mil===1?'mil':grupo(mil)+' mil') + (resto ? (resto<100 || resto%100===0 ? ' e ' : ' ') + grupo(resto) : ''); }
    return String(n);
  }
  const reais = inteiro === 1 ? ' real' : ' reais';
  let resultado = grupo(inteiro) + reais;
  if (centavos) resultado += ' e ' + grupo(centavos) + (centavos === 1 ? ' centavo' : ' centavos');
  return resultado;
}

const regrasContrato = [
  'Animais de estimação',
  'Som alto e perturbação do sossego',
  'Mudanças e movimentação de móveis',
  'Uso de áreas comuns',
  'Reformas e alterações no imóvel',
  'Vagas de garagem',
  'Outras condições específicas'
];

function perguntasPessoa(tipo, numero) {
  const titulo = tipo === 'locador' ? 'LOCADOR' : 'LOCATÁRIO';
  const sufixo = numero === 1 ? '' : String(numero);
  return [
    ['nome','Nome completo','text'], ['nacionalidade','Nacionalidade','text'],
    ['estadoCivil','Estado civil','text'], ['profissao','Profissão','text'],
    ['rg','RG','text'], ['cpf','CPF','cpf'],
    ['endereco','Endereço completo','text'], ['email','E-mail (ou digite pular)','emailOptional'],
    ['telefone','Telefone (ou digite pular)','phoneOptional']
  ].map(([key,label,type]) => ({
    key: `${tipo}${sufixo}_${key}`, label: `${titulo}${numero > 1 ? ' '+numero : ''} — ${label}`,
    type, optional: type.endsWith('Optional')
  }));
}

function perguntasContrato() {
  return [
    ...perguntasPessoa('locador', 1),
    {key:'addLocador',label:'Há outro locador?',type:'yesno'},
    ...perguntasPessoa('locatario', 1),
    {key:'addLocatario',label:'Há outro locatário?',type:'yesno'},
    {key:'tipoImovel',label:'Tipo do imóvel',type:'choice',options:['Casa','Apartamento']},
    {key:'enderecoImovel',label:'Endereço completo do imóvel',type:'text'},
    {key:'finalidade',label:'Finalidade da locação',type:'choice',options:['Residencial','Comercial','Outra finalidade']},
    {key:'moveis',label:'O imóvel possui móveis?',type:'choice',options:['Sim, mobiliado','Não, sem móveis','Parcialmente mobiliado']},
    {key:'prazoMeses',label:'Prazo do contrato em meses',type:'positiveNumber'},
    {key:'dataInicio',label:'Data de início (DD/MM/AAAA)',type:'date'},
    {key:'dataTermino',label:'Data de término (DD/MM/AAAA)',type:'date'},
    {key:'aluguel',label:'Valor mensal do aluguel em reais (ex.: 1250,00)',type:'money'},
    {key:'vencimento',label:'Dia de vencimento do aluguel (1 a 31)',type:'dueDay'},
    {key:'formaPagamento',label:'Forma de pagamento',type:'text'},
    {key:'dadosPagamento',label:'Dados bancários ou chave Pix (opcional; digite pular se não houver)',type:'optionalText',optional:true},
    {key:'garantia',label:'Modalidade de garantia',type:'choice',options:['Sem garantia','Caução','Fiador','Seguro-fiança']},
    {key:'regras',label:'Condições específicas',type:'rules'}
  ];
}

function iniciarContrato(jid) {
  const sessao = {
    jid, step:'contrato', menuExibido:true, menuPendente:false, lastActivityAt:Date.now(),
    data:{ contrato:{}, contractQuestions:perguntasContrato(), contractIndex:0 },
    expTemp:{}, cursoTemp:{}
  };
  sessions.set(jid, sessao);
  return ['🏠 *CADASTRO PARA CONTRATO DE LOCAÇÃO*\n\nVou fazer as perguntas e enviar os dados preenchidos ao administrador pelo WhatsApp.\n\nDigite *sair* ou *cancelar* a qualquer momento.\n\n' + perguntaContrato(sessao)];
}

function perguntaContrato(s) {
  const q = s.data.contractQuestions[s.data.contractIndex];
  if (!q) return '';
  if (q.type === 'yesno') return `*${q.label}*\n\n1️⃣ Sim\n2️⃣ Não`;
  if (q.type === 'choice') return `*${q.label}*\n\n${q.options.map((x,i)=>`${i+1}️⃣ ${x}`).join('\n')}\n\nDigite o número da opção.`;
  if (q.type === 'rules') return `*${q.label}*\n\nDigite os números das regras separados por vírgula:\n${regrasContrato.map((x,i)=>`${i+1}️⃣ ${x}`).join('\n')}\n\nDigite *0* se não quiser adicionar regras.`;
  return `*${q.label}*${q.optional ? '\n\nSe não se aplicar, digite *pular*.' : ''}`;
}

function validarCPF(valor) {
  const cpf = String(valor).replace(/\D/g,'');
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  for (let t=9;t<11;t++) {
    let soma=0;
    for (let i=0;i<t;i++) soma += Number(cpf[i]) * (t+1-i);
    if (Number(cpf[t]) !== ((soma*10)%11)%10) return false;
  }
  return true;
}


function processarContrato(s, txt) {
  const d = s.data.contrato;
  const q = s.data.contractQuestions[s.data.contractIndex];
  const v = txt.trim();
  const low = v.toLowerCase();
  if (!q) return finalizarContrato(s);
  let answer = v;
  if (q.optional && ['pular','não','nao','n','nenhum'].includes(low)) answer = '';
  if (q.type === 'text' && !v) return ['⚠️ Este campo é obrigatório. Digite uma resposta para continuar.'];
  if (q.type === 'yesno') {
    if (['1','sim','s'].includes(low)) answer = 'sim';
    else if (['2','não','nao','n'].includes(low)) answer = 'não';
    else return ['⚠️ Responda 1 para Sim ou 2 para Não.'];
  } else if (q.type === 'choice') {
    const ix = Number(v) - 1;
    if (!Number.isInteger(ix) || ix < 0 || ix >= q.options.length)
      return ['⚠️ Escolha uma das opções pelo número indicado.'];
    answer = q.options[ix];
  } else if (q.type === 'cpf') {
    if (!validarCPF(v)) return ['⚠️ CPF inválido. Confira os números e tente novamente.'];
    answer = v.replace(/\D/g,'');
  } else if (q.type === 'emailOptional') {
    if (answer && !validarEmail(answer)) return ['⚠️ E-mail inválido. Digite um e-mail válido ou *pular*.'];
  } else if (q.type === 'phoneOptional') {
    if (answer) {
      const tel = formatarTelefone(answer);
      if (!tel) return ['⚠️ Telefone inválido. Digite DDD + número ou *pular*.'];
      answer = tel;
    }
  } else if (q.type === 'date') {
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(v)) return ['⚠️ Use o formato DD/MM/AAAA.'];
    const [dd,mm,yyyy] = v.split('/').map(Number);
    const dt = new Date(yyyy,mm-1,dd);
    if (dt.getFullYear()!==yyyy || dt.getMonth()!==mm-1 || dt.getDate()!==dd) return ['⚠️ Data inválida. Confira o dia, mês e ano.'];
    if (q.key === 'dataTermino' && d.dataInicio) {
      const [di,mi,ai] = d.dataInicio.split('/').map(Number);
      const inicio = new Date(ai, mi - 1, di);
      if (dt <= inicio) return ['⚠️ A data de término precisa ser posterior à data de início.'];
    }
  } else if (q.type === 'positiveNumber') {
    if (!/^\d+$/.test(v) || Number(v)<1) return ['⚠️ Digite o prazo em meses usando um número maior que zero.'];
    answer = Number(v);
  } else if (q.type === 'dueDay') {
    if (!/^\d{1,2}$/.test(v) || Number(v)<1 || Number(v)>31) return ['⚠️ Digite um dia entre 1 e 31.'];
    answer = Number(v);
  } else if (q.type === 'money') {
    const bruto = v.replace(/R\$|\s/g, '');
    let normalizado;
    if (bruto.includes(',')) {
      normalizado = bruto.replace(/\./g, '').replace(',', '.');
    } else if (/\.\d{3}$/.test(bruto)) {
      normalizado = bruto.replace(/\./g, '');
    } else {
      normalizado = bruto.replace(/,/g, '');
    }
    const n = Number(normalizado);
    if (!Number.isFinite(n) || n<=0) return ['⚠️ Digite um valor válido, por exemplo 1250,00.'];
    if (q.key === 'valorCaucao' && d.aluguel && n > Number(d.aluguel) * 3) {
      return ['⚠️ A caução em dinheiro não pode ultrapassar três meses de aluguel. Confira o valor e tente novamente.'];
    }
    answer = n.toFixed(2);
  } else if (q.type === 'rules') {
    if (v === '0') answer = [];
    else {
      const nums = v.split(/[,;\s]+/).filter(Boolean).map(Number);
      if (!nums.length || nums.some(n => !Number.isInteger(n) || n<1 || n>regrasContrato.length))
        return ['⚠️ Digite números de 1 a 7 separados por vírgula, ou 0 para nenhuma regra.'];
      answer = [...new Set(nums)].map(n => regrasContrato[n-1]);
    }
  }

  d[q.key] = answer;
  const questions = s.data.contractQuestions;
  const i = s.data.contractIndex;
  if (q.key === 'addLocador' && answer === 'sim') {
    const count = questions.filter(x => x.key.startsWith('locador') && x.key.endsWith('_nome')).length + 1;
    questions.splice(i+1, 0, ...perguntasPessoa('locador', count),
      {key:'addLocador',label:'Há outro locador?',type:'yesno'});
  }
  if (q.key === 'addLocatario' && answer === 'sim') {
    const count = questions.filter(x => x.key.startsWith('locatario') && x.key.endsWith('_nome')).length + 1;
    questions.splice(i+1, 0, ...perguntasPessoa('locatario', count),
      {key:'addLocatario',label:'Há outro locatário?',type:'yesno'});
  }
  if (q.key === 'moveis' && answer !== 'Não, sem móveis') {
    questions.splice(i+1, 0, {key:'descricaoMoveis',label:'Descreva os móveis existentes',type:'text'});
  }
  if (q.key === 'finalidade' && answer === 'Outra finalidade') {
    questions.splice(i+1, 0, {key:'outraFinalidade',label:'Informe a finalidade da locação',type:'text'});
  }
  if (q.key === 'garantia' && answer === 'Caução') {
    questions.splice(i+1, 0,
      {key:'valorCaucao',label:'Valor da caução em reais',type:'money'},
      {key:'dataPagamentoCaucao',label:'Data de pagamento da caução (DD/MM/AAAA)',type:'date'},
      {key:'devolucaoCaucao',label:'Como tratar a caução ao fim do contrato?',type:'choice',options:['Devolver ao locatário ao final, conforme condições legais','Abater na última mensalidade, se expressamente acordado e permitido']});
  }
  if (q.key === 'garantia' && answer === 'Fiador') {
    questions.splice(i+1, 0, ...[
      ['fiador_nome','Nome completo','text'],['fiador_nacionalidade','Nacionalidade','text'],
      ['fiador_estadoCivil','Estado civil','text'],['fiador_profissao','Profissão','text'],
      ['fiador_rg','RG','text'],['fiador_cpf','CPF','cpf'],
      ['fiador_endereco','Endereço completo','text'],['fiador_email','E-mail (ou pular)','emailOptional'],
      ['fiador_telefone','Telefone (ou pular)','phoneOptional']
    ].map(([key,label,type])=>({key,label:'FIADOR — '+label,type,optional:type.endsWith('Optional')})));
  }
  if (q.key === 'regras' && answer.includes('Outras condições específicas')) {
    questions.splice(i+1, 0, {key:'outrasRegras',label:'Descreva a outra condição (somente o título/assunto)',type:'text'});
  }
  s.data.contractIndex++;
  if (s.data.contractIndex >= questions.length) return finalizarContrato(s);
  return [perguntaContrato(s)];
}

function finalizarContrato(s) {
  const d = s.data.contrato;
  const linhas = ['🏠 *NOVO CADASTRO — CONTRATO DE LOCAÇÃO*',''];
  const rotulos = {
    locador_nome:'Locador', locatario_nome:'Locatário', tipoImovel:'Tipo do imóvel',
    enderecoImovel:'Endereço do imóvel', finalidade:'Finalidade', outraFinalidade:'Outra finalidade',
    moveis:'Móveis', descricaoMoveis:'Descrição dos móveis', prazoMeses:'Prazo (meses)',
    dataInicio:'Data de início', dataTermino:'Data de término', aluguel:'Aluguel mensal',
    vencimento:'Dia de vencimento', formaPagamento:'Forma de pagamento', dadosPagamento:'Dados de pagamento',
    garantia:'Garantia', valorCaucao:'Valor da caução', dataPagamentoCaucao:'Pagamento da caução',
    devolucaoCaucao:'Tratamento da caução ao final', regras:'Condições selecionadas', outrasRegras:'Outra condição'
  };
  for (const [key,value] of Object.entries(d)) {
    if (value === '' || value === null || value === undefined) continue;
    let label = rotulos[key] || key.replace(/_/g,' ');
    if (key.endsWith('_nome') && key.startsWith('locador')) label = 'Locador';
    if (key.endsWith('_nome') && key.startsWith('locatario')) label = 'Locatário';
    let exibido = Array.isArray(value) ? value.map(x=>`• ${x}`).join('\n') : String(value);
    if (key === 'aluguel' || key === 'valorCaucao') exibido = `R$ ${value}`;
    linhas.push(`*${label}:* ${exibido}`);
  }
  if (d.aluguel) linhas.push(`*Aluguel por extenso:* ${valorPorExtenso(d.aluguel)}`);
  linhas.push('', '*Atenção:* cadastro recebido para preparação do contrato; conferir todos os dados antes de gerar ou assinar o documento.');
  const texto = linhas.join('\n');
  adminMessages.push({data:new Date().toLocaleString('pt-BR'), candidato:'Contrato de locação', texto});
  const nome = d.locatario_nome || 'cliente';
  sessions.delete(s.jid);
  return [`✅ Obrigado! Os dados do contrato foram recebidos e enviados para análise do administrador.\n\nConfira as informações com atenção antes da assinatura.`, '__CONTRATO_ENVIADO__'];
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
4️⃣ Criar Contrato de Locação
5️⃣ Criar Currículo
6️⃣ Chave Pix

Digite *1, 2, 3, 4, 5 ou 6* para escolher.
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

    case '6':
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
  const agora = Date.now();
  const LIMITE_INATIVIDADE = 4 * 60 * 60 * 1000; // 4 horas

  // Se o cliente estava fora do currículo e ficou 1 hora sem interagir,
  // a próxima mensagem inicia um novo atendimento mostrando o menu.
  // O preenchimento de currículo nunca é reiniciado por inatividade.
  if (
    s.step === 'idle' &&
    s.lastActivityAt &&
    agora - s.lastActivityAt >= LIMITE_INATIVIDADE
  ) {
    s.menuExibido = false;
    s.menuPendente = false;
  }
  s.lastActivityAt = agora;

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

    if (s.menuPendente && lower === '6') {
      s.menuPendente = false;
      s.menuExibido = true;
      return [respostaMenu('6')];
    }

    if (s.menuPendente && lower === '4') {
      s.menuPendente = false;
      return iniciarContrato(jid);
    }

    if (s.menuPendente && lower === '5') {
      s.menuPendente = false;
      sessions.set(jid, {
        step:'nome',
        menuExibido:true,
        menuPendente:false,
        lastActivityAt:Date.now(),
        data:{ experiencias:[], cursos:[] },
        expTemp:{},
        cursoTemp:{}
      });

      return [`👋 Olá! Sou o Robô da Conexão v7cyber 🤖

Vamos montar seu currículo profissional!

💡 A qualquer momento digite *sair* ou *cancelar* para cancelar.

1️⃣ Qual seu nome e sobrenome completo?`];
    }

    // Permite iniciar contrato digitando o nome da opção.
    if (lower.includes('criar contrato') || lower.includes('contrato de locação') || lower.includes('contrato de locacao')) {
      return iniciarContrato(jid);
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
        menuPendente:false,
        lastActivityAt:Date.now(),
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
    return ['❌ Cadastro cancelado com sucesso!\n\nSe quiser recomeçar, digite *menu*'];
  }

  if (s.step === 'contrato') return processarContrato(s, txt);

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

function escaparHTML(valor) {
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

            if (reply === '__CURRICULO_ENVIADO__' || reply === '__CONTRATO_ENVIADO__') {
              continue;
            }

            await sock.sendMessage(jid, { text: reply });
          }

          // Quando o currículo termina, processarMensagem já colocou
          // o currículo na caixa adminMessages. Enviamos o último currículo
          // para o número administrador.
          if (replies.includes('__CURRICULO_ENVIADO__') || replies.includes('__CONTRATO_ENVIADO__')) {
            const ultimo = adminMessages[adminMessages.length - 1];

            if (ultimo) {
              await sock.sendMessage(ADMIN_JID, { text: ultimo.texto });
              const tipoEnvio = replies.includes('__CONTRATO_ENVIADO__') ? 'Cadastro de contrato' : 'Currículo';
              log(`📤 ${tipoEnvio} enviado para ${ADMIN_JID}`);
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
<pre>${escaparHTML(logs.slice(-20).join('\n'))}</pre>
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
        <pre style="text-align:left;background:#eee;padding:15px">${escaparHTML(logs.slice(-20).join('\n'))}</pre>
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
  res.set('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true,
    connected: isConnected,
    hasQR: !!qrCodeData,
    uptime: Math.floor(process.uptime())
  });
});

app.get('/logs', (req, res) => {
  res.send(`
    <body style="font-family:Arial;padding:20px">
      <h1>📋 Logs</h1>
      <pre>${escaparHTML(logs.join('\n'))}</pre>
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