const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys')
const originalError = console.error
console.error = (...args) => { const msg = args.join(' '); if(msg.includes('Bad MAC') || msg.includes('No matching sessions') || msg.includes('SessionError') || msg.includes('@lid')) return; originalError(...args) }
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
      if(!jid || jid.includes('@g.us') || jid.includes('@lid') || m.key.fromMe) continue
      const txt=(m.message.conversation || m.message.extendedTextMessage?.text || '').trim()
      if(!txt) continue
      const lower=txt.toLowerCase()
      
      const gatilho = lower.includes('criar curriculum') || lower.includes('criar curriculo') || lower.includes('criar currículo') || lower === 'curriculum' || lower === 'curriculo' || lower.includes('curriculo');
      if(gatilho){
        sessions.set(jid, { step: 'nome', data: { experiencias: [], cursos: [] }, expTemp: {}, cursoTemp: {} })
        await sock.sendMessage(jid, {text:`👋 Olá! Sou o Robô da Conexão v7cyber 🤖

Vamos montar seu currículo!

1️⃣ Qual seu nome e sobrenome?`})
        continue
      }
      const s = getSession(jid)
      if(s.step==='idle') continue
      const d=s.data

      try{
        if(s.step==='nome'){ if(txt.split(' ').length<2){ await sock.sendMessage(jid,{text:`⚠️ Digite nome e sobrenome completo`}); continue } d.nome=txt; s.step='nascimento'; await sock.sendMessage(jid,{text:`2️⃣ Data de nascimento? Ex: 15/03/1998`}) }
        else if(s.step==='nascimento'){ if(!txt.includes('/')){ await sock.sendMessage(jid,{text:`⚠️ Use formato DD/MM/AAAA Ex: 15/03/1998`}); continue } d.dataNascimento=txt; s.step='nacionalidade'; await sock.sendMessage(jid,{text:`3️⃣ Nacionalidade? Ex: Brasileiro`}) }
        else if(s.step==='nacionalidade'){ d.nacionalidade=txt; s.step='rua'; await sock.sendMessage(jid,{text:`4️⃣ Nome da RUA / Avenida?
Ex: Rua das Flores`}) }
        else if(s.step==='rua'){ d.rua=txt; s.step='numero'; await sock.sendMessage(jid,{text:`5️⃣ NÚMERO da casa?
Ex: 123`}) }
        else if(s.step==='numero'){ d.numero=txt; s.step='complemento'; await sock.sendMessage(jid,{text:`6️⃣ COMPLEMENTO?
Ex: Apto 101, Bloco B
Se não tiver, digite: *não*`}) }
        else if(s.step==='complemento'){ if(lower==='não' || lower==='nao' || lower==='sem' || lower==='n' || lower==='nenhum'){ d.complemento=''; } else { d.complemento=txt; } s.step='bairro'; await sock.sendMessage(jid,{text:`7️⃣ BAIRRO?
Ex: Centro`}) }
        else if(s.step==='bairro'){ d.bairro=txt; s.step='cidade'; await sock.sendMessage(jid,{text:`8️⃣ CIDADE?
Ex: São Paulo`}) }
        else if(s.step==='cidade'){ d.cidade=txt; s.step='estado'; await sock.sendMessage(jid,{text:`9️⃣ ESTADO (2 letras)?
Ex: SP, RJ, MG`}) }
        else if(s.step==='estado'){ if(txt.length!==2){ await sock.sendMessage(jid,{text:`⚠️ Digite só a sigla com 2 letras. Ex: SP`}); continue } d.estado=txt.toUpperCase(); s.step='cep'; await sock.sendMessage(jid,{text:`🔟 CEP?
Ex: 08500-000`}) }
        else if(s.step==='cep'){ d.cep=txt; s.step='telefone'; await sock.sendMessage(jid,{text:`1️⃣1️⃣ Telefone/WhatsApp?
Ex: (11) 99999-9999`}) }
        else if(s.step==='telefone'){ d.telefone=txt; s.step='idade'; await sock.sendMessage(jid,{text:`1️⃣2️⃣ Idade?`}) }
        else if(s.step==='idade'){ d.idade=txt; s.step='objetivo'; await sock.sendMessage(jid,{text:`1️⃣3️⃣ Objetivo profissional?
Ex: Auxiliar administrativo, Vendedor`}) }
        else if(s.step==='objetivo'){ d.objetivo=txt; s.step='exp_empresa'; await sock.sendMessage(jid,{text:`1️⃣4️⃣ Nome da última empresa? Se primeiro emprego digite *primeiro emprego*`}) }
        else if(s.step==='exp_empresa'){ if(lower.includes('primeiro')){ d.experiencias=[]; s.step='formacao'; await sock.sendMessage(jid,{text:`Primeiro emprego 💪

Qual sua formação? Ex: Ensino médio completo`}); continue } s.expTemp.empresa=txt; s.step='exp_cargo'; await sock.sendMessage(jid,{text:`Cargo na ${txt}?`}) }
        else if(s.step==='exp_cargo'){ s.expTemp.cargo=txt; s.step='exp_inicio'; await sock.sendMessage(jid,{text:`Data INÍCIO? Ex: 03/2022`}) }
        else if(s.step==='exp_inicio'){ s.expTemp.inicio=txt; s.step='exp_fim'; await sock.sendMessage(jid,{text:`Data SAÍDA? Ou digite *atual*`}) }
        else if(s.step==='exp_fim'){ s.expTemp.fim=txt; d.experiencias.push({...s.expTemp}); s.expTemp={}; s.step='exp_mais'; await sock.sendMessage(jid,{text:`✅ ${d.experiencias[d.experiencias.length-1].empresa} adicionado! Tem mais empresas? sim ou não`}) }
        else if(s.step==='exp_mais'){ if(lower.startsWith('s')){ s.step='exp_empresa'; await sock.sendMessage(jid,{text:`Próxima empresa?`}) } else { s.step='formacao'; await sock.sendMessage(jid,{text:`Qual sua formação?`}) } }
        else if(s.step==='formacao'){ d.formacao=txt; s.step='curso_pergunta'; await sock.sendMessage(jid,{text:`Tem cursos? sim ou não`}) }
        else if(s.step==='curso_pergunta'){ if(lower.startsWith('s')){ s.step='curso_nome'; await sock.sendMessage(jid,{text:`Nome do curso?`}) } else { await finalizarCurriculo(jid,d,s,sock) } }
        else if(s.step==='curso_nome'){ s.cursoTemp.nome=txt; s.step='curso_inst'; await sock.sendMessage(jid,{text:`Onde fez ${txt}?`}) }
        else if(s.step==='curso_inst'){ s.cursoTemp.instituicao=txt; s.step='curso_ano'; await sock.sendMessage(jid,{text:`Ano? Ex: 2023`}) }
        else if(s.step==='curso_ano'){ s.cursoTemp.ano=txt; d.cursos.push({...s.cursoTemp}); s.cursoTemp={}; s.step='curso_mais'; await sock.sendMessage(jid,{text:`✅ Curso adicionado! Mais cursos? sim ou não`}) }
        else if(s.step==='curso_mais'){ if(lower.startsWith('s')){ s.step='curso_nome'; await sock.sendMessage(jid,{text:`Próximo curso?`}) } else { await finalizarCurriculo(jid,d,s,sock) } }
      }catch(e){ log(`Erro: ${e.message}`) }
    }
  })
}

