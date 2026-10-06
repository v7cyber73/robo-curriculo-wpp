const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require('@whiskeysockets/baileys')
const originalError = console.error
console.error = (...args) => {
  const m = args.join(' ')
  if (m.includes('Bad MAC') || m.includes('No matching sessions') || m.includes('SessionError') || m.includes('@lid')) return
  originalError(...args)
}
const express = require('express')
const QRCode = require('qrcode')
const fs = require('fs')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 10000

let qrCodeData = null
let isConnected = false
let sockAtual = null
let reconnectTimer = null
let starting = false
let logs = []
const sessions = new Map()

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ''
const DESTINO_CURRICULOS = process.env.DESTINO_CURRICULOS || '5511942047248@s.whatsapp.net'
const AUTH_DIR = './auth-teste-11954741892'

function log(m) {
  const l = `[${new Date().toLocaleTimeString()}] ${m}`
  console.log(l)
  logs.push(l)
  if (logs.length > 200) logs.shift()
}

try {
  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true })
} catch (e) {
  log(`Erro criando auth: ${e.message}`)
}

function getSession(jid) {
  if (!sessions.has(jid)) {
    sessions.set(jid, {
      step: 'idle',
      data: { experiencias: [], cursos: [] },
      expTemp: {},
      cursoTemp: {}
    })
  }
  return sessions.get(jid)
}

function novoCadastro() {
  return {
    step: 'nome',
    data: { experiencias: [], cursos: [] },
    expTemp: {},
    cursoTemp: {},
    history: []
  }
}

function pushStep(s, step) {
  if (s.step && s.step !== step) s.history.push(s.step)
  s.step = step
}

function voltarPasso(s) {
  if (!s.history.length) return null
  s.step = s.history.pop()
  return s.step
}

function normalizarTexto(txt) {
  return String(txt || '').trim().replace(/\s+/g, ' ')
}

function semAcentos(txt) {
  return normalizarTexto(txt).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

// ---------- VALIDADORES ----------

function calcularIdade(data) {
  const hoje = new Date()
  let idade = hoje.getFullYear() - data.getFullYear()
  const antesDoAniversario =
    hoje.getMonth() < data.getMonth() ||
    (hoje.getMonth() === data.getMonth() && hoje.getDate() < data.getDate())
  if (antesDoAniversario) idade--
  return idade
}

function validarDataNascimento(txt) {
  txt = normalizarTexto(txt)

  let d, m, a, tipo

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(txt)) {
    ;[d, m, a] = txt.split('/').map(Number)
    tipo = 'completa'
  } else if (/^\d{2}\/\d{4}$/.test(txt)) {
    ;[m, a] = txt.split('/').map(Number)
    d = 1
    tipo = 'mes'
  } else if (/^\d{4}$/.test(txt)) {
    a = Number(txt)
    m = 1
    d = 1
    tipo = 'ano'
  } else {
    return {
      ok: false,
      erro: 'Use DD/MM/AAAA, MM/AAAA ou somente AAAA.'
    }
  }

  const hoje = new Date()
  const anoAtual = hoje.getFullYear()

  if (a < 1920 || a > anoAtual) {
    return { ok: false, erro: `Ano inválido. Use entre 1920 e ${anoAtual}.` }
  }
  if (m < 1 || m > 12) return { ok: false, erro: 'Mês inválido (01 a 12).' }

  const diasNoMes = new Date(a, m, 0).getDate()
  if (d < 1 || d > diasNoMes) return { ok: false, erro: 'Dia inválido para o mês informado.' }

  // Para mês/ano e somente ano, usamos o início do período para cálculo conservador.
  const nascimento = new Date(a, m - 1, d)
  if (nascimento > hoje) return { ok: false, erro: 'A data não pode estar no futuro.' }

  const idade = calcularIdade(nascimento)
  if (idade < 12) return { ok: false, erro: 'A idade mínima para este cadastro é 12 anos.' }
  if (idade > 100) return { ok: false, erro: 'Verifique o ano informado.' }

  let exibicao = txt
  if (tipo === 'completa') exibicao = txt
  if (tipo === 'mes') exibicao = txt
  if (tipo === 'ano') exibicao = txt

  return { ok: true, valor: exibicao, idade }
}

function validarDataExp(txt, permitirAtual = true) {
  txt = normalizarTexto(txt)
  const lower = semAcentos(txt)

  if (permitirAtual && ['atual', 'presente', 'hoje', 'atualmente', 'ainda trabalho', 'atualidade'].includes(lower)) {
    return { ok: true, valor: 'Atual', data: null }
  }

  let d, m, a

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(txt)) {
    ;[d, m, a] = txt.split('/').map(Number)
  } else if (/^\d{2}\/\d{4}$/.test(txt)) {
    ;[m, a] = txt.split('/').map(Number)
    d = 1
  } else if (/^\d{4}$/.test(txt)) {
    a = Number(txt)
    m = 1
    d = 1
  } else {
    return { ok: false, erro: 'Formato inválido. Use DD/MM/AAAA, MM/AAAA ou AAAA.' }
  }

  const anoAtual = new Date().getFullYear()
  if (a < 1900 || a > anoAtual) return { ok: false, erro: `Ano inválido. Use entre 1900 e ${anoAtual}.` }
  if (m < 1 || m > 12) return { ok: false, erro: 'Mês inválido (01 a 12).' }

  const dias = new Date(a, m, 0).getDate()
  if (d < 1 || d > dias) return { ok: false, erro: 'Dia inválido para o mês informado.' }

  return {
    ok: true,
    valor: txt,
    data: new Date(a, m - 1, d)
  }
}

