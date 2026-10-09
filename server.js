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

// Protege todas as páginas e endpoints administrativos, incluindo QR, logs e currículos.
app.get('/', protegerPainel, (req, res, next) => next());
app.use(['/whatsapp', '/qr', '/status', '/logs', '/admin'], protegerPainel);

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
Durante a conversa, digite *menu* para ver estas opções novamente.`;
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
// CADASTRO SIMPLIFICADO DE CONTRATO DE LOCAÇÃO
// Coleta os dados em etapas e envia o resumo ao administrador.
// ======================================================
function perguntasContrato(d) {
  const a = d.contratoRespostas || {};
  const q = [
    ['locador_nome','LOCADOR — Nome completo:','nome'],
    ['locador_endereco','LOCADOR — Endereço residencial (rua/avenida):','texto'],
    ['locador_numero','LOCADOR — Número da casa/apartamento:','texto'],
    ['locador_complemento','LOCADOR — Complemento (ou digite não):','opcional'],
    ['locador_bairro','LOCADOR — Bairro:','texto'], ['locador_cidade','LOCADOR — Cidade:','texto'], ['locador_estado','LOCADOR — Estado (sigla com 2 letras, ex.: SP):','uf'], ['locador_cep','LOCADOR — CEP:','cep'],
    ['locador_estadoCivil','LOCADOR — Estado civil? Solteiro, casado, divorciado, viúvo, separado ou união estável.','estadoCivil'],
    ['locador_rg','LOCADOR — RG:','rg'], ['locador_cpf','LOCADOR — CPF:','cpf'],
    ['locador_nacionalidade','LOCADOR — Nacionalidade:','texto'],
    ['locador_email','LOCADOR — E-mail:','email'], ['locador_telefone','LOCADOR — Telefone com DDD:','telefone'],
    ['outroLocador','Há outro locador?','simNao'],
    ['locatario_nome','LOCATÁRIO — Nome completo:','nome'],
    ['locatario_endereco','LOCATÁRIO — Endereço residencial (rua/avenida):','texto'],
    ['locatario_numero','LOCATÁRIO — Número da casa/apartamento:','texto'],
    ['locatario_complemento','LOCATÁRIO — Complemento (ou digite não):','opcional'],
    ['locatario_bairro','LOCATÁRIO — Bairro:','texto'], ['locatario_cidade','LOCATÁRIO — Cidade:','texto'], ['locatario_estado','LOCATÁRIO — Estado (sigla com 2 letras, ex.: SP):','uf'], ['locatario_cep','LOCATÁRIO — CEP:','cep'],
    ['locatario_estadoCivil','LOCATÁRIO — Estado civil? Solteiro, casado, divorciado, viúvo, separado ou união estável.','estadoCivil'],
    ['locatario_rg','LOCATÁRIO — RG:','rg'], ['locatario_cpf','LOCATÁRIO — CPF:','cpf'],
    ['locatario_nacionalidade','LOCATÁRIO — Nacionalidade:','texto'],
    ['locatario_email','LOCATÁRIO — E-mail:','email'], ['locatario_telefone','LOCATÁRIO — Telefone com DDD:','telefone'],
    ['outroLocatario','Há outro locatário?','simNao'],
    ['tipoImovel','Tipo do imóvel: 1 Casa, 2 Apartamento ou 3 Outro.','tipoImovel'],
    ['garagem','O imóvel possui garagem? 1 Sim, 2 Não.','simNao'],
    ['enderecoImovel','Endereço do imóvel — rua/avenida:','texto'],
    ['numeroImovel','Número do imóvel:','texto'],
    ['complementoImovel','Complemento do imóvel (ou digite não):','opcional'],
    ['bairroImovel','Bairro do imóvel:','texto'], ['cidadeImovel','Cidade do imóvel:','texto'], ['estadoImovel','Estado do imóvel (sigla com 2 letras, ex.: SP):','uf'],
    ['cepImovel','CEP do imóvel:','cep'],
    ['finalidade','Finalidade da locação: 1 Residencial ou 2 Comercial.','finalidade'],
    ['mobiliado','O imóvel é mobiliado? 1 Sim, 2 Não, 3 Parcialmente.','mobiliado'],
    ['descricaoMoveis','Descreva os móveis e itens existentes:','texto'],
    ['prazo','Prazo da locação em meses (número inteiro maior que zero):','positivo'],
    ['dataInicio','Data de início da locação (DD/MM/AAAA):','data'],
    ['aluguel','Valor mensal do aluguel (ex.: R$ 1.200,00):','dinheiro'],
    ['vencimento','Dia de vencimento mensal (1 a 31):','vencimento'],
    ['pagamento','Forma de pagamento: 1 Pix ou 2 transferência/depósito bancário.','formaPagamento'],
    ['pix','Informe a chave Pix para pagamento:','texto'],
    ['banco','Nome do banco:','texto'], ['agencia','Agência bancária:','texto'],
    ['conta','Número da conta e tipo (corrente/poupança):','texto'],
    ['titularConta','Nome do titular da conta:','texto'],
    ['garantia','Garantia: 1 Nenhuma, 2 Caução, 3 Fiador ou 4 Seguro-fiança.','garantia'],
    ['caucaoValor','Valor da caução em reais:','dinheiro'],
    ['caucaoData','Data de pagamento da caução (DD/MM/AAAA):','data'],
    ['caucaoDestino','Ao final do contrato: 1 devolver a caução ou 2 abater no encerramento, se legalmente permitido e acordado.','caucaoDestino'],
    ['fiador_nome','FIADOR — Nome completo:','nome'], ['fiador_cpf','FIADOR — CPF:','cpf'],
    ['fiador_rg','FIADOR — RG:','rg'], ['fiador_endereco','FIADOR — Endereço completo, incluindo número:','texto'],
    ['fiador_telefone','FIADOR — Telefone com DDD:','telefone'],
    ['seguroDados','Seguro-fiança — seguradora e dados disponíveis:','texto'],
    ['condicoes','Selecione restrições/condições por número, separados por vírgula; 0 para nenhuma.','condicoes'],
    ['outraCondicao','Descreva a condição adicional:','texto'],
    ['revisao','Confirma os dados coletados? Digite sim para confirmar ou não para cancelar.','revisao']
  ];
  return q.filter(([key]) => {
    if (['locador_complemento','locatario_complemento','complementoImovel'].includes(key)) return true;
    if (key === 'enderecoImovelIgualLocatario') return true;
    if (['enderecoImovel','numeroImovel','complementoImovel','bairroImovel','cidadeImovel','estadoImovel','cepImovel'].includes(key) && /^1$|^sim$/i.test(a.enderecoImovelIgualLocatario || '')) return false;
    if (key === 'outroLocador') return true;
    if (key.startsWith('locatario_') || key === 'outroLocatario') return true;
    if (key === 'fiador_nome' || key === 'fiador_cpf' || key === 'fiador_rg' || key === 'fiador_endereco' || key === 'fiador_telefone') return /fiador/i.test(a.garantia || '');
    if (key === 'seguroDados') return /seguro/i.test(a.garantia || '');
    if (['caucaoValor','caucaoData','caucaoDestino'].includes(key)) return /^2$|cau[cç][aã]o/i.test(a.garantia || '');
    if (key === 'pix') return /^1$|pix/i.test(a.pagamento || '');
    if (['banco','agencia','conta','titularConta'].includes(key)) return /^2$|banco|transfer|dep[oó]sito/i.test(a.pagamento || '');
    if (key === 'descricaoMoveis') return /^(1|3)$|sim|parcial/i.test(a.mobiliado || '');
    if (key === 'outraCondicao') return Array.isArray(a.condicoes) && a.condicoes.includes('Outra condição');
    return true;
  }).map(([key, pergunta, tipo]) => {
    if (key === 'condicoes') return [key, pergunta + '\n1 Pets/animais\n2 Som alto e perturbação do sossego\n3 Mudanças e movimentação de móveis\n4 Uso de áreas comuns\n5 Reformas/alterações\n6 Proibição de sublocação sem autorização\n7 Outra condição', tipo];
    return [key, pergunta, tipo];
  });
}

function validarCPFContrato(txt) {
  const cpf = String(txt).replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += Number(cpf[i]) * (10 - i);
  let dig = (soma * 10) % 11;
  if (dig === 10) dig = 0;
  if (dig !== Number(cpf[9])) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += Number(cpf[i]) * (11 - i);
  dig = (soma * 10) % 11;
  if (dig === 10) dig = 0;
  return dig === Number(cpf[10]);
}

function validarRespostaContrato(tipo, txt) {
  const v = txt.trim();
  if (!v) return 'Este campo é obrigatório. Digite uma resposta para continuar.';
  if (tipo === 'opcional' && /^(não|nao|n|nenhum|sem complemento)$/i.test(v)) return null;
  if (tipo === 'nome' && v.split(/\s+/).length < 2) return 'Informe nome e sobrenome completos. Ex.: João da Silva.';
  if (tipo === 'estadoCivil' && !validarEstadoCivil(v).ok) return 'Estado civil inválido. Digite solteiro, casado, divorciado, viúvo, separado ou união estável.';
  if (tipo === 'rg' && v.replace(/\D/g, '').length < 5) return 'RG inválido. Confira o número e tente novamente.';
  if (tipo === 'cpf' && !validarCPFContrato(v)) return 'CPF inválido. Confira os 11 dígitos e tente novamente.';
  if (tipo === 'email' && !validarEmail(v)) return 'E-mail inválido. Ex.: nome@email.com';
  if (tipo === 'telefone' && !formatarTelefone(v)) return 'Telefone inválido. Informe DDD e número, por exemplo (11) 91234-5678.';
  if (tipo === 'uf' && !/^[A-Za-z]{2}$/.test(v)) return 'Informe a sigla do estado com exatamente 2 letras. Ex.: SP, RJ ou MG.';
  if (tipo === 'simNao' && !/^(sim|s|1|não|nao|n|2)$/i.test(v)) return 'Responda 1 para Sim ou 2 para Não.';
  if (tipo === 'positivo' && (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > 600)) return 'Digite um número inteiro entre 1 e 600 meses.';
  if (tipo === 'data') {
    const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return 'Data inválida. Use o formato DD/MM/AAAA.';
    const [, dd, mm, yyyy] = m; const dt = new Date(Number(yyyy), Number(mm)-1, Number(dd));
    if (dt.getFullYear() !== Number(yyyy) || dt.getMonth() !== Number(mm)-1 || dt.getDate() !== Number(dd)) return 'Essa data não existe. Confira o dia, mês e ano.';
  }
  if (tipo === 'dinheiro' && !/^\s*(R\$\s*)?\d{1,3}(\.\d{3})*(,\d{1,2})?\s*$|^\s*(R\$\s*)?\d+(,\d{1,2})?\s*$/.test(v)) return 'Valor inválido. Exemplo: 1200,00 ou R$ 1.200,00.';
  if (tipo === 'vencimento' && (!/^\d{1,2}$/.test(v) || Number(v) < 1 || Number(v) > 31)) return 'Digite um dia entre 1 e 31.';
  if (['tipoImovel','finalidade','mobiliado','formaPagamento','garantia','caucaoDestino'].includes(tipo) && !/^\d+$/.test(v)) return 'Escolha uma opção digitando o número correspondente.';
  if (tipo === 'tipoImovel' && !['1','2','3'].includes(v)) return 'Digite 1, 2 ou 3.';
  if (tipo === 'finalidade' && !['1','2'].includes(v)) return 'Digite 1 para Residencial ou 2 para Comercial.';
  if (tipo === 'mobiliado' && !['1','2','3'].includes(v)) return 'Digite 1, 2 ou 3.';
  if (tipo === 'formaPagamento' && !['1','2'].includes(v)) return 'Digite 1 para Pix ou 2 para banco.';
  if (tipo === 'garantia' && !['1','2','3','4'].includes(v)) return 'Digite uma opção de 1 a 4.';
  if (tipo === 'caucaoDestino' && !['1','2'].includes(v)) return 'Digite 1 para devolver ou 2 para abater no encerramento.';
  if (tipo === 'condicoes' && v !== '0') {
    const nums = v.split(/[,;\s]+/).filter(Boolean);
    if (!nums.length || nums.some(n => !/^[1-7]$/.test(n))) return 'Digite números de 1 a 7 separados por vírgula, ou 0 para nenhuma.';
  }
  if (tipo === 'cep' && !/^\d{5}-?\d{3}$/.test(v)) return 'CEP inválido. Informe 8 dígitos, por exemplo 09310-000.';
  return null;
}

function iniciarContrato(jid) {
  sessions.set(jid, {
    step: 'contrato', menuExibido: true, menuPendente: false,
    lastActivityAt: Date.now(), data: { experiencias: [], cursos: [], contratoRespostas: {} },
    expTemp: {}, cursoTemp: {}, contratoIndex: 0
  });
  return '📄 *CONTRATO DE LOCAÇÃO*\nVou perguntar um dado por vez.\n\n↩️ Digite *voltar* para corrigir a resposta anterior.\n❌ Digite *cancelar* para encerrar.\n\n' + perguntasContrato(sessions.get(jid).data)[0][1];
}

function processarContrato(s, txt, jid) {
  const a = s.data.contratoRespostas || (s.data.contratoRespostas = {});
  const perguntas = perguntasContrato(s.data);
  const idx = Number.isInteger(s.contratoIndex) ? s.contratoIndex : 0;
  const atual = perguntas[idx];
  if (!atual) return ['Não encontrei a próxima pergunta. Digite *cancelar* e inicie novamente.'];
  const [key, pergunta, tipo] = atual;
  if (/^voltar$/i.test(txt.trim())) {
    if (idx <= 0) return ['Você já está na primeira pergunta.\n\n' + pergunta];
    s.contratoIndex = idx - 1;
    const anterior = perguntasContrato(s.data)[s.contratoIndex];
    return ['↩️ *Voltando à pergunta anterior.*\n\n' + anterior[1] + '\n\n↩️ *voltar* = pergunta anterior | ❌ *cancelar* = encerrar'];
  }
  if (key === 'revisao' && /^(não|nao|n)$/i.test(txt.trim())) {
    sessions.delete(jid);
    return ['Cadastro do contrato cancelado. Digite *menu* para voltar às opções.'];
  }
  if (key === 'revisao' && !/^(sim|s|1)$/i.test(txt.trim())) {
    return ['Responda *sim* para confirmar ou *não* para cancelar.'];
  }
  const erroValidacao = validarRespostaContrato(tipo, txt);
  if (erroValidacao) return [`⚠️ ${erroValidacao}\n\n${pergunta}\n\n↩️ *voltar* = pergunta anterior | ❌ *cancelar* = encerrar`];
  let resposta = txt.trim();
  if (tipo === 'estadoCivil') resposta = validarEstadoCivil(resposta).valor;
  if (tipo === 'telefone') resposta = formatarTelefone(resposta);
  if (tipo === 'uf') resposta = resposta.toUpperCase();
  if (tipo === 'cpf') resposta = resposta.replace(/\D/g, '');
  if (tipo === 'opcional' && /^(não|nao|n|nenhum|sem complemento)$/i.test(resposta)) resposta = 'Não informado';
  if (tipo === 'tipoImovel') resposta = ({'1':'Casa','2':'Apartamento','3':'Outro'})[resposta];
  if (tipo === 'finalidade') resposta = ({'1':'Residencial','2':'Comercial'})[resposta];
  if (tipo === 'mobiliado') resposta = ({'1':'Sim, mobiliado','2':'Não','3':'Parcialmente mobiliado'})[resposta];
  if (tipo === 'formaPagamento') resposta = ({'1':'Pix','2':'Transferência/depósito bancário'})[resposta];
  if (tipo === 'garantia') resposta = ({'1':'Nenhuma','2':'Caução','3':'Fiador','4':'Seguro-fiança'})[resposta];
  if (tipo === 'caucaoDestino') resposta = ({'1':'Devolver ao final do contrato','2':'Abater no encerramento, conforme acordo e legislação aplicável'})[resposta];
  if (tipo === 'condicoes') resposta = resposta === '0' ? ['Nenhuma condição adicional informada'] : [...new Set(resposta.split(/[,;\s]+/).map(n => ({'1':'Pets/animais','2':'Som alto e perturbação do sossego','3':'Mudanças e movimentação de móveis','4':'Uso de áreas comuns','5':'Reformas/alterações','6':'Proibição de sublocação sem autorização','7':'Outra condição'}[n])))];
  a[key] = resposta;
  if (key === 'enderecoImovelIgualLocatario' && resposta === '1') {
    a.enderecoImovel = a.locatario_endereco || '';
    a.numeroImovel = a.locatario_numero || '';
    a.complementoImovel = a.locatario_complemento || 'Não informado';
    a.bairroImovel = a.locatario_bairro || '';
    a.cidadeImovel = a.locatario_cidade || '';
    a.estadoImovel = a.locatario_estado || '';
    a.cepImovel = a.locatario_cep || '';
  }
  if (key === 'dataInicio' || key === 'prazo') {
    if (a.dataInicio && a.prazo) {
      const [dd,mm,yyyy] = a.dataInicio.split('/').map(Number);
      const fim = new Date(yyyy, mm - 1, dd);
      fim.setMonth(fim.getMonth() + Number(a.prazo));
      if (fim.getDate() !== dd) fim.setDate(0);
      a.dataFim = `${String(fim.getDate()).padStart(2,'0')}/${String(fim.getMonth()+1).padStart(2,'0')}/${fim.getFullYear()}`;
    }
  }
  const atualizadas = perguntasContrato(s.data);
  // A lista de perguntas é condicional. Localize a pergunta respondida na
  // lista recalculada antes de avançar, para não pular perguntas quando uma
  // ramificação (por exemplo, segundo locador ou caução) não se aplica.
  const indiceAtualizado = atualizadas.findIndex(([perguntaKey]) => perguntaKey === key);
  const nextIndex = indiceAtualizado >= 0 ? indiceAtualizado + 1 : idx;
  if (nextIndex < atualizadas.length) {
    s.contratoIndex = nextIndex;
    return [atualizadas[nextIndex][1] + '\n\n↩️ *voltar* = pergunta anterior | ❌ *cancelar* = encerrar'];
  }
  const exibir = (v) => Array.isArray(v) ? v.join(', ') : (v || 'Não informado');
  const resumo = `📄 *SOLICITAÇÃO DE CONTRATO DE LOCAÇÃO*

