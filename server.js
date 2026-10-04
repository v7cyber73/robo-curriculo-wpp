const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys')
const originalError = console.error
console.error = (...args) => { const m = args.join(' '); if(m.includes('Bad MAC') || m.includes('No matching sessions') || m.includes('SessionError') || m.includes('@lid')) return; originalError(...args) }
const express = require('express')
const QRCode = require('qrcode')
const fs = require('fs')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 10000
let qrCodeData = null
let isConnected = false
let logs = []
const sessions = new Map()

function log(m){ const l=`[${new Date().toLocaleTimeString()}] ${m}`; console.log(l); logs.push(l); if(logs.length>200) logs.shift() }
try{ if(!fs.existsSync('./auth')) fs.mkdirSync('./auth',{recursive:true}) }catch(e){}

function getSession(jid){
  if(!sessions.has(jid)) sessions.set(jid, { step: 'idle', data: { experiencias: [], cursos: [] }, expTemp: {}, cursoTemp: {} })
  return sessions.get(jid)
}

// Validadores e formatadores

// Validação de Datas
function validarDataNascimento(txt){
  if(!/^\d{2}\/\d{2}\/\d{4}$/.test(txt)) return {ok:false, erro:'Formato deve ser DD/MM/AAAA'}
  let [d,m,a] = txt.split('/').map(Number)
  if(m<1 || m>12) return {ok:false, erro:'Mês inválido (01 a 12)'}
  if(a<1920 || a>2026) return {ok:false, erro:'Ano inválido (1920 a 2026)'}
  let diasNoMes = [31, (a%4===0 && a%100!==0 || a%400===0)?29:28, 31,30,31,30,31,31,30,31,30,31]
  if(d<1 || d>diasNoMes[m-1]) return {ok:false, erro:`Dia inválido para mês ${m}. Máximo ${diasNoMes[m-1]}`}
  let hoje = new Date()
  let nasc = new Date(a, m-1, d)
  if(nasc > hoje) return {ok:false, erro:'Data de nascimento não pode ser no futuro'}
  // Idade minima 12
  let idade = hoje.getFullYear() - a
  if(idade<12) return {ok:false, erro:'Idade mínima 12 anos'}
  if(idade>100) return {ok:false, erro:'Verifique o ano, idade muito alta'}
  return {ok:true}
}
function validarDataExp(txt){
  let lower = txt.toLowerCase().trim()
  if(['atual','presente','hoje','atualmente','ainda trabalho','atualidade'].includes(lower)) return {ok:true, valor:'Atual'}
  // DD/MM/AAAA
  if(/^\d{2}\/\d{2}\/\d{4}$/.test(txt)){
    let [d,m,a] = txt.split('/').map(Number)
    if(m<1 || m>12) return {ok:false, erro:'Mês inválido'}
    if(a<1980 || a>2026) return {ok:false, erro:'Ano inválido (1980 a 2026)'}
    let dias = [31, (a%4===0 && a%100!==0 || a%400===0)?29:28, 31,30,31,30,31,31,30,31,30,31]
    if(d<1 || d>dias[m-1]) return {ok:false, erro:'Dia inválido'}
    return {ok:true, valor:txt}
  }
  // MM/AAAA
  if(/^\d{2}\/\d{4}$/.test(txt)){
    let [m,a] = txt.split('/').map(Number)
    if(m<1 || m>12) return {ok:false, erro:'Mês inválido (01 a 12)'}
    if(a<1980 || a>2026) return {ok:false, erro:'Ano inválido'}
    return {ok:true, valor:txt}
  }
  return {ok:false, erro:'Formato inválido. Use MM/AAAA (03/2022) ou DD/MM/AAAA (15/03/2022) ou digite *atual*'}
}

