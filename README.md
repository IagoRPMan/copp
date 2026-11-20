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
3. **Gerentes** recebem a própria carteira para aprovação: corrigem descrição e quantidade na lista, trocam condomínio ou item no detalhe, movem trabalhos cobrados da conta errada, cancelam com motivo e liberam.
4. Quando não resta nenhum pendente no mês, a **Contabilidade** passa a ver o relatório (uma página por condomínio) e a planilha CSV.

Arquivos parciais do mesmo mês podem ser enviados em qualquer ordem: trabalhos já importados são pulados e as páginas novas somam nos lançamentos que ainda estão pendentes. Uma importação pode ser desfeita enquanto nada dela tiver sido liberado.

## Quem pode o quê

| Quem | O que faz |
|---|---|
| **Administrador** | Poder total: cadastros, importação, todas as carteiras, relatórios, auditoria |
| **Usuário** (todos os outros) | Cria, edita e aprova lançamentos da própria carteira |
| Usuário da **Gerência** | A carteira são os condomínios em que ele é o gerente |
| Quem tem gente que **responde a ele** | Enxerga e aprova também a carteira dessas pessoas (supervisor → gerentes) |
| Usuário da **Contabilidade** | Além da carteira, importa o relatório do PaperCut e emite relatórios dos meses liberados |
| Usuário da **Diretoria** | Além da carteira, vê o painel, todas as carteiras e os relatórios |

O alcance de cada departamento é configurável em Cadastros → Departamentos. Um lançamento manual criado por alguém de outro departamento vai para o gerente do prédio aprovar; quem criou ainda pode corrigi-lo enquanto estiver pendente.

## Carga inicial de condomínios e carteiras

`dados-iniciais/condominios.csv` traz os condomínios, o gerente de cada um e o supervisor dos gerentes. Para carregar (ou recarregar, sem duplicar):

```bash
npm run carga
```

A mesma planilha pode ser enviada pela tela Cadastros → Condomínios. As pessoas entram sem senha; o administrador gera a senha temporária de cada uma em Cadastros → Usuários.

## Regras que vale conhecer

- **Carteira:** o lançamento vai para o gerente cadastrado no condomínio, não importa quem imprimiu. Sem gerente cadastrado, vai para quem imprimiu.
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

O backup grava uma cópia consistente em `data/backups` e mantém as 30 mais recentes. Copie essa pasta para fora da VPS. Para restaurar, pare o serviço e substitua `copp.db` pela cópia.

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