` +
    `*LOCADOR:* ${exibir(a.locador_nome)} | CPF ${exibir(a.locador_cpf)} | RG ${exibir(a.locador_rg)} | ${exibir(a.locador_estadoCivil)} | ${exibir(a.locador_nacionalidade)}
` +
    `*Endereço do locador:* ${exibir(a.locador_endereco)}, nº ${exibir(a.locador_numero)}${a.locador_complemento && a.locador_complemento !== 'Não informado' ? ', ' + a.locador_complemento : ''}, ${exibir(a.locador_bairro)}, ${exibir(a.locador_cidade)}/${exibir(a.locador_estado)}, CEP ${exibir(a.locador_cep)}
` +
    `*Contato do locador:* ${exibir(a.locador_telefone)} | ${exibir(a.locador_email)}

` +
    `*LOCATÁRIO:* ${exibir(a.locatario_nome)} | CPF ${exibir(a.locatario_cpf)} | RG ${exibir(a.locatario_rg)} | ${exibir(a.locatario_estadoCivil)} | ${exibir(a.locatario_nacionalidade)}
` +
    `*Endereço do locatário:* ${exibir(a.locatario_endereco)}, nº ${exibir(a.locatario_numero)}${a.locatario_complemento && a.locatario_complemento !== 'Não informado' ? ', ' + a.locatario_complemento : ''}, ${exibir(a.locatario_bairro)}, ${exibir(a.locatario_cidade)}/${exibir(a.locatario_estado)}, CEP ${exibir(a.locatario_cep)}