function compararDatasInicioFim(inicio, fim) {
  if (!inicio?.data || !fim?.data || fim.valor === 'Atual') return true
  return fim.data >= inicio.data
}

function validarEstadoCivil(txt) {
  const lower = semAcentos(txt)
  const opcoes = {
    solteiro: 'Solteiro(a)', solteira: 'Solteiro(a)',
    casado: 'Casado(a)', casada: 'Casado(a)',
    divorciado: 'Divorciado(a)', divorciada: 'Divorciado(a)',
    viuvo: 'Viúvo(a)', viuva: 'Viúvo(a)',
    separado: 'Separado(a)', separada: 'Separado(a)',
    'uniao estavel': 'União Estável',
    uniao: 'União Estável',
    amasiado: 'União Estável', amasiada: 'União Estável'
  }
  if (opcoes[lower]) return { ok: true, valor: opcoes[lower] }
  return { ok: false }
}

function validarAno(txt) {
  txt = normalizarTexto(txt)
  if (!/^\d{4}$/.test(txt)) return { ok: false, erro: 'Digite somente o ano com 4 números.' }
  const a = Number(txt)
  const anoAtual = new Date().getFullYear()
  if (a < 1900 || a > anoAtual) return { ok: false, erro: `Ano inválido (1900 a ${anoAtual}).` }
  return { ok: true, valor: txt }
}

function validarNome(txt) {
  txt = normalizarTexto(txt)
  const partes = txt.split(' ')
  if (partes.length < 2) return { ok: false, erro: 'Digite nome e sobrenome completo.' }
  if (!/^[A-Za-zÀ-ÖØ-öø-ÿ'’-]+(?: [A-Za-zÀ-ÖØ-öø-ÿ'’-]+)+$/.test(txt)) {
    return { ok: false, erro: 'Use somente letras, espaços e acentos no nome.' }
  }
  return { ok: true, valor: txt }
}

function formatarCEP(txt) {
  const num = txt.replace(/[^0-9]/g, '')
  return num.length === 8 ? `${num.substring(0, 5)}-${num.substring(5)}` : txt
}

function validarCEP(txt) {
  return /^\d{5}-\d{3}$/.test(txt)
}

function formatarTelefone(txt) {
  const num = txt.replace(/[^0-9]/g, '')
  if (num.length === 11) return `(${num.substring(0, 2)}) ${num.substring(2, 7)}-${num.substring(7)}`
  if (num.length === 10) return `(${num.substring(0, 2)}) ${num.substring(2, 6)}-${num.substring(6)}`
  return null
}

function validarTelefoneFormatado(txt) {
  return /^\(\d{2}\) \d{4,5}-\d{4}$/.test(txt)
}

function validarEmail(txt) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(txt)
}

function opcional(txt) {
  return ['nao', 'não', 'n', 'sem', 'nenhum', 'nenhuma', 'nao informado', 'não informado', 'nao sei', 'não sei', 'nao lembro', 'não lembro', 'esqueci'].includes(semAcentos(txt))
}


// ---------- ATENDIMENTO / MENU PRINCIPAL ----------

const HORARIOS = `🕐 *HORÁRIO DE FUNCIONAMENTO*

📅 Segunda a sexta: 10:00 às 17:00
📅 Sábado: 10:00 às 13:00
🚫 Domingo e feriados: fechado`

const PRECOS = `💰 *TABELA DE PREÇOS*

1️⃣ Impressão preto e branco — R$ 1,00
2️⃣ Impressão colorida frente e verso — R$ 1,15
3️⃣ Escâner:
• Até 3 folhas — R$ 2,00
• De 4 a 8 folhas — R$ 5,00
• Acima de 8 folhas — R$ 8,00
4️⃣ Antecedentes Criminais — R$ 5,00
5️⃣ MEI — R$ 8,00
6️⃣ Cópias — R$ 0,70
7️⃣ Boletim de ocorrência — R$ 8,00
8️⃣ Curriculum — R$ 8,00

Para criar seu *Curriculum*, digite exatamente:
👉 *Criar Curriculum*`

function mensagemMenu() {
  return `👋 Olá! Seja bem-vindo(a) à *Conexão v7cyber* 🤖

Como podemos ajudar?

1️⃣ *Consultar preços*
2️⃣ *Horário de funcionamento*
3️⃣ *Falar com atendente*

Digite o número da opção ou escreva o que precisa.

📌 Para fazer seu Curriculum de R$ 8,00, digite:
*Criar Curriculum*`
}

