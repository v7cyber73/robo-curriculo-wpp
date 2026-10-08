const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require('@whiskeysockets/baileys')

const express = require('express')
const QRCode = require('qrcode')
const fs = require('fs')
const path = require('path')

const app = express()
app.use(express.json())

const PORT = process.env.PORT || 3000

// ======================================================
// CONFIGURAÇÕES
// ======================================================

const sessions = new Map()

const DESTINO_FINAL =
  process.env.DESTINO_CURRICULOS || '5511942047248@s.whatsapp.net'

let sock = null
let qrAtual = null
let ultimoStatus = 'Desconectado'
let logs = []

// ======================================================
// LOG
// ======================================================

function registrarLog(texto) {
  const linha = `[${new Date().toLocaleString('pt-BR')}] ${texto}`

  console.log(linha)

  logs.push(linha)

  if (logs.length > 500) {
    logs.shift()
  }
}

// ======================================================
// NORMALIZAR TEXTO
// ======================================================

function normalizarTexto(txt) {
  return String(txt || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

// ======================================================
// CANCELAMENTO
// ======================================================

function pediuCancelar(txt) {
  const texto = normalizarTexto(txt)

  const comandos = [
    'sair',
    'cancelar',
    'parar',
    'desistir',
    'exit',
    'cancel',
    'stop',
    'sai',
    'cancela'
  ]

  if (comandos.includes(texto)) {
    return true
  }

  if (
    texto.includes('quero sair') ||
    texto.includes('quero cancelar')
  ) {
    return true
  }

  return false
}

// ======================================================
// VALIDAÇÕES
// ======================================================

function validarDataNascimento(data) {
  const regex = /^(\d{2})\/(\d{2})\/(\d{4})$/

  const match = data.match(regex)

  if (!match) {
    return false
  }

  const dia = Number(match[1])
  const mes = Number(match[2])
  const ano = Number(match[3])

  const dataObj = new Date(ano, mes - 1, dia)

  if (
    dataObj.getFullYear() !== ano ||
    dataObj.getMonth() !== mes - 1 ||
    dataObj.getDate() !== dia
  ) {
    return false
  }

  const hoje = new Date()

  if (dataObj > hoje) {
    return false
  }

  return true
}

// ======================================================
// CALCULAR IDADE AUTOMATICAMENTE
// ======================================================

function calcularIdade(dataNascimento) {
  const [dia, mes, ano] = dataNascimento
    .split('/')
    .map(Number)

  const hoje = new Date()

  let idade = hoje.getFullYear() - ano

  const aniversarioAindaNaoChegou =
    hoje.getMonth() < mes - 1 ||
    (
      hoje.getMonth() === mes - 1 &&
      hoje.getDate() < dia
    )

  if (aniversarioAindaNaoChegou) {
    idade--
  }

  return idade
}

// ======================================================

function validarEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

// ======================================================

function validarCEP(cep) {
  const somenteNumeros = cep.replace(/\D/g, '')

  return somenteNumeros.length === 8
}

// ======================================================

function formatarCEP(cep) {
  const numero = cep.replace(/\D/g, '')

  if (numero.length !== 8) {
    return cep
  }

  return `${numero.substring(0, 5)}-${numero.substring(5)}`
}

// ======================================================

function validarTelefone(telefone) {
  const numero = telefone.replace(/\D/g, '')

  if (numero.length !== 10 && numero.length !== 11) {
    return false
  }

  return true
}

// ======================================================

function formatarTelefone(telefone) {
  const numero = telefone.replace(/\D/g, '')

  if (numero.length === 11) {
    return `(${numero.substring(0, 2)}) ${numero.substring(2, 7)}-${numero.substring(7)}`
  }

  if (numero.length === 10) {
    return `(${numero.substring(0, 2)}) ${numero.substring(2, 6)}-${numero.substring(6)}`
  }

  return telefone
}

// ======================================================

function validarMesAno(valor) {
  const regex = /^(0[1-9]|1[0-2])\/\d{4}$/

  return regex.test(valor)
}

// ======================================================

function validarAno(valor) {
  const ano = Number(valor)

  return (
    /^\d{4}$/.test(valor) &&
    ano >= 1900 &&
    ano <= new Date().getFullYear()
  )
}

// ======================================================
// SESSÃO
// ======================================================

function criarSessao(jid) {
  const sessao = {
    step: 'inicio',
    dados: {
      experiencia: [],
      cursos: [],
      habilidades: []
    }
  }

  sessions.set(jid, sessao)

  return sessao
}

// ======================================================
// TELA DE APRESENTAÇÃO
// ======================================================

async function enviarApresentacao(jid) {
  await sock.sendMessage(jid, {
    text:
`👋 Olá! Seja bem-vindo!

📄 Posso ajudar você a criar um currículo profissional.

👉 Digite *1* para criar seu currículo.

💬 Se quiser conversar ou pedir outra informação, é só enviar sua mensagem normalmente.

❌ Durante o preenchimento do currículo, você pode digitar *SAIR* para cancelar.`
  })
}

// ======================================================
// INICIAR CURRÍCULO
// ======================================================

async function iniciarCurriculo(jid) {
  const sessao = criarSessao(jid)

  sessao.step = 'dataNascimento'

  await sock.sendMessage(jid, {
    text:
`✅ Vamos começar seu currículo!

📅 Primeiro, informe sua *data de nascimento*.

Digite no formato:

*DD/MM/AAAA*

Exemplo:
*15/03/1998*`
  })
}

// ======================================================
// FINALIZAR CURRÍCULO
// ======================================================

async function finalizarCurriculo(jid) {
  const sessao = sessions.get(jid)

  if (!sessao) {
    return
  }

  const d = sessao.dados

  let texto = ''

  texto += `📄 *CURRÍCULO PROFISSIONAL*\n\n`

  texto += `👤 *DADOS PESSOAIS*\n`
  texto += `Nome: ${d.nome || 'Não informado'}\n`
  texto += `Data de nascimento: ${d.dataNascimento || 'Não informado'}\n`
  texto += `Idade: ${d.idade || 'Não informado'} anos\n`
  texto += `Estado civil: ${d.estadoCivil || 'Não informado'}\n`
  texto += `Nacionalidade: ${d.nacionalidade || 'Não informado'}\n\n`

  texto += `🏠 *ENDEREÇO*\n`
  texto += `${d.endereco || ''}, ${d.numero || ''}\n`

  if (d.complemento) {
    texto += `${d.complemento}\n`
  }

  texto += `${d.bairro || ''} - ${d.cidade || ''}/${d.estado || ''}\n`
  texto += `CEP: ${d.cep || 'Não informado'}\n\n`

  texto += `📞 *CONTATO*\n`
  texto += `Telefone: ${d.telefone || 'Não informado'}\n`
  texto += `E-mail: ${d.email || 'Não informado'}\n\n`

  // ====================================================
  // EXPERIÊNCIA
  // ====================================================

  texto += `💼 *EXPERIÊNCIA PROFISSIONAL*\n`

  if (d.experiencia && d.experiencia.length > 0) {
    d.experiencia.forEach((exp, index) => {
      texto += `\n${index + 1}. ${exp.cargo || ''}\n`
      texto += `Empresa: ${exp.empresa || ''}\n`
      texto += `Cargo: ${exp.funcao || ''}\n`
      texto += `Período: ${exp.inicio || ''} até ${exp.fim || ''}\n`
    })
  } else {
    texto += `Não informado.\n`
  }

  texto += `\n`

  // ====================================================
  // FORMAÇÃO
  // ====================================================

  texto += `🎓 *FORMAÇÃO ACADÊMICA*\n`
  texto += `${d.formacao || 'Não informado'}\n\n`

  // ====================================================
  // CURSOS
  // ====================================================

  texto += `📚 *CURSOS E QUALIFICAÇÕES*\n`

  if (d.cursos && d.cursos.length > 0) {
    d.cursos.forEach((curso, index) => {
      texto += `\n${index + 1}. ${curso.nome || ''}\n`
      texto += `Instituição: ${curso.instituicao || ''}\n`
      texto += `Ano: ${curso.ano || ''}\n`
    })
  } else {
    texto += `Não informado.\n`
  }

  texto += `\n`

  // ====================================================
  // HABILIDADES
  // ====================================================

  texto += `🛠️ *HABILIDADES*\n`

  if (d.habilidades && d.habilidades.length > 0) {
    texto += d.habilidades.join(', ')
  } else {
    texto += `Não informado.`
  }

  texto += `\n\n`

  // ====================================================
  // OBJETIVO
  // ====================================================

  texto += `🎯 *OBJETIVO PROFISSIONAL*\n`
  texto += `${d.objetivo || 'Não informado'}\n`

  // ====================================================
  // ENVIAR PARA DESTINO
  // ====================================================

  await sock.sendMessage(DESTINO_FINAL, {
    text: texto
  })

  await sock.sendMessage(jid, {
    text:
`✅ *Currículo finalizado com sucesso!*

📄 Seus dados foram organizados e enviados para análise.

Obrigado por utilizar nosso atendimento! 😊`
  })

  sessions.delete(jid)

  registrarLog(`Currículo finalizado: ${jid}`)
}

// ======================================================
// PROCESSAR MENSAGEM
// ======================================================

async function processarMensagem(jid, txt) {

  const texto = String(txt || '').trim()

  if (!texto) {
    return
  }

  const textoNormalizado = normalizarTexto(texto)

  registrarLog(`Mensagem de ${jid}: ${texto}`)

  // ====================================================
  // SE NÃO EXISTE CADASTRO
  // ====================================================

  if (!sessions.has(jid)) {

    // Primeira interação:
    // mostra a apresentação e NÃO inicia o currículo.

    if (
      textoNormalizado !== '1'
    ) {
      await enviarApresentacao(jid)

      // Aqui o cliente pode continuar conversando
      // normalmente sem iniciar o currículo.

      return
    }

    // Se digitou 1, começa o currículo.

    await iniciarCurriculo(jid)

    return
  }

  // ====================================================
  // EXISTE UMA SESSÃO
  // ====================================================

  const sessao = sessions.get(jid)

  // ====================================================
  // CANCELAR
  // ====================================================

  if (pediuCancelar(texto)) {

    sessions.delete(jid)

    await sock.sendMessage(jid, {
      text:
`❌ Cadastro cancelado.

Quando quiser criar um currículo novamente, digite *1*.`
    })

    return
  }

  const d = sessao.dados

  // ====================================================
  // DATA DE NASCIMENTO
  // ====================================================

  if (sessao.step === 'dataNascimento') {

    if (!validarDataNascimento(texto)) {

      await sock.sendMessage(jid, {
        text:
`❌ Data inválida.

Digite sua data de nascimento no formato:

*DD/MM/AAAA*

Exemplo:
*15/03/1998*`
      })

      return
    }

    d.dataNascimento = texto
    d.idade = calcularIdade(texto)

    await sock.sendMessage(jid, {
      text:
`✅ Data registrada: ${d.dataNascimento}

🎂 Sua idade foi calculada automaticamente:
*${d.idade} anos*

👤 Agora informe seu *nome completo*.`
    })

    sessao.step = 'nome'

    return
  }

  // ====================================================
  // NOME
  // ====================================================

  if (sessao.step === 'nome') {

    if (texto.length < 3) {

      await sock.sendMessage(jid, {
        text:
`❌ Informe seu nome completo.`
      })

      return
    }

    d.nome = texto

    await sock.sendMessage(jid, {
      text:
`🌎 Qual é a sua *nacionalidade*?

Exemplo:
Brasileiro`
    })

    sessao.step = 'nacionalidade'

    return
  }

  // ====================================================
  // NACIONALIDADE
  // ====================================================

  if (sessao.step === 'nacionalidade') {

    d.nacionalidade = texto

    await sock.sendMessage(jid, {
      text:
`🏠 Informe o nome da sua *rua/avenida*.`
    })

    sessao.step = 'endereco'

    return
  }

  // ====================================================
  // ENDEREÇO
  // ====================================================

  if (sessao.step === 'endereco') {

    d.endereco = texto

    await sock.sendMessage(jid, {
      text:
`🔢 Informe o *número* do endereço.`
    })

    sessao.step = 'numero'

    return
  }

  // ====================================================
  // NÚMERO
  // ====================================================

  if (sessao.step === 'numero') {

    d.numero = texto

    await sock.sendMessage(jid, {
      text:
`🏠 Possui *complemento*?

Se não possuir, digite:

*não*`
    })

    sessao.step = 'complemento'

    return
  }

  // ====================================================
  // COMPLEMENTO
  // ====================================================

  if (sessao.step === 'complemento') {

    if (textoNormalizado !== 'nao') {
      d.complemento = texto
    } else {
      d.complemento = ''
    }

    await sock.sendMessage(jid, {
      text:
`📍 Informe o seu *bairro*.`
    })

    sessao.step = 'bairro'

    return
  }

  // ====================================================
  // BAIRRO
  // ====================================================

  if (sessao.step === 'bairro') {

    d.bairro = texto

    await sock.sendMessage(jid, {
      text:
`🏙️ Informe sua *cidade*.`
    })

    sessao.step = 'cidade'

    return
  }

  // ====================================================
  // CIDADE
  // ====================================================

  if (sessao.step === 'cidade') {

    d.cidade = texto

    await sock.sendMessage(jid, {
      text:
`🗺️ Informe o seu *estado*.

Exemplo:
SP`
    })

    sessao.step = 'estado'

    return
  }

  // ====================================================
  // ESTADO
  // ====================================================

  if (sessao.step === 'estado') {

    d.estado = texto.toUpperCase()

    await sock.sendMessage(jid, {
      text:
`📮 Informe seu *CEP*.

Exemplo:
09300-000`
    })

    sessao.step = 'cep'

    return
  }

  // ====================================================
  // CEP
  // ====================================================

  if (sessao.step === 'cep') {

    if (!validarCEP(texto)) {

      await sock.sendMessage(jid, {
        text:
`❌ CEP inválido.

Digite um CEP com 8 números.

Exemplo:
09300-000`
      })

      return
    }

    d.cep = formatarCEP(texto)

    await sock.sendMessage(jid, {
      text:
`📞 Informe seu *telefone* com DDD.

Exemplo:
11942047248`
    })

    sessao.step = 'telefone'

    return
  }

  // ====================================================
  // TELEFONE
  // ====================================================

  if (sessao.step === 'telefone') {

    if (!validarTelefone(texto)) {

      await sock.sendMessage(jid, {
        text:
`❌ Telefone inválido.

Informe seu telefone com DDD.

Exemplo:
11942047248`
      })

      return
    }

    d.telefone = formatarTelefone(texto)

    await sock.sendMessage(jid, {
      text:
`📧 Informe seu *e-mail*.

Exemplo:
nome@gmail.com`
    })

    sessao.step = 'email'

    return
  }

  // ====================================================
  // EMAIL
  // ====================================================

  if (sessao.step === 'email') {

    if (!validarEmail(texto)) {

      await sock.sendMessage(jid, {
        text:
`❌ E-mail inválido.

Digite um e-mail válido.

Exemplo:
nome@gmail.com`
      })

      return
    }

    d.email = texto

    await sock.sendMessage(jid, {
      text:
`💼 Agora vamos cadastrar sua *experiência profissional*.

Qual foi o seu último cargo?`
    })

    sessao.step = 'experienciaCargo'

    return
  }

  // ====================================================
  // EXPERIÊNCIA - CARGO
  // ====================================================

  if (sessao.step === 'experienciaCargo') {

    sessao.experienciaAtual = {
      cargo: texto
    }

    await sock.sendMessage(jid, {
      text:
`🏢 Qual era o nome da *empresa*?`
    })

    sessao.step = 'experienciaEmpresa'

    return
  }

  // ====================================================
  // EXPERIÊNCIA - EMPRESA
  // ====================================================

  if (sessao.step === 'experienciaEmpresa') {

    sessao.experienciaAtual.empresa = texto

    await sock.sendMessage(jid, {
      text:
`💼 Qual era sua *função/cargo* nessa empresa?`
    })

    sessao.step = 'experienciaFuncao'

    return
  }

  // ====================================================
  // EXPERIÊNCIA - FUNÇÃO
  // ====================================================

  if (sessao.step === 'experienciaFuncao') {

    sessao.experienciaAtual.funcao = texto

    await sock.sendMessage(jid, {
      text:
`📅 Informe o mês e ano em que começou.

Exemplo:
03/2022`
    })

    sessao.step = 'experienciaInicio'

    return
  }

  // ====================================================
  // EXPERIÊNCIA - INÍCIO
  // ====================================================

  if (sessao.step === 'experienciaInicio') {

    if (!validarMesAno(texto)) {

      await sock.sendMessage(jid, {
        text:
`❌ Formato inválido.

Digite no formato:

MM/AAAA

Exemplo:
03/2022`
      })

      return
    }

    sessao.experienciaAtual.inicio = texto

    await sock.sendMessage(jid, {
      text:
`📅 Você ainda trabalha nessa empresa?

Digite:

*sim*

ou

*não*`
    })

    sessao.step = 'experienciaAtual'

    return
  }

  // ====================================================
  // EXPERIÊNCIA - ATUAL
  // ====================================================

  if (sessao.step === 'experienciaAtual') {

    if (textoNormalizado === 'sim') {

      sessao.experienciaAtual.fim = 'Atual'

    } else {

      await sock.sendMessage(jid, {
        text:
`📅 Informe o mês e ano em que saiu.

Exemplo:
08/2025`
      })

      sessao.step = 'experienciaFim'

      return
    }

    d.experiencia.push(sessao.experienciaAtual)

    await sock.sendMessage(jid, {
      text:
`✅ Experiência adicionada!

Deseja adicionar outra experiência?

Digite:

*sim*

ou

*não*`
    })

    sessao.step = 'maisExperiencia'

    return
  }

  // ====================================================
  // EXPERIÊNCIA - FIM
  // ====================================================

  if (sessao.step === 'experienciaFim') {

    if (!validarMesAno(texto)) {

      await sock.sendMessage(jid, {
        text:
`❌ Formato inválido.

Use:

MM/AAAA

Exemplo:
08/2025`
      })

      return
    }

    sessao.experienciaAtual.fim = texto

    d.experiencia.push(sessao.experienciaAtual)

    await sock.sendMessage(jid, {
      text:
`✅ Experiência adicionada!

Deseja adicionar outra experiência?

Digite:

*sim*

ou

*não*`
    })

    sessao.step = 'maisExperiencia'

    return
  }

  // ====================================================
  // MAIS EXPERIÊNCIA
  // ====================================================

  if (sessao.step === 'maisExperiencia') {

    if (textoNormalizado === 'sim') {

      await sock.sendMessage(jid, {
        text:
`💼 Informe o *cargo* da próxima experiência.`
      })

      sessao.step = 'experienciaCargo'

      return
    }

    await sock.sendMessage(jid, {
      text:
`🎓 Agora informe sua *formação acadêmica*.

Exemplo:
Ensino médio completo`
    })

    sessao.step = 'formacao'

    return
  }

  // ====================================================
  // FORMAÇÃO
  // ====================================================

  if (sessao.step === 'formacao') {

    d.formacao = texto

    await sock.sendMessage(jid, {
      text:
`📚 Você possui algum *curso profissionalizante ou curso complementar*?

Digite:

*sim*

ou

*não*`
    })

    sessao.step = 'possuiCurso'

    return
  }

  // ====================================================
  // POSSUI CURSO
  // ====================================================

  if (sessao.step === 'possuiCurso') {

    if (textoNormalizado === 'sim') {

      await sock.sendMessage(jid, {
        text:
`📚 Qual é o nome do curso?`
      })

      sessao.step = 'cursoNome'

      return
    }

    await sock.sendMessage(jid, {
      text:
`🛠️ Informe suas principais *habilidades*.

Exemplo:
Pacote Office, atendimento ao cliente, vendas`
    })

    sessao.step = 'habilidades'

    return
  }

  // ====================================================
  // CURSO - NOME
  // ====================================================

  if (sessao.step === 'cursoNome') {

    sessao.cursoAtual = {
      nome: texto
    }

    await sock.sendMessage(jid, {
      text:
`🏫 Qual foi a *instituição* onde realizou o curso?`
    })

    sessao.step = 'cursoInstituicao'

    return
  }

  // ====================================================
  // CURSO - INSTITUIÇÃO
  // ====================================================

  if (sessao.step === 'cursoInstituicao') {

    sessao.cursoAtual.instituicao = texto

    await sock.sendMessage(jid, {
      text:
`📅 Em qual *ano* concluiu o curso?

Exemplo:
2023`
    })

    sessao.step = 'cursoAno'

    return
  }

  // ====================================================
  // CURSO - ANO
  // ====================================================

  if (sessao.step === 'cursoAno') {

    if (!validarAno(texto)) {

      await sock.sendMessage(jid, {
        text:
`❌ Ano inválido.

Digite o ano com 4 números.

Exemplo:
2023`
      })

      return
    }

    sessao.cursoAtual.ano = texto

    d.cursos.push(sessao.cursoAtual)

    await sock.sendMessage(jid, {
      text:
`✅ Curso adicionado!

Deseja adicionar outro curso?

Digite:

*sim*

ou

*não*`
    })

    sessao.step = 'maisCurso'

    return
  }

  // ====================================================
  // MAIS CURSO
  // ====================================================

  if (sessao.step === 'maisCurso') {

    if (textoNormalizado === 'sim') {

      await sock.sendMessage(jid, {
        text:
`📚 Qual é o nome do próximo curso?`
      })

      sessao.step = 'cursoNome'

      return
    }

    await sock.sendMessage(jid, {
      text:
`🛠️ Informe suas principais *habilidades*.

Exemplo:
Pacote Office, atendimento ao cliente, vendas`
    })

    sessao.step = 'habilidades'

    return
  }

  // ====================================================
  // HABILIDADES
  // ====================================================

  if (sessao.step === 'habilidades') {

    d.habilidades = texto
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)

    await sock.sendMessage(jid, {
      text:
`🎯 Por último, informe seu *objetivo profissional*.

Exemplo:
"Busco uma oportunidade na área administrativa, onde possa aplicar meus conhecimentos e contribuir com a empresa."`
    })

    sessao.step = 'objetivo'

    return
  }

  // ====================================================
  // OBJETIVO
  // ====================================================

  if (sessao.step === 'objetivo') {

    d.objetivo = texto

    await sock.sendMessage(jid, {
      text:
`⏳ Finalizando seu currículo...`
    })

    await finalizarCurriculo(jid)

    return
  }
}

// ======================================================
// CONEXÃO WHATSAPP
// ======================================================

async function conectarWhatsApp() {

  const { state, saveCreds } =
    await useMultiFileAuthState(
      path.join(__dirname, 'auth')
    )

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (update) => {

    const {
      connection,
      lastDisconnect,
      qr
    } = update

    if (qr) {

      qrAtual = qr
      ultimoStatus = 'Aguardando leitura do QR Code'

      registrarLog('Novo QR Code gerado')

      try {

        const qrImagem =
          await QRCode.toDataURL(qr)

        qrAtual = qrImagem

      } catch (erro) {

        registrarLog(
          `Erro ao gerar QR Code: ${erro.message}`
        )
      }
    }

    if (connection === 'open') {

      ultimoStatus = 'Conectado'
      qrAtual = null

      registrarLog(
        'WhatsApp conectado com sucesso'
      )
    }

    if (connection === 'close') {

      ultimoStatus = 'Desconectado'

      const codigo =
        lastDisconnect?.error?.output?.statusCode

      registrarLog(
        `WhatsApp desconectado. Código: ${codigo || 'desconhecido'}`
      )

      if (
        codigo !== DisconnectReason.loggedOut
      ) {

        registrarLog(
          'Tentando reconectar...'
        )

        setTimeout(
          conectarWhatsApp,
          3000
        )
      }
    }
  })

  sock.ev.on(
    'messages.upsert',
    async ({ messages }) => {

      for (const msg of messages) {

        try {

          if (!msg.message) {
            continue
          }

          if (msg.key.fromMe) {
            continue
          }

          const jid = msg.key.remoteJid

          if (!jid || jid.endsWith('@g.us')) {
            continue
          }

          const mensagem =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            ''

          if (!mensagem) {
            continue
          }

          await processarMensagem(
            jid,
            mensagem
          )

        } catch (erro) {

          registrarLog(
            `Erro ao processar mensagem: ${erro.message}`
          )
        }
      }
    }
  )
}