` +
    `*Contato do locatário:* ${exibir(a.locatario_telefone)} | ${exibir(a.locatario_email)}

` +
    `*IMÓVEL:* ${exibir(a.tipoImovel)} ${a.garagem === 'sim' || a.garagem === '1' ? 'com garagem' : 'sem garagem'} localizado à ${exibir(a.enderecoImovel)}, nº ${exibir(a.numeroImovel)}, ${exibir(a.complementoImovel)}, ${exibir(a.bairroImovel)}, ${exibir(a.cidadeImovel)}/${exibir(a.estadoImovel)}, CEP ${exibir(a.cepImovel)}, para fins ${String(a.finalidade || '').toLowerCase()}
` +
    `*Finalidade:* ${exibir(a.finalidade)} | *Mobiliado:* ${exibir(a.mobiliado)}${a.descricaoMoveis ? ' — ' + a.descricaoMoveis : ''}
` +
    `*Prazo:* ${exibir(a.prazo)} meses | *Início:* ${exibir(a.dataInicio)} | *Término calculado:* ${exibir(a.dataFim)}
` +
    `*Aluguel:* R$ ${exibir(a.aluguel)} | *Vencimento:* dia ${exibir(a.vencimento)}
` +
    `*Pagamento:* ${exibir(a.pagamento)}${a.pix ? ' — Pix: ' + a.pix : ''}${a.banco ? ' — Banco: ' + a.banco + ', agência ' + exibir(a.agencia) + ', conta ' + exibir(a.conta) + ', titular ' + exibir(a.titularConta) : ''}
