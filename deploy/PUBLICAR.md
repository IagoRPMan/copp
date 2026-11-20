# Publicar uma versão nova na VPS

Leva uns 5 minutos. O sistema fica no ar o tempo todo, menos os ~3 segundos do reinício.
O `publicar.sh` faz backup antes, instala a versão nova ao lado da atual, roda os testes e só então troca.
Se o sistema não responder depois do reinício, ele volta sozinho para a versão anterior.

Os comandos abaixo são para o **Git Bash**, no Windows. Troque `SEU_IP` pelo endereço da VPS.

## 0. Antes (uma vez por publicação)

- Confira que alguém do departamento **CONTABILIDADE** tem senha (Cadastros → Usuários). Agora só a Contabilidade
  e o administrador liberam lançamentos. Se ninguém tiver, o script para no passo 4 e não troca nada.
- Avise a equipe: quem estiver com uma tela aberta só precisa recarregar a página depois.

## 1. No seu computador: testar e empacotar

```bash
cd "/c/Users/Iago R. Prado Man/Desktop/IRPM TECNOLOGIA/COPP/app"
git status                 # precisa estar limpo: só vai para a VPS o que está commitado
npm test                   # todos os testes passando
git archive --format=tar.gz -o ../copp-publicar.tar.gz HEAD
```

O pacote leva só os arquivos do repositório: sem `node_modules`, sem `data/` e sem a planilha de condomínios.

## 2. Enviar e publicar

```bash
scp -P 22022 -i ~/.ssh/copp_vps ../copp-publicar.tar.gz root@SEU_IP:/tmp/copp-publicar.tar.gz
ssh -p 22022 -i ~/.ssh/copp_vps root@SEU_IP \
  "tar -xzf /tmp/copp-publicar.tar.gz -O deploy/publicar.sh | bash -s /tmp/copp-publicar.tar.gz"
```

O segundo comando tira o `publicar.sh` de dentro do próprio pacote e o executa. A saída mostra os 7 passos;
o último deve dizer **"Publicado. O sistema respondeu em /saude."**

## 3. Conferir no navegador

1. Abra `https://copp.irpmtecnologia.com.br/saude`: deve aparecer `{"ok":true}`.
2. Entre como alguém da **Contabilidade**: em Conferência aparece o botão **Salvar e liberar marcados**.
3. Entre como um **gerente** (ou peça a um): ele vê os lançamentos dele, mas sem caixas de marcar nem botão de liberar.
4. Abra um relatório de um mês já liberado e confira se as folhas A4 saem como antes.

## Se algo der errado

Voltar para a versão anterior (o banco não é mexido: esta versão não muda a estrutura das tabelas):

```bash
ssh -p 22022 -i ~/.ssh/copp_vps root@SEU_IP "bash /opt/copp/deploy/voltar.sh"
```

Ver o que aconteceu:

```bash
ssh -p 22022 -i ~/.ssh/copp_vps root@SEU_IP "journalctl -u copp -n 50 --no-pager"
```

Restaurar o banco do backup feito no passo 1 do script (só se os dados tiverem sido danificados, o que esta versão não faz):

```bash
ssh -p 22022 -i ~/.ssh/copp_vps root@SEU_IP
systemctl stop copp
ls -t /var/lib/copp/backups | head -3          # o mais recente é o de antes da publicação
cp /var/lib/copp/backups/copp-AAAAMMDD-HHMMSS.db /var/lib/copp/copp.db
rm -f /var/lib/copp/copp.db-wal /var/lib/copp/copp.db-shm
chown copp:copp /var/lib/copp/copp.db
systemctl start copp
```