function validarEstadoCivil(txt){
  let lower = txt.toLowerCase().trim()
  const opcoes = {
    'solteiro':'Solteiro(a)',
    'solteira':'Solteiro(a)',
    'casado':'Casado(a)',
    'casada':'Casado(a)',
    'divorciado':'Divorciado(a)',
    'divorciada':'Divorciado(a)',
    'viuvo':'Viúvo(a)',
    'viúvo':'Viúvo(a)',
    'viuva':'Viúvo(a)',
    'viúva':'Viúvo(a)',
    'separado':'Separado(a)',
    'separada':'Separado(a)',
    'uniao estavel':'União Estável',
    'união estável':'União Estável',
    'uniao':'União Estável',
    'amasiado':'União Estável',
    'amasiada':'União Estável'
  }
  if(opcoes[lower]) return {ok:true, valor:opcoes[lower]}
  // Tenta contém
  for(let k in opcoes){
    if(lower.includes(k)) return {ok:true, valor:opcoes[k]}
  }
  return {ok:false}
}

function validarAno(txt){
  if(!/^\d{4}$/.test(txt)) return {ok:false, erro:'Digite só o ano com 4 números'}
  let a = parseInt(txt)
  if(a<1980 || a>2026) return {ok:false, erro:'Ano inválido (1980 a 2026)'}
  return {ok:true}
}

// CEP/TEL/EMAIL já existentes abaixo

function formatarCEP(txt){
  let num = txt.replace(/[^0-9]/g,'')
  if(num.length===8){ return num.substring(0,5)+'-'+num.substring(5) }
  return txt
}
function validarCEP(txt){
  return /^\d{5}-\d{3}$/.test(txt)
}
function formatarTelefone(txt){
  let num = txt.replace(/[^0-9]/g,'')
  if(num.length===11){ // 11942047248
    return `(${num.substring(0,2)}) ${num.substring(2,7)}-${num.substring(7)}`
  }
  if(num.length===10){ // 1133334444
    return `(${num.substring(0,2)}) ${num.substring(2,6)}-${num.substring(6)}`
  }
  return null
}
function validarTelefoneFormatado(txt){
  return /^\(\d{2}\) \d{4,5}-\d{4}$/.test(txt)
}
function validarEmail(txt){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(txt)
}