async function finalizarCurriculo(jid,d,s,sock){
  const exps = d.experiencias.map((e,i)=> `${i+1}. ${e.empresa.toUpperCase()}
Cargo: ${e.cargo}
Período: ${e.inicio} até ${e.fim}`).join('\n\n') || 'Primeiro emprego'
  const cursos = d.cursos.map((c,i)=> `${i+1}. ${c.nome} - ${c.instituicao} (${c.ano})`).join('\n') || 'Nenhum'
  const enderecoCompleto = `${d.rua}, ${d.numero}${d.complemento ? ' - '+d.complemento : ''} - ${d.bairro} - ${d.cidade}/${d.estado} - CEP ${d.cep}`

  const textoModelo = `🔔 *NOVO CURRÍCULO - Conexão v7cyber*

*👤 DADOS PESSOAIS*
*Nome:* ${d.nome}
*Nascimento:* ${d.dataNascimento}
*Nacionalidade:* ${d.nacionalidade}
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

*🎯 OBJETIVO*
${d.objetivo}

*💼 EXPERIÊNCIAS*
${exps}

*🎓 FORMAÇÃO*
${d.formacao}

*📚 CURSOS*
${cursos}

-------------------------
📱 Candidato: ${jid}
🤖 Conexão v7cyber

*✉️ CARTA DE APRESENTAÇÃO*

Prezados,

Meu nome é ${d.nome}, nascido em ${d.dataNascimento}, ${d.nacionalidade}, ${d.idade} anos.
Moro em ${enderecoCompleto}.
Meu objetivo é atuar como ${d.objetivo}.
${d.experiencias[0] ? `Experiência como ${d.experiencias[0].cargo} na ${d.experiencias[0].empresa.toUpperCase()}.` : 'Em busca do primeiro emprego.'}
Formação: ${d.formacao}
Telefone: ${d.telefone}

Atenciosamente,
${d.nome}
`

  const nomeArquivo = `CURRICULO-${d.nome.replace(/ /g,'_')}.txt`
  const caminhoArquivo = path.join(__dirname, nomeArquivo)
  try{ fs.writeFileSync(caminhoArquivo, textoModelo) }catch(e){ log(`Erro criar arquivo: ${e.message}`) }

  try{
    const meuNumeroLimpo = (sock.user.id.split(':')[0] || '5511942047248').replace(/[^0-9]/g,'')
    const destinoFinal = '5511942047248@s.whatsapp.net'
    log(`📤 Enviando curriculo ${d.nome} para ${destinoFinal} - TEXTO + TXT`)

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

  await sock.sendMessage(jid, { text: `✅ Obrigado, ${d.nome}! Seu currículo foi recebido!

🚀 Conexão v7cyber agradece!` })
  sessions.delete(jid)
}

startBot()
app.get('/', (req,res)=> res.send(`<h1>Conexão v7cyber V20 - 24h</h1><p>${isConnected?'✅ CONECTADO':'❌ Desconectado'}</p><a href="/whatsapp">QR WhatsApp</a> | <a href="/logs">Logs</a><pre>${logs.slice(-20).join('\n')}</pre>`))
app.get('/whatsapp', async (req,res)=>{
  if(isConnected) return res.send(`<body style="text-align:center;font-family:Arial;padding:40px"><h1 style="color:green">✅ CONECTADO - Conexão v7cyber</h1><p>Bot rodando - (11) 94204-7248</p><p><b>Gatilho:</b> Criar Curriculum</p><p style="background:#25D366;color:white;padding:15px;border-radius:10px">✅ Tudo certo! Mande <b>Criar Curriculum</b> de OUTRO número<br>Vai chegar no seu (11) 94204-7248 com texto + .txt</p><br><a href="/logs">Logs</a> | <a href="/clear" style="color:red">Desconectar</a><pre style="text-align:left;background:#f0f0f0;padding:10px;margin-top:20px">${logs.slice(-20).join('\n')}</pre></body>`)
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
app.listen(PORT, ()=> log(`Rodando porta ${PORT} - Gatilho: Criar Curriculum - Dono: 5511942047248`))