function respostaPreco(txt) {
  const t = semAcentos(txt)

  if (
    t.includes('scanner') || t.includes('scan') ||
    t.includes('escaner') || t.includes('escan') || t.includes('escane')
  ) return `📄 *ESCÂNER*\n\n• Até 3 folhas: R$ 2,00\n• De 4 a 8 folhas: R$ 5,00\n• Acima de 8 folhas: R$ 8,00`

  if (t.includes('antecedente') || t.includes('antecedentes')) return '📄 *Antecedentes Criminais:* R$ 5,00'
  if (t === 'mei' || t.includes('mei')) return '📄 *MEI:* R$ 8,00'
  if (t.includes('copia') || t.includes('copias')) return '📄 *Cópia:* R$ 0,70'
  if (t.includes('boletim') || t.includes('ocorrencia')) return '📄 *Boletim de ocorrência:* R$ 8,00'
  if (t.includes('curriculum') || t.includes('curriculo')) return '📄 *Curriculum:* R$ 8,00\n\nPara iniciar, digite *Criar Curriculum*.'
  if (t.includes('preco') || t.includes('precos')) return PRECOS

  // A regra de colorida/frente e verso vem ANTES da regra genérica
  // de impressão para não responder R$ 1,00 por engano.
  if (
    t.includes('colorida') || t.includes('colorido') ||
    t.includes('frente e verso') || t.includes('frente verso')
  ) {
    return '🖨️ *Impressão colorida frente e verso:* R$ 1,15'
  }

  if (
    t.includes('impressao') || t.includes('imprimir') ||
    t.includes('preto e branco') || t.includes('preto branco') || t.includes('pb')
  ) return '🖨️ *Impressão preto e branco:* R$ 1,00'

  return null
}

function ehHorario(txt) {
  const t = semAcentos(txt)
  return t.includes('horario') || t.includes('funcionamento') || t.includes('abre') ||
    t.includes('fecha') || t.includes('aberto')
}

function ehAtendente(txt) {
  const t = semAcentos(txt)
  return t.includes('atendente') || t.includes('atendimento') || t.includes('falar com') ||
    t.includes('pessoa') || t.includes('humano')
}

function ehSaudacao(txt) {
  const t = semAcentos(txt)
  return ['oi','ola','bom dia','boa tarde','boa noite','menu','ajuda','inicio','comecar'].includes(t)
}

function ehPerguntaDesconhecida(txt) {
  const t = semAcentos(txt)
  return t.length > 2 && (
    t.includes('quanto') || t.includes('valor') || t.includes('preco') ||
    t.includes('precos') || t.includes('faz') || t.includes('fazer')
  )
}

// ---------- WHATSAPP ----------

async function agendarReconexao() {
  if (reconnectTimer || starting) return
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null
    try {
      await startBot()
    } catch (e) {
      log(`Erro na reconexão: ${e.message}`)
      agendarReconexao()
    }
  }, 5000)
}

