# Mudanças

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e as versões seguem o [versionamento semântico](https://semver.org/lang/pt-BR/).

## [1.0.0] - 2026-11-20

Primeira versão pública.

### Adicionado
- Área **Novo lançamento**, primeira do menu, com os lançamentos manuais da própria pessoa e a situação de cada um.
- Lançamento de condução restrito aos departamentos marcados para isso (a Expedição), conferido também no servidor.
- Máscara de valores em reais: a vírgula dos centavos e os pontos de milhar aparecem enquanto a pessoa digita.
- Nome, sigla e logo da administradora configuráveis por variáveis de ambiente (`EMPRESA_NOME`, `EMPRESA_CURTA`, `EMPRESA_LOGO`).
- `npm run demo`: sistema completo com dados fictícios.
- Endpoint `/saude` para monitor externo.
- Script de publicação com backup, testes, troca e volta automática (`deploy/publicar.sh`, `deploy/voltar.sh`).
- Testes de permissões e regras de negócio pela rota HTTP; integração contínua no GitHub Actions.

### Mudado
- **Toda conferência e liberação passa a ser da Contabilidade.** Ninguém aprova o próprio lançamento; os demais perfis acompanham.
- Redesenho completo da interface, nas cores da logo do COPP (azul-marinho e verde), com a logo no menu, na entrada e no ícone da aba.
- Painel do mês agrupado por condomínio.
- Formulário de condução sem funcionário e horários; a condução fica em nome de quem lançou.
- Relatório de condução mostra só a descrição.

### Corrigido
- Datas inexistentes (31/02) eram aceitas.
- Preços de R$ 1.000,00 ou mais eram recusados ao salvar de novo.
- Desfazer importação ou mover trabalhos ignorava a quantidade corrigida à mão.
- A importação podia deixar períodos de fechamento gravados se falhasse no meio.
- As tentativas de login guardadas em memória nunca eram descartadas.
