Conexão v7cyber — WhatsApp + Render (versão com painel protegido)

Arquivos: server.js e package.json.

No Render, configure Build Command: npm install e Start Command: npm start.

SEGURANÇA OBRIGATÓRIA
1. No Render, abra o serviço → Environment.
2. Adicione ADMIN_USER (por exemplo: admin).
3. Adicione ADMIN_PASSWORD com uma senha forte de pelo menos 12 caracteres. Prefira uma senha longa e exclusiva.
4. Salve e faça o redeploy. Não compartilhe a senha nem a coloque no código/ZIP.

O painel, QR Code, status, logs e currículos em /admin exigem autenticação HTTP Basic. O navegador pedirá usuário e senha ao abrir as páginas protegidas. Se ADMIN_PASSWORD não estiver configurada ou tiver menos de 12 caracteres, o painel fica bloqueado.

Para conectar o WhatsApp, abra https://SEU-SERVICO.onrender.com/whatsapp depois de configurar a senha.

Os números 1, 2, 3 e 4 só acionam opções imediatamente depois que o menu é exibido e enquanto ele aguarda uma escolha. A opção 5 mostra os dados Pix. Durante uma conversa normal, números isolados não abrem opções por acidente. Digite menu para abrir as opções novamente. Durante o preenchimento do currículo, as respostas numéricas são tratadas como respostas do formulário.

O número administrador padrão é 5511942047248@s.whatsapp.net. Pode alterar pela variável de ambiente ADMIN_JID.

Nota: autenticação protege as páginas web, mas não impede quem já tem acesso à sua conta Render, ao repositório privado ou ao dispositivo autenticado do WhatsApp de alterar/acessar o projeto. Ative autenticação em dois fatores na conta Render e limite os colaboradores.
