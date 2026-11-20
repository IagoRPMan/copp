# COPP — cópias e impressões por condomínio

Recebe o relatório de trabalhos de impressão do PaperCut, gera os lançamentos por condomínio, deixa-os pendentes para conferência e entrega o mês à Contabilidade quando todos os responsáveis liberam.

## Rodar

Precisa de Node.js 22.13 ou mais novo. Não há banco para instalar: os dados ficam num arquivo SQLite em `data/`.

```bash
npm install
npm start
```

Abra `http://localhost:3210`. No primeiro início o sistema cria o usuário `admin` e grava a senha inicial em `data/admin-inicial.txt`. Troque a senha no primeiro acesso e apague o arquivo.

```bash
npm test
```

## Como o mês anda

1. **Contabilidade** (ou o administrador) exporta do PaperCut o registro de trabalhos de impressão de todos os usuários e envia em "Importar do PaperCut". A prévia mostra o que será lançado; nada é gravado antes da confirmação.
2. O sistema cria um lançamento por condomínio × item × descrição × responsável, dentro do mês da impressão. O valor é quantidade × tabela de preços do sistema (o custo calculado pelo PaperCut é ignorado).
3. A **Contabilidade** confere tudo: corrige descrição e quantidade na lista, troca condomínio ou item no detalhe, move trabalhos cobrados da conta errada, cancela com motivo e libera. Ninguém aprova o próprio lançamento.
4. Quando não resta nenhum pendente no mês, o relatório (uma página por condomínio) e a planilha CSV ficam disponíveis.

Arquivos parciais do mesmo mês podem ser enviados em qualquer ordem: trabalhos já importados são pulados e as páginas novas somam nos lançamentos que ainda estão pendentes. Uma importação pode ser desfeita enquanto nada dela tiver sido liberado.

## Quem pode o quê

| Quem | O que faz |
|---|---|
| **Administrador** | Poder total: cadastros, importação, conferência, relatórios, auditoria |
| Usuário da **Contabilidade** | Importa o PaperCut, confere, corrige, cancela, libera e reabre lançamentos; emite relatórios |
| Usuário da **Diretoria** | Acompanha o painel, todos os lançamentos e os relatórios, sem liberar |
| Usuário da **Gerência** | Acompanha os lançamentos dos condomínios em que é o gerente |
| Quem tem gente que **responde a ele** | Acompanha também os lançamentos dessas pessoas |
| **Usuário** (todos os outros) | Lança conduções e cópias manuais e acompanha o que imprimiu ou lançou |

Só a Contabilidade (e o administrador) libera. Quem criou um lançamento manual ainda pode corrigi-lo ou cancelá-lo enquanto ele estiver pendente, mas não aprová-lo. O alcance de cada departamento é configurável em Cadastros → Departamentos.

## Carga inicial de condomínios e carteiras

`dados-iniciais/condominios.csv` traz os condomínios, o gerente de cada um e o supervisor dos gerentes. Para carregar (ou recarregar, sem duplicar):

```bash
npm run carga
```

A mesma planilha pode ser enviada pela tela Cadastros → Condomínios. As pessoas entram sem senha; o administrador gera a senha temporária de cada uma em Cadastros → Usuários.

## Regras que vale conhecer

- **Quem imprimiu:** cada lançamento importado fica registrado em nome de quem imprimiu (o manual, de quem lançou). Serve para acompanhar e para o relatório por funcionário; a conferência é sempre da Contabilidade.
- **Conta do PaperCut:** uma conta ainda desconhecida é ligada ao condomínio pelo código do nome ("076 - …" → 0076). Sem condomínio com esse código, ele é criado.
- **Dupla face:** o item nasce desativado e as páginas contam como cópia simples. Ative e defina o preço em "Itens e preços".
- **Preço:** fica gravado no lançamento. Mudar a tabela só afeta importações futuras, a menos que se marque "Recalcular pendentes".
- **Alerta:** quando o comentário digitado no PaperCut cita um código de condomínio diferente da conta cobrada, o lançamento vem marcado.
- **Contas internas:** desmarque "Gerar lançamentos" no condomínio para contas da própria administradora.
- **Auditoria:** edição, liberação, reabertura, cancelamento, importação e mudança de cadastro ficam registradas com autor e horário.

## Variáveis de ambiente

| Variável | Padrão | Para que serve |
|---|---|---|
| `PORT` | `3210` | Porta HTTP |
| `HOST` | `127.0.0.1` | Endereço de escuta. Mantenha local e publique por proxy reverso |
| `DATA_DIR` | `./data` | Pasta do banco, dos uploads temporários e dos backups |
| `COOKIE_SEGURO` | — | Defina `1` em produção com HTTPS, para o cookie de sessão só trafegar cifrado |
| `ADMIN_SENHA` | — | Senha inicial do `admin`, em vez de gerar uma no arquivo |
| `TZ` | do servidor | Use `America/Sao_Paulo` para os horários do histórico |

## Publicar numa VPS Linux

Exemplos prontos em `deploy/`. Em resumo:

1. Instale o Node.js 22 ou 24 e copie a pasta `app` para `/opt/copp` (sem `node_modules` e sem `data`).
2. Crie um usuário de sistema sem login para o serviço e rode `npm ci --omit=dev` em `/opt/copp`.
3. Instale `deploy/copp.service` em `/etc/systemd/system/`, ajuste caminhos e ative com `systemctl enable --now copp`.
4. Publique por Nginx com HTTPS usando `deploy/nginx.conf` como base. O serviço escuta só em `127.0.0.1`.
5. Agende o backup diário: `0 2 * * * cd /opt/copp && DATA_DIR=/var/lib/copp /usr/bin/node scripts/backup.js`.

O backup grava uma cópia consistente em `data/backups` e mantém as 30 mais recentes. Para restaurar, pare o serviço e substitua `copp.db` pela cópia.

**Cópia fora da VPS.** Um backup que fica só na VPS some junto com ela. Duas formas simples:

- *Puxar para um computador do escritório* (Windows, Agendador de Tarefas, todo dia às 3h):
  `scp -P 22022 -i %USERPROFILE%\.ssh\copp_vps root@SEU_IP:/var/lib/copp/backups/*.db D:\Backups\COPP\`
- *Enviar para a nuvem* com o [rclone](https://rclone.org) (Google Drive, OneDrive, S3): configure o destino uma vez com `rclone config` e acrescente ao cron, depois do backup:
  `30 2 * * * root rclone copy /var/lib/copp/backups copp-nuvem:COPP/backups --max-age 48h`

Teste a restauração de uma cópia de vez em quando: backup que nunca foi restaurado não é garantia.

**Monitoramento.** `GET /saude` responde `{"ok":true}` (200) quando o sistema e o banco estão no ar, sem exigir login. Cadastre `https://SEU_DOMINIO/saude` num monitor gratuito como o UptimeRobot para receber um e-mail se o COPP cair.

## Estrutura

```
server.js            entrada, login, sessão e montagem das rotas
src/db.js            esquema e acesso ao SQLite
src/auth.js          senhas, sessões, perfis e CSRF
src/papercut.js      leitura do CSV, geração de lançamentos, desfazer importação
src/dominio.js       competências, auditoria e formatação
src/routes/          importações, conferência, relatórios, cadastros
views/               telas (EJS)
public/              estilo e script
scripts/backup.js    cópia de segurança
test/                testes da importação
```