// ======================================================
// ROTAS HTTP
// ======================================================

app.get('/', (req, res) => {

  res.send(`
    <!DOCTYPE html>
    <html lang="pt-BR">

    <head>

      <meta charset="UTF-8">

      <title>Bot Currículo</title>

      <style>

        body {
          font-family: Arial, sans-serif;
          background: #f5f5f5;
          padding: 40px;
        }

        .container {
          max-width: 700px;
          margin: auto;
          background: white;
          padding: 30px;
          border-radius: 15px;
          box-shadow: 0 5px 20px rgba(0,0,0,0.1);
        }

        h1 {
          color: #222;
        }

        .status {
          padding: 15px;
          background: #eee;
          border-radius: 10px;
          margin-top: 20px;
        }

      </style>

    </head>

    <body>

      <div class="container">

        <h1>📄 Gerador de Currículos</h1>

        <p>
          Bot de atendimento via WhatsApp.
        </p>

        <div class="status">

          <strong>Status:</strong>
          ${ultimoStatus}

        </div>

        <p>
          📱 No WhatsApp, o cliente verá a apresentação
          e poderá digitar <strong>1</strong> para criar
          o currículo.
        </p>

      </div>

    </body>

    </html>
  `)
})

// ======================================================

app.get('/whatsapp', (req, res) => {

  res.json({
    status: ultimoStatus,
    conectado: ultimoStatus === 'Conectado',
    mensagem:
      'Digite 1 no WhatsApp para criar um currículo.'
  })
})

