CONEXÃO V7CYBER — CORREÇÃO UPTIMEROBOT

Alteração:
- A rota /status é pública e responde HTTP 200 para o UptimeRobot.
- A resposta /status não expõe o JID do administrador.
- O painel principal (/), /whatsapp, /qr, /logs e /admin continuam protegidos por ADMIN_PASSWORD.

No Render:
1. Configure ADMIN_USER e ADMIN_PASSWORD (senha forte, pelo menos 12 caracteres).
2. Publique este server.js no branch conectado ao serviço.
3. Aguarde o deploy.
4. Teste https://robo-curriculo-wpp.onrender.com/status
5. No UptimeRobot, mantenha o monitor HTTP apontando para essa URL.

Se você remover ADMIN_PASSWORD, as rotas protegidas ficam bloqueadas com HTTP 503; não é necessário removê-la para o UptimeRobot funcionar, porque /status é pública nesta versão.