async function startBot() {
  if (starting) return sockAtual
  starting = true

  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
    let version
    try {
      version = (await fetchLatestBaileysVersion()).version
    } catch (e) {
      version = [2, 3000, 1023223821]
      log('Não foi possível obter a versão Baileys; usando fallback.')
    }

    const sock = makeWASocket({
      version,
      auth: state,
      browser: ['Conexão v7cyber', 'Chrome', '122'],
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false
    })

    sockAtual = sock
    sock.ev.on('creds.update', saveCreds)

    // Evento específico de chamadas do Baileys.
    // A mensagem de chamada nem sempre chega em messages.upsert.
    sock.ev.on('call', async (calls) => {
      for (const call of calls || []) {
        if (call.status !== 'offer' || !call.from) continue
        log(`📞 Chamada recebida de ${call.from}`)
        await sock.sendMessage(call.from, {
          text: '📞 Não conseguimos atender chamadas por aqui. Por favor, envie uma mensagem de texto ou áudio.'
        }).catch((e) => log(`Erro respondendo chamada: ${e.message}`))
      }
    })

    sock.ev.on('connection.update', async (u) => {
      if (u.qr) {
        qrCodeData = u.qr
        isConnected = false
        log('QR gerado - escaneie em /whatsapp')
      }

      if (u.connection === 'open') {
        isConnected = true
        qrCodeData = null
        starting = false
        const meuId = sock.user?.id?.split(':')[0]?.split('@')[0] || 'desconhecido'
        log(`✅ CONECTADO como ${meuId} - Pronto para receber currículos`)
      }

      if (u.connection === 'close') {
        isConnected = false
        qrCodeData = null
        starting = false

        if (sockAtual === sock) sockAtual = null

        const statusCode = u.lastDisconnect?.error?.output?.statusCode
        if (statusCode === DisconnectReason.loggedOut) {
          log('⚠️ Sessão encerrada no WhatsApp. Faça novo pareamento em /whatsapp.')
          return
        }

        log('🔄 Desconectado - reconexão única em 5s')
        agendarReconexao()
      }
    })

    sock.ev.on('messages.upsert', async (up) => {
      for (const m of up.messages) {
        if (!m.message) continue
        const jid = m.key.remoteJid
        if (!jid || jid.includes('@g.us') || m.key.fromMe) continue

        const txt = normalizarTexto(
          m.message.conversation ||
          m.message.extendedTextMessage?.text ||
          ''
        )
        const lower = txt.toLowerCase()
        const lowerSemAcento = semAcentos(txt)

        // Áudio
        if (m.message.audioMessage) {
          await sock.sendMessage(jid, { text: '🎧 Recebi seu áudio! Assim que possível, vou responder. Se preferir, também pode enviar sua mensagem por texto.' })
          continue
        }

        // Chamadas
        if (m.message.call) {
          await sock.sendMessage(jid, { text: '📞 Não conseguimos atender chamadas por aqui. Por favor, envie uma mensagem de texto ou áudio.' }).catch(() => {})
          continue
        }

        if (!txt) continue

        log(`📩 Mensagem de ${jid}: ${txt.substring(0, 60)}`)

        const comandosSair = ['sair', 'cancelar', 'parar', 'desistir', 'exit', 'cancel', 'stop', 'sai', 'cancela']
        if (comandosSair.includes(lowerSemAcento) || lowerSemAcento.includes('quero sair') || lowerSemAcento.includes('quero cancelar')) {
          const sess = sessions.get(jid)
          if (sess && sess.step !== 'idle') {
            sessions.delete(jid)
            await sock.sendMessage(jid, { text: '❌ Cadastro cancelado com sucesso!\n\nSe quiser recomeçar, digite *Criar Curriculum*.' })
          } else {
            await sock.sendMessage(jid, { text: '👋 Você não está em nenhum cadastro.\n\nDigite *Criar Curriculum* para começar.' })
          }
          continue
        }

        // VOLTAR
        if (lowerSemAcento === 'voltar' || lowerSemAcento === 'volta') {
          const sess = sessions.get(jid)
          if (!sess || sess.step === 'idle') {
            await sock.sendMessage(jid, { text: 'ℹ️ Você não está preenchendo um currículo no momento.' })
            continue
          }
          const anterior = voltarPasso(sess)
          if (!anterior) {
            await sock.sendMessage(jid, { text: 'ℹ️ Você já está na primeira pergunta.' })
            continue
          }
          sess.expTemp = {}
          sess.cursoTemp = {}
          await sock.sendMessage(jid, { text: `↩️ Voltamos uma etapa.\n\n${mensagemDaEtapa(anterior, sess)}` })
          continue
        }

        // ---------- MENU / ATENDIMENTO ----------
        // O menu só atua quando o cliente não está preenchendo um currículo.
        const sessAtual = sessions.get(jid)
        const emCurriculo = sessAtual && sessAtual.step !== 'idle'

        if (!emCurriculo) {
          if (ehSaudacao(txt)) {
            await sock.sendMessage(jid, { text: mensagemMenu() })
            continue
          }

          if (lowerSemAcento === '1' || lowerSemAcento === '1️⃣' || lowerSemAcento.includes('consultar prec')) {
            await sock.sendMessage(jid, { text: PRECOS })
            continue
          }

          if (lowerSemAcento === '2' || lowerSemAcento === '2️⃣' || ehHorario(txt)) {
            await sock.sendMessage(jid, { text: HORARIOS })
            continue
          }

          if (lowerSemAcento === '3' || lowerSemAcento === '3️⃣' || ehAtendente(txt)) {
            await sock.sendMessage(jid, { text: '👤 *Falar com atendente*\n\nEnvie sua mensagem por texto ou áudio. Não atendemos chamadas por este número.' })
            continue
          }

          const precoEspecifico = respostaPreco(txt)
          if (precoEspecifico) {
            await sock.sendMessage(jid, { text: precoEspecifico })
            continue
          }

          if (ehPerguntaDesconhecida(txt)) {
            await sock.sendMessage(jid, { text: '⚠️ Esse serviço ou preço ainda não está cadastrado no sistema.\n\nDigite *1* para consultar os preços ou descreva o serviço que procura.' })
            continue
          }
        }

        const gatilho =
          lowerSemAcento.includes('criar curriculum') ||
          lowerSemAcento.includes('criar curriculo') ||
          (lowerSemAcento.includes('criar') && lowerSemAcento.includes('curric')) ||
          lowerSemAcento === 'curriculo' ||
          lowerSemAcento === 'curriculum'

        if (gatilho) {
          sessions.set(jid, novoCadastro())
          await sock.sendMessage(jid, { text: mensagemDaEtapa('nome', sessions.get(jid)) })
          continue
        }

        const s = getSession(jid)
        if (s.step === 'idle') continue
        const d = s.data

        try {
          if (s.step === 'nome') {
            const v = validarNome(txt)
            if (!v.ok) {
              await sock.sendMessage(jid, { text: `⚠️ ${v.erro}\nExemplo: João da Silva` })
              continue
            }
            d.nome = v.valor
            pushStep(s, 'nascimento')
            await sock.sendMessage(jid, { text: mensagemDaEtapa('nascimento', s) })
          }

          else if (s.step === 'nascimento') {
            const v = validarDataNascimento(txt)
            if (!v.ok) {
              await sock.sendMessage(jid, { text: `⚠️ ${v.erro}\n\nAceito:\n• DD/MM/AAAA — 15/03/1983\n• MM/AAAA — 03/1983\n• AAAA — 1983` })
              continue
            }
            d.dataNascimento = v.valor
            d.idade = v.idade
            pushStep(s, 'nacionalidade')
            await sock.sendMessage(jid, { text: mensagemDaEtapa('nacionalidade', s) })
          }

          else if (s.step === 'nacionalidade') {
            d.nacionalidade = txt
            pushStep(s, 'estadoCivil')
            await sock.sendMessage(jid, { text: mensagemDaEtapa('estadoCivil', s) })
          }

          else if (s.step === 'estadoCivil') {
            const v = validarEstadoCivil(txt)
            if (!v.ok) {
              await sock.sendMessage(jid, { text: '⚠️ Estado civil não reconhecido.\n\nDigite, por exemplo: solteiro, casado, divorciado, viúvo, separado ou união estável.' })
              continue
            }
            d.estadoCivil = v.valor
            pushStep(s, 'rua')
            await sock.sendMessage(jid, { text: mensagemDaEtapa('rua', s) })
          }

          else if (s.step === 'rua') {
            d.rua = txt
            pushStep(s, 'numero')
            await sock.sendMessage(jid, { text: mensagemDaEtapa('numero', s) })
          }

          else if (s.step === 'numero') {
            d.numero = txt
            pushStep(s, 'complemento')
            await sock.sendMessage(jid, { text: mensagemDaEtapa('complemento', s) })
          }

          else if (s.step === 'complemento') {
            d.complemento = opcional(txt) ? '' : txt
            pushStep(s, 'bairro')
            await sock.sendMessage(jid, { text: mensagemDaEtapa('bairro', s) })
          }

          else if (s.step === 'bairro') {
            d.bairro = txt
            pushStep(s, 'cidade')
            await sock.sendMessage(jid, { text: mensagemDaEtapa('cidade', s) })
          }

          else if (s.step === 'cidade') {
            d.cidade = txt
            pushStep(s, 'estado')
            await sock.sendMessage(jid, { text: mensagemDaEtapa('estado', s) })
          }

          else if (s.step === 'estado') {
            if (!/^[A-Za-z]{2}$/.test(txt)) {
              await sock.sendMessage(jid, { text: '⚠️ Digite a sigla do estado com 2 letras.\nExemplo: SP' })
              continue
            }
            d.estado = txt.toUpperCase()
            pushStep(s, 'cep')
            await sock.sendMessage(jid, { text: mensagemDaEtapa('cep', s) })
          }

          else if (s.step === 'cep') {
            const cepFormatado = formatarCEP(txt)
            if (!validarCEP(cepFormatado)) {
              await sock.sendMessage(jid, { text: '⚠️ CEP inválido.\nExemplo: 08500-000 ou 08500000' })
              continue
            }
            d.cep = cepFormatado
            pushStep(s, 'telefone')
            await sock.sendMessage(jid, { text: mensagemDaEtapa('telefone', s) })
          }

          else if (s.step === 'telefone') {
            let telFormatado = txt
            const fmt = formatarTelefone(txt)
            if (fmt) telFormatado = fmt
            if (!validarTelefoneFormatado(telFormatado)) {
              await sock.sendMessage(jid, { text: '⚠️ Telefone inválido.\nExemplo: (11) 94204-7248 ou 11942047248' })
              continue
            }
            d.telefone = telFormatado
            pushStep(s, 'email')
            await sock.sendMessage(jid, { text: mensagemDaEtapa('email', s) })
          }

          else if (s.step === 'email') {
            const email = txt.toLowerCase()
            if (!validarEmail(email)) {
              await sock.sendMessage(jid, { text: '⚠️ E-mail inválido.\nExemplo: joao@gmail.com' })
              continue
            }
            d.email = email
            pushStep(s, 'objetivo')
            await sock.sendMessage(jid, { text: mensagemDaEtapa('objetivo', s) })
          }

          else if (s.step === 'objetivo') {
            d.objetivo = txt
            pushStep(s, 'exp_empresa')
            await sock.sendMessage(jid, { text: mensagemDaEtapa('exp_empresa', s) })
          }

          else if (s.step === 'exp_empresa') {
            if (lowerSemAcento.includes('primeiro')) {
              d.experiencias = []
              pushStep(s, 'formacao')
              await sock.sendMessage(jid, { text: mensagemDaEtapa('formacao', s) })
              continue
            }
            s.expTemp = { empresa: txt }
            pushStep(s, 'exp_cargo')
            await sock.sendMessage(jid, { text: `Cargo na *${txt}*?` })
          }

          else if (s.step === 'exp_cargo') {
            s.expTemp.cargo = txt
            pushStep(s, 'exp_inicio')
            await sock.sendMessage(jid, { text: mensagemDaEtapa('exp_inicio', s) })
          }

          else if (s.step === 'exp_inicio') {
            const v = validarDataExp(txt, false)
            if (!v.ok) {
              await sock.sendMessage(jid, { text: `⚠️ ${v.erro}\nUse DD/MM/AAAA, MM/AAAA ou AAAA.` })
              continue
            }
            s.expTemp.inicio = v.valor
            s.expTemp.inicioData = v.data
            pushStep(s, 'exp_fim')
            await sock.sendMessage(jid, { text: mensagemDaEtapa('exp_fim', s) })
          }

          else if (s.step === 'exp_fim') {
            const v = validarDataExp(txt, true)
            if (!v.ok) {
              await sock.sendMessage(jid, { text: `⚠️ ${v.erro}\nUse DD/MM/AAAA, MM/AAAA, AAAA ou *atual*.` })
              continue
            }
            if (!compararDatasInicioFim({ data: s.expTemp.inicioData }, v)) {
              await sock.sendMessage(jid, { text: '⚠️ A data de saída não pode ser anterior à data de início. Tente novamente.' })
              continue
            }
            s.expTemp.fim = v.valor
            delete s.expTemp.inicioData
            d.experiencias.push({ ...s.expTemp })
            s.expTemp = {}
            pushStep(s, 'exp_mais')
            await sock.sendMessage(jid, { text: `✅ Empresa adicionada!\n\nTem mais empresas? Responda *sim* ou *não*.` })
          }

          else if (s.step === 'exp_mais') {
            if (lowerSemAcento.startsWith('s')) {
              pushStep(s, 'exp_empresa')
              await sock.sendMessage(jid, { text: '🏢 Nome da próxima empresa?' })
            } else if (lowerSemAcento.startsWith('n')) {
              pushStep(s, 'formacao')
              await sock.sendMessage(jid, { text: mensagemDaEtapa('formacao', s) })
            } else {
              await sock.sendMessage(jid, { text: 'Responda somente *sim* ou *não*.' })
            }
          }

          else if (s.step === 'formacao') {
            d.formacao = txt
            pushStep(s, 'curso_pergunta')
            await sock.sendMessage(jid, { text: mensagemDaEtapa('curso_pergunta', s) })
          }

          else if (s.step === 'curso_pergunta') {
            if (lowerSemAcento.startsWith('s')) {
              pushStep(s, 'curso_nome')
              await sock.sendMessage(jid, { text: '📚 Nome do curso?' })
            } else if (lowerSemAcento.startsWith('n')) {
              pushStep(s, 'habilidades')
              await sock.sendMessage(jid, { text: mensagemDaEtapa('habilidades', s) })
            } else {
              await sock.sendMessage(jid, { text: 'Responda somente *sim* ou *não*.' })
            }
          }

          else if (s.step === 'curso_nome') {
            s.cursoTemp = { nome: txt }
            pushStep(s, 'curso_inst')
            await sock.sendMessage(jid, { text: `🏫 Onde fez *${txt}*?\n\nSe não lembrar ou não quiser informar, digite *não informado*.` })
          }

          else if (s.step === 'curso_inst') {
            s.cursoTemp.instituicao = opcional(txt) ? 'Não informado' : txt
            pushStep(s, 'curso_ano')
            await sock.sendMessage(jid, { text: '📅 Ano do curso?\nEx: 2023\nSe não lembrar, digite *não lembro*.' })
          }

          else if (s.step === 'curso_ano') {
            if (opcional(txt)) {
              s.cursoTemp.ano = 'Não informado'
            } else {
              const v = validarAno(txt)
              if (!v.ok) {
                await sock.sendMessage(jid, { text: `⚠️ ${v.erro}\nOu digite *não lembro*.` })
                continue
              }
              s.cursoTemp.ano = v.valor
            }
            d.cursos.push({ ...s.cursoTemp })
            s.cursoTemp = {}
            pushStep(s, 'curso_mais')
            await sock.sendMessage(jid, { text: '✅ Curso adicionado!\n\nTem mais cursos? *sim* ou *não*.' })
          }

          else if (s.step === 'curso_mais') {
            if (lowerSemAcento.startsWith('s')) {
              pushStep(s, 'curso_nome')
              await sock.sendMessage(jid, { text: '📚 Nome do próximo curso?' })
            } else if (lowerSemAcento.startsWith('n')) {
              pushStep(s, 'habilidades')
              await sock.sendMessage(jid, { text: mensagemDaEtapa('habilidades', s) })
            } else {
              await sock.sendMessage(jid, { text: 'Responda somente *sim* ou *não*.' })
            }
          }

          else if (s.step === 'habilidades') {
            d.habilidades = opcional(txt) ? '' : txt
            pushStep(s, 'resumo')
            await sock.sendMessage(jid, { text: mensagemDaEtapa('resumo', s) })
          }

          else if (s.step === 'resumo') {
            d.resumo = opcional(txt) ? '' : txt
            await finalizarCurriculo(jid, d, s, sock)
          }
        } catch (e) {
          log(`Erro processando ${jid}: ${e.message}`)
          await sock.sendMessage(jid, { text: '⚠️ Ocorreu um erro ao processar sua resposta. Tente novamente.' }).catch(() => {})
        }
      }
    })
  } finally {
    if (!sockAtual) starting = false
  }

  return sock
}