async function startBot(){
  const { state, saveCreds } = await useMultiFileAuthState('./auth')
  let version; try{ version=(await fetchLatestBaileysVersion()).version }catch(e){ version=[2,3000,1023223821] }
  const sock = makeWASocket({ version, auth: state, browser:['Conexão v7cyber','Chrome','122'], markOnlineOnConnect:false })
  
  sock.ev.on('creds.update', saveCreds)
  sock.ev.on('connection.update', (u)=>{
    if(u.qr){ qrCodeData=u.qr; isConnected=false; log('QR gerado - escaneie em /whatsapp') }
    if(u.connection==='close'){ isConnected=false; log('Desconectado - reconectando em 5s'); setTimeout(startBot,5000) }
    if(u.connection==='open'){ 
      isConnected=true; qrCodeData=null; 
      const meuId = sock.user.id.split(':')[0].split('@')[0]
      log(`✅ CONECTADO como ${meuId} - Pronto para receber curriculos`)
    }
  })

  sock.ev.on('messages.upsert', async (up)=>{
    for(const m of up.messages){
      if(!m.message) continue
      const jid=m.key.remoteJid
      if(!jid || jid.includes('@g.us') || m.key.fromMe) continue
      const txt=(m.message.conversation || m.message.extendedTextMessage?.text || '').trim()
      if(!txt) continue
      const lower=txt.toLowerCase()
      
      log(`📩 Mensagem de ${jid}: ${txt.substring(0,60)}`)
      
      // FUNÇÃO SAIR / CANCELAR A QUALQUER MOMENTO
      const comandosSair = ['sair','cancelar','parar','desistir','exit','cancel','stop','sai','cancela']
      if(comandosSair.includes(lower) || lower.includes('quero sair') || lower.includes('quero cancelar')){
        const sess = sessions.get(jid)
        if(sess && sess.step!=='idle'){
          sessions.delete(jid)
          log(`🚪 ${jid} cancelou o preenchimento`)
          await sock.sendMessage(jid, {text:`❌ Cadastro cancelado com sucesso!

Se quiser recomeçar, digite *Criar Curriculum*

🤖 Conexão v7cyber`})
        } else {
          await sock.sendMessage(jid, {text:`👋 Você não está em nenhum cadastro no momento.

Digite *Criar Curriculum* para começar um novo currículo.

🤖 Conexão v7cyber`})
        }
        continue
      }

      const gatilho = lower.includes('criar curriculum') || lower.includes('criar curriculo') || lower.includes('criar currículo') || lower.includes('criar') && lower.includes('curric') || lower==='curriculo' || lower==='curriculum'
      if(gatilho){
        sessions.set(jid, { step: 'nome', data: { experiencias: [], cursos: [] }, expTemp: {}, cursoTemp: {} })
        await sock.sendMessage(jid, {text:`👋 Olá! Sou o Robô da Conexão v7cyber 🤖

Vamos montar seu currículo profissional!

💡 Dica: A qualquer momento digite *sair* ou *cancelar* para cancelar

1️⃣ Qual seu nome e sobrenome completo?`})
        continue
      }
      const s = getSession(jid)
      if(s.step==='idle') continue
      const d=s.data

      try{
        if(s.step==='nome'){ 
          if(txt.split(' ').length<2){ await sock.sendMessage(jid,{text:`⚠️ Digite nome e sobrenome completo
Ex: João Silva`}); continue } 
          d.nome=txt; s.step='nascimento'; await sock.sendMessage(jid,{text:`2️⃣ Data de nascimento?
📅 Formato: DD/MM/AAAA
Ex: 15/03/1998`}) 
        }
        else if(s.step==='nascimento'){ 
          if(!txt.includes('/') || txt.length<8){ await sock.sendMessage(jid,{text:`⚠️ Use formato DD/MM/AAAA
Ex: 15/03/1998`}); continue } 
          d.dataNascimento=txt; s.step='nacionalidade'; await sock.sendMessage(jid,{text:`3️⃣ Nacionalidade?
Ex: Brasileiro`}) 
        }
        else if(s.step==='nacionalidade'){ d.nacionalidade=txt; s.step='rua'; await sock.sendMessage(jid,{text:`4️⃣ Nome da RUA / Avenida?
Ex: Rua das Flores`}) }
        else if(s.step==='rua'){ d.rua=txt; s.step='numero'; await sock.sendMessage(jid,{text:`6️⃣ NÚMERO da casa?
Ex: 123`}) }
        else if(s.step==='numero'){ d.numero=txt; s.step='complemento'; await sock.sendMessage(jid,{text:`7️⃣ COMPLEMENTO?
Ex: Apto 101, Bloco B
Se não tiver, digite: *não*`}) }
        else if(s.step==='complemento'){ 
          if(lower==='não' || lower==='nao' || lower==='sem' || lower==='n' || lower==='nenhum'){ d.complemento=''; } else { d.complemento=txt; } 
          s.step='bairro'; await sock.sendMessage(jid,{text:`8️⃣ BAIRRO?
Ex: Centro`}) 
        }
        else if(s.step==='bairro'){ d.bairro=txt; s.step='cidade'; await sock.sendMessage(jid,{text:`9️⃣ CIDADE?
Ex: São Paulo`}) }
        else if(s.step==='cidade'){ d.cidade=txt; s.step='estado'; await sock.sendMessage(jid,{text:`🔟 ESTADO (sigla 2 letras)?
Ex: SP, RJ, MG`}) }
        else if(s.step==='estado'){ 
          if(txt.length!==2){ await sock.sendMessage(jid,{text:`⚠️ Digite só a sigla com 2 letras
Ex: SP`}); continue } 
          d.estado=txt.toUpperCase(); s.step='cep'; await sock.sendMessage(jid,{text:`1️⃣1️⃣ CEP?
📮 Formato correto: 00000-000
Ex: 08500-000
Pode digitar só números também: 08500000`}) 
        }
        else if(s.step==='cep'){ 
          let cepFormatado = formatarCEP(txt)
          if(!validarCEP(cepFormatado)){ await sock.sendMessage(jid,{text:`⚠️ CEP inválido!
📮 Formato correto: 00000-000
Ex: 08500-000
Tente novamente:`}); continue }
          d.cep=cepFormatado; s.step='telefone'; await sock.sendMessage(jid,{text:`1️⃣2️⃣ TELEFONE / WhatsApp?
📱 Formato correto: (xx) xxxxx-xxxx
Ex: (11) 94204-7248
Pode digitar só números: 11942047248`}) 
        }
        else if(s.step==='telefone'){ 
          let telFormatado = txt
          // Se digitou só números, formata
          let soNumeros = txt.replace(/[^0-9]/g,'')
          if(soNumeros.length>=10){
            let fmt = formatarTelefone(txt)
            if(fmt) telFormatado = fmt
          }
          if(!validarTelefoneFormatado(telFormatado)){ 
            await sock.sendMessage(jid,{text:`⚠️ Telefone inválido!
📱 Formato correto: (xx) xxxxx-xxxx
Ex: (11) 94204-7248
Ex: (11) 3333-4444
Tente novamente:`}); continue 
          }
          d.telefone=telFormatado; s.step='email'; await sock.sendMessage(jid,{text:`1️⃣3️⃣ EMAIL?
📧 Formato correto: nome@email.com
Ex: joao@gmail.com`}) 
        }
        else if(s.step==='email'){ 
          let email = txt.toLowerCase().trim()
          if(!validarEmail(email)){ await sock.sendMessage(jid,{text:`⚠️ Email inválido!
📧 Formato correto: nome@email.com
Ex: joao@gmail.com
Tente novamente:`}); continue }
          d.email=email; s.step='idade'; await sock.sendMessage(jid,{text:`1️⃣4️⃣ Idade?
Ex: 25`}) 
        }
        else if(s.step==='idade'){ 
          if(isNaN(parseInt(txt))){ await sock.sendMessage(jid,{text:`⚠️ Digite só números
Ex: 25`}); continue }
          d.idade=txt; s.step='objetivo'; await sock.sendMessage(jid,{text:`1️⃣5️⃣ Objetivo profissional?
Ex: Auxiliar administrativo, Vendedor, Motorista`}) 
        }
        else if(s.step==='objetivo'){ d.objetivo=txt; s.step='exp_empresa'; await sock.sendMessage(jid,{text:`1️⃣6️⃣ Nome da última empresa? Se for seu primeiro emprego digite *primeiro emprego*`}) }
        else if(s.step==='exp_empresa'){ if(lower.includes('primeiro')){ d.experiencias=[]; s.step='formacao'; await sock.sendMessage(jid,{text:`Primeiro emprego 💪

Qual sua formação?
Ex: Ensino médio completo, Superior em Administração`}); continue } s.expTemp.empresa=txt; s.step='exp_cargo'; await sock.sendMessage(jid,{text:`Cargo na ${txt}?`}) }
        else if(s.step==='exp_cargo'){ s.expTemp.cargo=txt; s.step='exp_inicio'; await sock.sendMessage(jid,{text:`Data INÍCIO? Ex: 03/2022 ou 15/03/2022`}) }
        else if(s.step==='exp_inicio'){ 
          let v = validarDataExp(txt)
          if(!v.ok){ await sock.sendMessage(jid,{text:`⚠️ Data inválida! ${v.erro}\n📅 Formatos válidos:\n• MM/AAAA - Ex: 03/2022\n• DD/MM/AAAA - Ex: 15/03/2022\nTente novamente:`}); continue }
          s.expTemp.inicio=v.valor; s.step='exp_fim'; await sock.sendMessage(jid,{text:`Data SAÍDA?\n📅 Ex: 12/2023 ou 15/12/2023\nOu digite *atual* se ainda trabalha lá`}) }
        else if(s.step==='exp_fim'){ 
          let v = validarDataExp(txt)
          if(!v.ok){ await sock.sendMessage(jid,{text:`⚠️ Data inválida! ${v.erro}\n📅 Formatos válidos:\n• MM/AAAA - Ex: 12/2023\n• DD/MM/AAAA - Ex: 15/12/2023\n• Digite *atual*\nTente novamente:`}); continue }
          s.expTemp.fim=v.valor; d.experiencias.push({...s.expTemp}); s.expTemp={}; s.step='exp_mais'; await sock.sendMessage(jid,{text:`✅ ${d.experiencias[d.experiencias.length-1].empresa} adicionado! Tem mais empresas? sim ou não`}) }
        else if(s.step==='exp_mais'){ if(lower.startsWith('s')){ s.step='exp_empresa'; await sock.sendMessage(jid,{text:`Próxima empresa?`}) } else { s.step='formacao'; await sock.sendMessage(jid,{text:`Qual sua formação?`}) } }
        else if(s.step==='formacao'){ d.formacao=txt; s.step='curso_pergunta'; await sock.sendMessage(jid,{text:`Tem cursos? sim ou não`}) }
        else if(s.step==='curso_pergunta'){ if(lower.startsWith('s')){ s.step='curso_nome'; await sock.sendMessage(jid,{text:`Nome do curso?`}) } else { s.step='habilidades'; await sock.sendMessage(jid,{text:`💡 HABILIDADES - Opcional\n\nTem alguma habilidade para destacar?\nEx: Informática avançada, Atendimento ao cliente, Pacote Office, CNH B\n\nDigite suas habilidades ou digite *pular* para não incluir`}) } }
        else if(s.step==='curso_nome'){ s.cursoTemp.nome=txt; s.step='curso_inst'; await sock.sendMessage(jid,{text:`Onde fez ${txt}?`}) }
        else if(s.step==='curso_inst'){ s.cursoTemp.instituicao=txt; s.step='curso_ano'; await sock.sendMessage(jid,{text:`Ano do curso?\nEx: 2023\nSe não lembrar, digite *não lembro* ou *não sei*`}) }
        else if(s.step==='curso_ano'){ 
          let lowerAno = txt.toLowerCase()
          if(['nao lembro','não lembro','nao sei','não sei','nao','não','n','esqueci','nao lembro o ano'].includes(lowerAno) || lowerAno.includes('lembro') || lowerAno.includes('sei')){
            s.cursoTemp.ano='Não informado';
          } else {
            let v = validarAno(txt)
            if(!v.ok){ await sock.sendMessage(jid,{text:`⚠️ Ano inválido! ${v.erro}\n📅 Digite ano com 4 dígitos - Ex: 2023\nOu digite *não lembro* se não lembrar\nTente novamente:`}); continue }
            s.cursoTemp.ano=txt;
          }
          d.cursos.push({...s.cursoTemp}); s.cursoTemp={}; s.step='curso_mais'; await sock.sendMessage(jid,{text:`✅ Curso adicionado! Mais cursos? sim ou não`}) }
        else if(s.step==='curso_mais'){ if(lower.startsWith('s')){ s.step='curso_nome'; await sock.sendMessage(jid,{text:`Próximo curso?`}) } else { s.step='habilidades'; await sock.sendMessage(jid,{text:`💡 HABILIDADES - Opcional\n\nTem alguma habilidade para destacar?\nEx: Informática avançada, Atendimento ao cliente, Pacote Office, CNH B\n\nDigite suas habilidades ou digite *pular* para não incluir`}) } }

        else if(s.step==='habilidades'){
          let low = lower.trim()
          if(['pular','nao','não','n','sem','nenhum','nao tenho','não tenho'].includes(low) || low.includes('pular')){
            d.habilidades = ''
          } else {
            d.habilidades = txt
          }
          s.step='resumo'; await sock.sendMessage(jid,{text:`📝 RESUMO PROFISSIONAL - Opcional\n\nQuer adicionar um resumo profissional?\nEx: Profissional dedicado com 5 anos de experiência em vendas, busco oportunidade para crescer...\n\nDigite seu resumo ou digite *pular* para não incluir`})
        }
        else if(s.step==='resumo'){
          let low = lower.trim()
          if(['pular','nao','não','n','sem','nenhum','nao tenho','não tenho'].includes(low) || low.includes('pular')){
            d.resumo = ''
          } else {
            d.resumo = txt
          }
          await finalizarCurriculo(jid,d,s,sock)
        }

      }catch(e){ log(`Erro: ${e.message} - ${e.stack}`) }
    }
  })
}

