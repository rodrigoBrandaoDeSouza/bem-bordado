# Bem Bordado

Site de portfólio e encomendas para o ateliê [@bembordado_](https://www.instagram.com/bembordado_/) — bordado e crochê feitos à mão — com painel administrativo protegido por usuário e senha.

## O que tem

**Site público** (`/`)
- Bastidor animado sendo "bordado" no topo, linha que segue o cursor, divisores em ponto corrido, rodapé com barrado de crochê
- Galeria de trabalhos com filtros (Bordado / Crochê / Bordado + Crochê) e lightbox (setas, teclado e swipe)
- Botão **"Quero uma parecida"** que leva a peça da galeria como referência para o formulário
- Formulário de encomenda: tipo de peça, contato, ideia, cores, tamanho, quantidade, data desejada e foto de referência
- Ao enviar, a cliente recebe um **código (ex.: BB-7KQ2MX)** e o botão para avisar no WhatsApp
- **Acompanhar pedido** pelo código (linha do tempo: Recebida → Orçamento → Em produção → Pronta → Entregue)
- Botão flutuante de WhatsApp (aparece quando o número for configurado no painel)

**Painel da artesã** (`/admin`)
- **Painel**: vendido, recebido, a receber, encomendas em andamento e atrasadas — por mês, 3 meses, ano ou tudo; próximos prazos; lista do que falta receber com botão "Marcar pago"; gráfico mensal vendido × recebido
- **Encomendas**: filtros por status e pagamento, busca, ordenação por prazo/valor; troca rápida de status; valor total, sinal (botão 50%), **marcar como pago**; prazo combinado; anotações internas; atalho para o WhatsApp da cliente; cadastro manual (pedidos vindos do Instagram/DM)
- **Prazos**: calendário mensal com as entregas, lista de atrasadas e de encomendas sem prazo
- **Trabalhos**: publicar/editar/excluir fotos da galeria, preço "a partir de" e destaque "queridinho"
- **Configurações**: nome, Instagram, WhatsApp, e-mail, texto "Sobre", aviso de prazo; troca de usuário e senha

## Como rodar

Requer **Node.js 22.13+** (usa o SQLite embutido do Node — sem banco externo).

```bash
npm install
npm start
```

- Site: http://localhost:3000
- Painel: http://localhost:3000/admin
- Login inicial: **admin / bembordado** → troque em *Configurações* no primeiro acesso.

### Variáveis de ambiente (opcionais)

| Variável | Padrão | Para quê |
|---|---|---|
| `PORT` | `3000` | Porta do servidor |
| `DATA_DIR` | `./data` | Onde ficam o banco (`bembordado.db`) e as fotos enviadas (`uploads/`) |
| `ADMIN_USER` / `ADMIN_PASS` | `admin` / `bembordado` | Usuário criado no **primeiro** start (se ainda não houver nenhum) |
| `SESSION_SECRET` | gerado e salvo no banco | Chave de assinatura do login |
| `NODE_ENV` | — | Use `production` em servidor com HTTPS (cookie `Secure`) |

## Publicar na VPS (Hostinger)

A VPS pode hospedar várias aplicações: cada uma tem a própria porta interna, o próprio usuário de sistema e o próprio site no Nginx.

1. No painel da Hostinger, crie a VPS com **Ubuntu 22.04 ou 24.04**.
2. No DNS do domínio, aponte `@` e `www` (registros **A**) para o IP da VPS. Para um subdomínio, basta o registro dele.
3. **Uma vez por VPS**, faça a preparação base (Nginx, Certbot, Node 22, firewall, Fail2ban, atualizações de segurança):
   ```bash
   curl -fsSL https://raw.githubusercontent.com/rodrigoBrandaoDeSouza/bem-bordado/main/deploy/preparar-vps.sh -o preparar.sh
   bash preparar.sh
   ```
4. Instale o Bem Bordado informando o domínio e uma porta interna livre (padrão `3101`):
   ```bash
   curl -fsSL https://raw.githubusercontent.com/rodrigoBrandaoDeSouza/bem-bordado/main/deploy/instalar-vps.sh -o instalar.sh
   EMAIL=voce@exemplo.com bash instalar.sh seudominio.com.br 3101
   ```
   No final, o script mostra o **login do painel com uma senha aleatória**. Anote essa senha. As portas usadas por cada app ficam anotadas em `/etc/apps-portas.txt`.
5. Para publicar alterações depois de um `git push`:
   ```bash
   bash /var/www/bem-bordado/deploy/atualizar.sh
   ```

| Onde | O quê |
|---|---|
| `/var/www/bem-bordado` | código |
| `/var/lib/bem-bordado` | banco e fotos enviadas (não é apagado nas atualizações) |
| `/etc/bem-bordado.env` | configurações (porta, senha inicial) |
| `/var/backups/bem-bordado` | backup diário às 03:30, guardado por 14 dias |
| `journalctl -u bem-bordado -f` | logs do site |

O login do painel exige **HTTPS** (o cookie da sessão é `Secure`). O script já emite o certificado. Se o DNS ainda não tiver propagado, rode depois `certbot --nginx -d seudominio.com.br -d www.seudominio.com.br --redirect`.

## Outras hospedagens

Qualquer hospedagem que rode Node com **disco persistente** serve (Railway, Render com disco, Fly.io com volume, uma VPS). Aponte `DATA_DIR` para o volume persistente, defina `NODE_ENV=production` e `ADMIN_PASS` com uma senha forte. Faça backup periódico da pasta `DATA_DIR`.

## Fotos de exemplo

A galeria começa com 6 ilustrações de exemplo (`public/img/amostras`, geradas por `node scripts/gerar-amostras.js`). Exclua-as no painel em *Trabalhos* e publique as fotos reais.

## Segurança

Senhas com scrypt, sessão em cookie `HttpOnly` + `SameSite=Strict` assinado com HMAC (trocar a senha derruba sessões antigas), limite de tentativas de login e de envios de encomenda, honeypot anti-spam, uploads restritos a imagens de até 6 MB com nomes aleatórios.