function mensagemDaEtapa(step) {
  const mensagens = {
    nome: '👋 Olá! Sou o Robô da Conexão v7cyber 🤖\n\nVamos montar seu currículo profissional!\n\n💡 A qualquer momento digite *voltar*, *sair* ou *cancelar*.\n\n1️⃣ Qual seu nome e sobrenome completo?\nEx: João da Silva',
    nascimento: '2️⃣ Data de nascimento?\n\nAceito:\n• DD/MM/AAAA — Ex: 15/03/1983\n• MM/AAAA — Ex: 03/1983\n• AAAA — Ex: 1983',
    nacionalidade: '3️⃣ Nacionalidade?\nEx: Brasileiro',
    estadoCivil: '4️⃣ Estado civil?\nEx: Solteiro, Casado, Divorciado, Viúvo ou União Estável',
    rua: '5️⃣ Nome da RUA / Avenida?\nEx: Rua das Flores',
    numero: '6️⃣ NÚMERO da casa?\nEx: 123',
    complemento: '7️⃣ COMPLEMENTO?\nEx: Apto 101, Bloco B\nSe não tiver, digite *não*',
    bairro: '8️⃣ BAIRRO?\nEx: Centro',
    cidade: '9️⃣ CIDADE?\nEx: São Paulo',
    estado: '🔟 ESTADO (sigla 2 letras)?\nEx: SP, RJ, MG',
    cep: '1️⃣1️⃣ CEP?\nFormato: 00000-000\nPode digitar só números também: 08500000',
    telefone: '1️⃣2️⃣ TELEFONE / WhatsApp?\nEx: (11) 94204-7248\nPode digitar só números: 11942047248',
    email: '1️⃣3️⃣ E-MAIL?\nEx: joao@gmail.com',
    objetivo: '1️⃣4️⃣ OBJETIVO PROFISSIONAL?\nEx: Auxiliar administrativo, Vendedor, Motorista',
    exp_empresa: '1️⃣5️⃣ Nome da empresa?\nSe for seu primeiro emprego, digite *primeiro emprego*.',
    exp_inicio: '📅 Data de INÍCIO?\nAceito: DD/MM/AAAA, MM/AAAA ou AAAA.\nEx: 15/03/2022, 03/2022 ou 2022',
    exp_fim: '📅 Data de SAÍDA?\nAceito: DD/MM/AAAA, MM/AAAA ou AAAA.\nSe ainda trabalha lá, digite *atual*.',
    formacao: '🎓 Qual sua formação?\nEx: Ensino médio completo, Superior em Administração',
    curso_pergunta: '📚 Tem cursos? Responda *sim* ou *não*.',
    habilidades: '💡 HABILIDADES — Opcional\n\nDigite suas habilidades ou *pular* para não incluir.\nEx: Informática, Atendimento ao cliente, Pacote Office, CNH B',
    resumo: '📝 RESUMO PROFISSIONAL — Opcional\n\nDigite seu resumo ou *pular* para não incluir.'
  }
  return mensagens[step] || 'Continue o preenchimento.'
}