async function finalizarCurriculo(jid,d,s,sock){
  const exps = d.experiencias.map((e,i)=> `${i+1}. ${e.empresa.toUpperCase()}
Cargo: ${e.cargo}
Período: ${e.inicio} até ${e.fim}`).join('\n\n') || 'Primeiro emprego'
  const cursos = d.cursos.map((c,i)=> `${i+1}. ${c.nome} - ${c.instituicao} (${c.ano})`).join('\n') || 'Nenhum'
  const habilidadesTxt = d.habilidades ? d.habilidades : 'Não informado'
  const resumoTxt = d.resumo ? d.resumo : 'Não informado'
  const enderecoCompleto = `${d.rua}, ${d.numero}${d.complemento ? ' - '+d.complemento : ''} - ${d.bairro} - ${d.cidade}/${d.estado} - CEP ${d.cep}`

  const textoModelo = `🔔 *NOVO CURRÍCULO - Conexão v7cyber*

*👤 DADOS PESSOAIS*
*Nome:* ${d.nome}
*Nascimento:* ${d.dataNascimento}
*Nacionalidade:* ${d.nacionalidade}
*Estado Civil:* ${d.estadoCivil}
*Idade:* ${d.idade} anos
*Endereço:* ${enderecoCompleto}
*Rua:* ${d.rua}
*Número:* ${d.numero}
*Complemento:* ${d.complemento || 'Não informado'}
*Bairro:* ${d.bairro}
*Cidade:* ${d.cidade}
*Estado:* ${d.estado}
*CEP:* ${d.cep}
*Telefone:* ${d.telefone}
*Email:* ${d.email}
*Habilidades:* ${d.habilidades || 'Não informado'}
*Resumo:* ${d.resumo || 'Não informado'}

*🎯 OBJETIVO*
${d.objetivo}

*💼 EXPERIÊNCIAS*
${exps}

*🎓 FORMAÇÃO*
${d.formacao}

*📚 CURSOS*
${cursos}

*💡 HABILIDADES*
${habilidadesTxt}

*📝 RESUMO PROFISSIONAL*
${resumoTxt}

-------------------------
📱 Candidato: ${jid}
🤖 Conexão v7cyber

*✉️ CARTA DE APRESENTAÇÃO*

Prezados,

Meu nome é ${d.nome}, nascido em ${d.dataNascimento}, ${d.nacionalidade}, ${d.idade} anos, email ${d.email}.
Moro em ${enderecoCompleto}.
Meu objetivo é atuar como ${d.objetivo}.
${d.experiencias[0] ? `Experiência como ${d.experiencias[0].cargo} na ${d.experiencias[0].empresa.toUpperCase()}.` : 'Em busca do primeiro emprego.'}
Formação: ${d.formacao}
Telefone: ${d.telefone} | Email: ${d.email}
${d.habilidades ? `Habilidades: ${d.habilidades}\n` : ''}${d.resumo ? `Resumo: ${d.resumo}\n` : ''}
Atenciosamente,
${d.nome}
`

  const nomeArquivo = `CURRICULO-${d.nome.replace(/ /g,'_')}.txt`
  const caminhoArquivo = path.join(__dirname, nomeArquivo)
  try{ fs.writeFileSync(caminhoArquivo, textoModelo) }catch(e){ log(`Erro criar arquivo: ${e.message}`) }

  try{
    const destinoFinal = '5511942047248@s.whatsapp.net'
    log(`📤 Enviando curriculo ${d.nome} para ${destinoFinal}`)

    await sock.sendMessage(destinoFinal, { text: textoModelo })
    await new Promise(r=>setTimeout(r,800))
    await sock.sendMessage(destinoFinal, { 
      document: fs.readFileSync(caminhoArquivo),
      mimetype: 'text/plain',
      fileName: `CURRICULO-${d.nome.toUpperCase()}.txt`
    })
    log(`✅ Enviado!`)
    try{ fs.unlinkSync(caminhoArquivo) }catch(e){}
  }catch(e){ log(`❌ Erro envio: ${e.message}`) }

  await sock.sendMessage(jid, { text: `✅ Obrigado, ${d.nome}! Seu currículo foi recebido com sucesso!

📧 Email: ${d.email}
📱 Tel: ${d.telefone}

🚀 Conexão v7cyber agradece seu cadastro!

📄 Em breve enviaremos seu currículo por PDF` })
  sessions.delete(jid)
}