// ======================================================

app.get('/qr', (req, res) => {

  if (!qrAtual) {

    return res.send(`
      <h2>QR Code não disponível</h2>
      <p>Status: ${ultimoStatus}</p>
    `)
  }

  res.send(`
    <html>

      <body
        style="
          text-align:center;
          font-family:Arial;
        "
      >

        <h2>📱 Escaneie o QR Code</h2>

        <img
          src="${qrAtual}"
          style="max-width:400px;"
        >

        <p>${ultimoStatus}</p>

      </body>

    </html>
  `)
})

// ======================================================

app.get('/status', (req, res) => {

  res.json({
    status: ultimoStatus,
    sessoes: sessions.size,
    destino: DESTINO_FINAL
  })
})

// ======================================================

app.get('/logs', (req, res) => {

  res.type('text').send(
    logs.join('\n')
  )
})

// ======================================================

app.get('/clear', (req, res) => {

  sessions.clear()

  res.json({
    sucesso: true,
    mensagem: 'Sessões limpas.'
  })
})

// ======================================================
// INICIAR SERVIDOR
// ======================================================

app.listen(PORT, () => {

  console.log(
    `Servidor iniciado na porta ${PORT}`
  )

  registrarLog(
    `Servidor HTTP iniciado na porta ${PORT}`
  )

  conectarWhatsApp()
})