async function finalizarCurriculo(jid, d, s, sock) {
  const exps = d.experiencias.map((e, i) =>
    `${i + 1}. ${e.empresa.toUpperCase()}\nCargo: ${e.cargo}\nPeríodo: ${e.inicio} até ${e.fim}`
  ).join('\n\n') || 'Primeiro emprego'

  const cursos = d.cursos.map((c, i) =>
    `${i + 1}. ${c.nome}\nInstituição: ${c.instituicao}\nAno: ${c.ano}`
  ).join('\n\n') || 'Nenhum'

  const enderecoCompleto = `${d.rua}, ${d.numero}${d.complemento ? ' - ' + d.complemento : ''} - ${d.bairro} - ${d.cidade}/${d.estado} - CEP ${d.cep}`

  const textoModelo = `🔔 *NOVO CURRÍCULO - Conexão v7cyber*

*👤 DADOS PESSOAIS*
*Nome:* ${d.nome}
*Nascimento:* ${d.dataNascimento} (${d.idade} anos)
*Nacionalidade:* ${d.nacionalidade}
*Estado Civil:* ${d.estadoCivil}
*Endereço:* ${enderecoCompleto}
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

Prezados(as),

Meu nome é ${d.nome}, ${d.idade} anos, ${d.nacionalidade}, ${d.estadoCivil}.
Meu objetivo é atuar como ${d.objetivo}.
${d.experiencias[0]
    ? `Possuo experiência como ${d.experiencias[0].cargo} na ${d.experiencias[0].empresa.toUpperCase()}.`
    : 'Estou em busca da minha primeira oportunidade profissional.'}
Formação: ${d.formacao}.
${d.habilidades ? `Tenho como habilidades: ${d.habilidades}.` : ''}
${d.resumo ? `${d.resumo}` : ''}
Coloco-me à disposição para uma entrevista.

Atenciosamente,
${d.nome}
`

  const nomeSeguro = d.nome.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ0-9 _-]/g, '').replace(/\s+/g, '_')
  const nomeArquivo = `CURRICULO-${nomeSeguro}.txt`
  const caminhoArquivo = path.join(__dirname, nomeArquivo)

  try {
    fs.writeFileSync(caminhoArquivo, textoModelo, 'utf8')
    log(`📄 Arquivo temporário criado: ${nomeArquivo}`)
  } catch (e) {
    log(`Erro ao criar arquivo: ${e.message}`)
  }

  try {
    log(`📤 Enviando currículo de ${d.nome} para destino configurado`)
    await sock.sendMessage(DESTINO_CURRICULOS, { text: textoModelo })

    if (fs.existsSync(caminhoArquivo)) {
      await new Promise(r => setTimeout(r, 800))
      await sock.sendMessage(DESTINO_CURRICULOS, {
        document: fs.readFileSync(caminhoArquivo),
        mimetype: 'text/plain',
        fileName: nomeArquivo
      })
    }
    log('✅ Currículo enviado ao destino')
  } catch (e) {
    log(`❌ Erro envio currículo: ${e.message}`)
  } finally {
    try { if (fs.existsSync(caminhoArquivo)) fs.unlinkSync(caminhoArquivo) } catch (e) {}
  }

  await sock.sendMessage(jid, {
    text: `✅ Obrigado, ${d.nome}! Seu currículo foi recebido com sucesso!\n\n📧 E-mail: ${d.email}\n📱 Tel: ${d.telefone}\n\n🚀 Conexão v7cyber agradece seu cadastro!`
  }).catch(() => {})

  sessions.delete(jid)
}

