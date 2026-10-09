# Conexão v7cyber — correção UptimeRobot

Esta versão mantém a proteção por usuário e senha nas páginas administrativas e libera apenas `/status` para o UptimeRobot.

## Variáveis de ambiente no Render
- `ADMIN_USER`: usuário do painel (ex.: `admin`)
- `ADMIN_PASSWORD`: senha forte com pelo menos 12 caracteres
- `ADMIN_JID`: número WhatsApp do administrador, se usado pelo projeto

## Configurar o UptimeRobot
Monitor HTTP(s): `https://robo-curriculo-wpp.onrender.com/status`
Intervalo: conforme sua preferência.

O endpoint público `/status` retorna apenas `connected`, `hasQR` e `uptime`. Não expõe o JID do administrador.

Após atualizar o branch conectado ao Render, aguarde o deploy e teste a URL `/status`. Ela deve retornar HTTP 200 com JSON. As páginas `/`, `/whatsapp`, `/qr`, `/logs` e `/admin` continuam protegidas por Basic Auth.