startBot()
app.get('/', (req,res)=> res.send(`<h1>Conexão v7cyber V26 - Sair/Cancelar + PDF final</h1><p>${isConnected?'✅ CONECTADO':'❌ Desconectado'}</p><a href="/whatsapp">QR WhatsApp</a> | <a href="/logs">Logs</a><pre>${logs.slice(-20).join('\n')}</pre>`))
app.get('/whatsapp', async (req,res)=>{
  if(isConnected) return res.send(`<body style="text-align:center;font-family:Arial;padding:40px"><h1 style="color:green">✅ CONECTADO - Conexão v7cyber</h1><p>Bot rodando - (11) 94204-7248</p><p><b>Gatilho:</b> Criar Curriculum</p><p style="background:#25D366;color:white;padding:15px;border-radius:10px">✅ Validação: CEP 00000-000 | Tel (xx) xxxxx-xxxx | Email nome@email.com</p><br><a href="/logs">Logs</a> | <a href="/clear" style="color:red">Desconectar</a><pre style="text-align:left;background:#f0f0f0;padding:10px;margin-top:20px">${logs.slice(-20).join('\n')}</pre></body>`)
  if(!qrCodeData) return res.send(`<h1>Aguardando QR...</h1><pre>${logs.slice(-10).join('\n')}</pre><script>setTimeout(()=>location.reload(),3000)</script>`)
  const img=await QRCode.toDataURL(qrCodeData)
  res.send(`<body style="text-align:center;font-family:Arial"><h1>📱 Escaneie o QR - Conexão v7cyber</h1><p>(11) 94204-7248 - Gatilho: Criar Curriculum</p><img src="${img}" style="width:380px;border:10px solid #25D366;border-radius:20px"><br><p>Depois mande Criar Curriculum de outro celular</p><script>setTimeout(()=>location.reload(),15000)</script></body>`)
})
app.get('/qr', async (req,res)=>{
  if(isConnected) return res.send('<h1 style="color:green">✅ CONECTADO</h1>')
  if(!qrCodeData) return res.send(`<h1>Sem QR</h1><pre>${logs.slice(-10).join('\n')}</pre><script>setTimeout(()=>location.reload(),4000)</script>`)
  const img=await QRCode.toDataURL(qrCodeData)
  res.send(`<body style="text-align:center"><h1>Escaneie</h1><img src="${img}" style="width:350px"><script>setTimeout(()=>location.reload(),20000)</script></body>`)
})
app.get('/status', (req,res)=> res.json({connected:isConnected, hasQR:!!qrCodeData, uptime:process.uptime()}))
app.get('/logs', (req,res)=> res.send(`<pre>${logs.join('\n')}</pre>`))
app.get('/clear', (req,res)=>{ try{ fs.rmSync('./auth',{recursive:true,force:true}); fs.mkdirSync('./auth',{recursive:true}) }catch(e){}; qrCodeData=null; isConnected=false; res.send('Limpou - novo QR em 5s'); setTimeout(()=>startBot(),1000) })
app.listen(PORT, ()=> log(`Rodando porta ${PORT} - V25 - Habilidades + Resumo Opcional + Estado Civil + Validacoes`))




