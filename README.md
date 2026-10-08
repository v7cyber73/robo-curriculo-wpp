# Conexão v7cyber — WhatsApp + Render

Esta versão é baseada diretamente no código do simulador fornecido.

## O que foi mantido

- Menu inicial
- Horário
- Localização
- Tabela de preços
- Criar currículo
- Todas as validações e etapas do currículo
- Menu `menu`
- Cancelamento com `sair`/`cancelar`
- Caixa administrativa do currículo

## O que foi adicionado

- WhatsApp real usando Baileys
- QR Code em `/whatsapp`
- Status em `/status`
- Logs em `/logs`
- Envio do currículo para o administrador

## GitHub

Suba `server.js` e `package.json` para o repositório.

## Render

Crie um Web Service.

Build Command:
`npm install`

Start Command:
`npm start`

Depois de publicar, abra:

`https://SEU-SERVICO.onrender.com/whatsapp`

Escaneie o QR Code.

## Número administrador

Por padrão:
`5511942047248@s.whatsapp.net`

Para mudar no Render, crie a variável:

`ADMIN_JID`

com o JID do número que deve receber os currículos.

## Observação importante

O Render pode usar filesystem temporário dependendo do serviço/plano. A sessão do WhatsApp fica em `./auth`. Se a sessão for apagada após reinicialização, será necessário escanear um novo QR Code.