` +
    `*Garantia:* ${exibir(a.garantia)}${a.caucaoValor ? ' — R$ ' + a.caucaoValor + '; tratamento: ' + exibir(a.caucaoDestino) : ''}${a.fiador_nome ? ' — Fiador: ' + a.fiador_nome + ', CPF ' + exibir(a.fiador_cpf) + ', RG ' + exibir(a.fiador_rg) + ', endereço ' + exibir(a.fiador_endereco) + ', telefone ' + exibir(a.fiador_telefone) : ''}${a.seguroDados ? ' — ' + a.seguroDados : ''}
` +
    `*Condições/restrições:* ${exibir(a.condicoes)}${a.outraCondicao ? ' — ' + a.outraCondicao : ''}

` +
    `⚠️ *Conferência necessária:* cadastro para preparação do contrato; revisar dados e cláusulas antes da assinatura.`;
  const registro = { id: crypto.randomUUID(), data: new Date().toLocaleString('pt-BR'), candidato: 'Contrato de locação', jid, texto: resumo };
  adminMessages.push(registro);
  sessions.delete(jid);
  return ['✅ Dados do contrato coletados. A solicitação será encaminhada para revisão.\n\nDigite *menu* para voltar às opções.', `__CONTRATO_ENVIADO__:${registro.id}`];
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

  // Após 4 horas sem interação, o menu reaparece na próxima mensagem,
  // desde que não exista cadastro ativo em andamento.
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
    if (['menu', 'voltar', 'inicio', 'início'].includes(lower)) {
      s.menuExibido = true;
      s.menuPendente = true;
      return [menuPrincipal()];
    }

    if (s.menuPendente && ['1','2','3','6'].includes(lower)) {
      s.menuPendente = false;
      return [respostaMenu(lower)];
    }

    if (s.menuPendente && lower === '4') {
      return [iniciarContrato(jid)];
    }

    if (s.menuPendente && lower === '5') {
      sessions.set(jid, {
        step:'nome', menuExibido:true, menuPendente:false,
        lastActivityAt:Date.now(), data:{ experiencias:[], cursos:[] },
        expTemp:{}, cursoTemp:{}
      });
      return [`👋 Olá! Sou o Robô da Conexão v7cyber 🤖\n\nVamos montar seu currículo profissional!\n\n💡 Digite *sair* ou *cancelar* para cancelar.\n\n1️⃣ Qual seu nome e sobrenome completo?`];
    }

    const gatilhoInicial = lower.includes('criar curriculum') || lower.includes('criar curriculo') || lower.includes('criar currículo') || (lower.includes('criar') && lower.includes('curric')) || lower === 'curriculo' || lower === 'curriculum';
    if (gatilhoInicial) {
      sessions.set(jid, { step:'nome', menuExibido:true, menuPendente:false, lastActivityAt:Date.now(), data:{ experiencias:[], cursos:[] }, expTemp:{}, cursoTemp:{} });
      return [`👋 Olá! Vamos montar seu currículo profissional!\n\nDigite *sair* ou *cancelar* para cancelar.\n\n1️⃣ Qual seu nome e sobrenome completo?`];
    }

    if (!s.menuExibido) {
      s.menuExibido = true;
      s.menuPendente = true;
      return [menuPrincipal()];
    }
    s.menuPendente = false;
    return [];
  }

  // Volta uma pergunta no cadastro, mantendo os dados já digitados.
  if (lower === 'voltar' && s.step !== 'idle' && s.step !== 'menu_temporario') {
    if (s.step === 'contrato') {
      s.contratoIndex = Math.max(0, (s.contratoIndex || 0) - 1);
      const qAnterior = perguntasContrato(s.data)[s.contratoIndex];
      return [qAnterior ? `↩️ Voltando.\n\n${qAnterior[1]}` : 'Você já está na primeira pergunta do contrato.'];
    }
    const etapasCurriculo = ['nome','nascimento','nacionalidade','estadoCivil','rua','numero','complemento','bairro','cidade','estado','cep','telefone','email','objetivo','exp_empresa','exp_cargo','exp_inicio','exp_fim','exp_mais','formacao','curso_pergunta','curso_nome','curso_inst','curso_ano','curso_mais','habilidades','resumo'];
    const pos = etapasCurriculo.indexOf(s.step);
    if (pos > 0) {
      s.step = etapasCurriculo[pos - 1];
      const perguntasPorEtapa = {
        nome:'Qual seu nome e sobrenome completo?', nascimento:'Data de nascimento?\nFormato DD/MM/AAAA', nacionalidade:'Qual sua nacionalidade?', estadoCivil:'Qual seu estado civil?', rua:'Nome da rua/avenida?', numero:'Número da casa?', complemento:'Complemento? Se não tiver, digite não.', bairro:'Qual seu bairro?', cidade:'Qual sua cidade?', estado:'Estado (sigla de 2 letras)?', cep:'Qual seu CEP?', telefone:'Qual seu telefone/WhatsApp?', email:'Qual seu e-mail?', objetivo:'Qual seu objetivo profissional?', exp_empresa:'Nome da última empresa? Se for primeiro emprego, digite primeiro emprego.', exp_cargo:'Qual era seu cargo?', exp_inicio:'Data de início do trabalho?', exp_fim:'Data de saída? Ou digite atual.', exp_mais:'Tem mais empresas? 1 Sim, 2 Não, 3 Pular', formacao:'Qual sua formação?', curso_pergunta:'Tem cursos? 1 Sim, 2 Não, 3 Pular', curso_nome:'Qual o nome do curso?', curso_inst:'Onde fez o curso?', curso_ano:'Qual o ano do curso?', curso_mais:'Mais cursos? 1 Sim, 2 Não, 3 Pular', habilidades:'Informe suas habilidades ou digite pular.', resumo:'Informe seu resumo profissional ou digite pular.'
      };
      return [`↩️ Voltando à pergunta anterior.\n\n${perguntasPorEtapa[s.step] || 'Continue o cadastro.'}`];
    }
    return ['Você já está na primeira pergunta.'];
  }

  // Durante cadastro, permite consultar o menu sem apagar os dados já preenchidos.
  if (['menu','inicio','início'].includes(lower) && s.step !== 'idle') {
    s.stepAntesMenu = s.step;
    s.step = 'menu_temporario';
    s.menuPendente = true;
    return [menuPrincipal()];
  }
  if (s.step === 'menu_temporario') {
    const etapaAnterior = s.stepAntesMenu || 'idle';
    const cadastroAnterior = etapaAnterior === 'contrato' ? 'contrato' : 'curriculo';
    if (lower === '4') {
      if (cadastroAnterior === 'contrato') { s.step = 'contrato'; return [perguntasContrato(s.data)[s.contratoIndex || 0]?.[1] || 'Continue o cadastro do contrato.']; }
      s.step = etapaAnterior;
      return ['Você tem um currículo em andamento. Para iniciar um contrato, primeiro digite *cancelar*. Seu currículo foi preservado.'];
    }
    if (lower === '5') {
      if (cadastroAnterior === 'curriculo') { s.step = etapaAnterior; return ['Retomando o cadastro do currículo. Continue respondendo à pergunta pendente ou digite *voltar*.']; }
      s.step = etapaAnterior;
      return ['Você tem um contrato em andamento. Para iniciar um currículo, primeiro digite *cancelar*. Seu contrato foi preservado.'];
    }
    if (lower === '6') { s.step = etapaAnterior; return [respostaMenu('6')]; }
    if (['1','2','3'].includes(lower)) { s.step = etapaAnterior; return [respostaMenu(lower), 'Seu cadastro foi preservado. Continue respondendo à pergunta pendente ou digite *menu* para consultar as opções.']; }
    if (lower === 'voltar') { s.step = etapaAnterior; return ['Retomando o cadastro anterior. Continue respondendo à pergunta pendente.']; }
    return ['Digite uma opção de 1 a 6, ou *voltar* para retomar o cadastro.'];
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
    return ['❌ Cadastro cancelado com sucesso!\n\nSe quiser recomeçar, digite *menu* e escolha uma opção'];
  }

  if (s.step === 'contrato') return processarContrato(s, txt, jid);

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
    const registro = { id: crypto.randomUUID(), data: new Date().toLocaleString('pt-BR'), candidato: d.nome, jid, texto: curriculo };
    adminMessages.push(registro);

    sessions.delete(jid);

    return [
      `✅ Obrigado, ${d.nome}!\n\nSeu currículo foi recebido com sucesso!\n\n📧 Email: ${d.email}\n📱 Tel: ${d.telefone}\n\n🚀 Conexão v7cyber agradece seu cadastro!`,
      `__CURRICULO_ENVIADO__:${registro.id}`
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
const processedMessageIds = new Set();

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

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type && type !== 'notify') return;
      for (const m of messages) {
        try {
          if (!m.message || m.key.fromMe) continue;
          const messageId = m.key?.id;
          if (messageId && processedMessageIds.has(messageId)) continue;
          if (messageId) {
            processedMessageIds.add(messageId);
            if (processedMessageIds.size > 5000) {
              const oldest = processedMessageIds.values().next().value;
              if (oldest) processedMessageIds.delete(oldest);
            }
          }

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

            if (reply.startsWith('__CURRICULO_ENVIADO__:') || reply.startsWith('__CONTRATO_ENVIADO__:')) {
              continue;
            }

            await sock.sendMessage(jid, { text: reply });
          }

          // Quando o currículo termina, processarMensagem já colocou
          // o currículo na caixa adminMessages. Enviamos o último currículo
          // para o número administrador.
          const marcadores = replies.filter((reply) =>
            reply.startsWith('__CURRICULO_ENVIADO__:') || reply.startsWith('__CONTRATO_ENVIADO__:')
          );
          for (const marcador of marcadores) {
            const registroId = marcador.split(':')[1];
            const registro = adminMessages.find((item) => item.id === registroId);
            if (registro) {
              await sock.sendMessage(ADMIN_JID, { text: registro.texto });
              log(`📤 Registro de ${registro.candidato} enviado para ${ADMIN_JID}`);
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