// ---------- PAINEL WEB ----------

function autorizado(req) {
  if (!ADMIN_TOKEN) return true
  const token = req.query.token || req.headers['x-admin-token']
  return token === ADMIN_TOKEN
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]))
}

app.get('/', (req, res) => {
  res.send(`<h1>Conexão v7cyber</h1><p>${isConnected ? '✅ CONECTADO' : '❌ Desconectado'}</p><a href="/whatsapp">QR WhatsApp</a> | <a href="/logs">Logs</a>`)
})

app.get('/whatsapp', async (req, res) => {
  if (isConnected) {
    return res.send(`<body style="text-align:center;font-family:Arial;padding:40px"><h1 style="color:green">✅ CONECTADO</h1><p>Bot rodando</p><p><b>Gatilho:</b> Criar Curriculum</p><a href="/logs">Logs</a></body>`)
  }
  if (!qrCodeData) return res.send(`<h1>Aguardando QR...</h1><script>setTimeout(()=>location.reload(),3000)</script>`)
  const img = await QRCode.toDataURL(qrCodeData)
  res.send(`<body style="text-align:center;font-family:Arial"><h1>📱 Escaneie o QR</h1><img src="${img}" style="width:380px;border:10px solid #25D366;border-radius:20px"><script>setTimeout(()=>location.reload(),15000)</script></body>`)
})

