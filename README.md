# Conexão v7cyber — WhatsApp + Render

Esta versão usa o `server.js` real enviado pelo proprietário do projeto.

## Arquivos

- `server.js` — bot WhatsApp com Baileys
- `package.json` — dependências e comando de inicialização

## Render

Tipo: Web Service

Build Command:
`npm install`

Start Command:
`npm start`

A porta é definida automaticamente pela variável `PORT` do Render.

## Após publicar

Abra:
`https://SEU-SERVICO.onrender.com/whatsapp`

Escaneie o QR Code com o WhatsApp do número do bot.

Outras páginas:
- `/` — status
- `/whatsapp` — QR/conexão
- `/qr` — QR
- `/logs` — logs
- `/status` — status em JSON
- `/clear` — limpa a autenticação e gera novo QR

IMPORTANTE:
A pasta `auth` é criada pelo próprio servidor. Em hospedagens com filesystem temporário, uma reinicialização/redeploy pode exigir novo pareamento. Para manter a sessão entre reinicializações, configure armazenamento persistente no serviço de hospedagem.