app.get('/qr', async (req, res) => {
  if (!autorizado(req)) return res.status(401).send('Não autorizado')
  if (isConnected) return res.send('<h1 style="color:green">✅ CONECTADO</h1>')
  if (!qrCodeData) return res.send('<h1>Sem QR</h1>')
  const img = await QRCode.toDataURL(qrCodeData)
  res.send(`<body style="text-align:center"><h1>Escaneie</h1><img src="${img}" style="width:350px"><script>setTimeout(()=>location.reload(),20000)</script></body>`)
})

app.get('/status', (req, res) => {
  if (!autorizado(req)) return res.status(401).json({ error: 'Não autorizado' })
  res.json({ connected: isConnected, hasQR: !!qrCodeData, uptime: process.uptime() })
})

app.get('/logs', (req, res) => {
  if (!autorizado(req)) return res.status(401).send('Não autorizado')
  res.send(`<pre>${escapeHtml(logs.join('\n'))}</pre>`)
})

// Limpa sessão APENAS quando explicitamente solicitado com token.
// Para evitar apagar auth acidentalmente, o endpoint fica desabilitado sem ADMIN_TOKEN.
app.get('/clear', (req, res) => {
  if (!ADMIN_TOKEN) return res.status(403).send('Defina ADMIN_TOKEN para usar esta função.')
  if (!autorizado(req)) return res.status(401).send('Não autorizado')

  try {
    if (sockAtual) sockAtual.end?.(new Error('Sessão limpa pelo administrador'))
  } catch (e) {}

  try {
    fs.rmSync(AUTH_DIR, { recursive: true, force: true })
    fs.mkdirSync(AUTH_DIR, { recursive: true })
  } catch (e) {
    return res.status(500).send('Erro ao limpar sessão: ' + escapeHtml(e.message))
  }

  qrCodeData = null
  isConnected = false
  sockAtual = null
  res.send('Sessão limpa. Recarregando conexão...')
  starting = false
  setTimeout(() => startBot().catch(e => log(`Erro após /clear: ${e.message}`)), 1000)
})

startBot().catch(e => {
  starting = false
  log(`❌ Erro inicializando bot: ${e.message}`)
  agendarReconexao()
})

app.listen(PORT, () => log(`Rodando porta ${PORT} - Currículo flexível + Estado Civil + Voltar + Reconexão segura`))




