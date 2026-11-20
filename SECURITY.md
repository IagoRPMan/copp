# Segurança

## Como reportar uma vulnerabilidade

**Não abra issue pública.** Use o reporte privado do GitHub: aba **Security** do repositório → **Report a vulnerability**. Descreva o problema, como reproduzir e o impacto que você enxerga.

Você recebe uma resposta em até 5 dias úteis. Correções de segurança têm prioridade sobre qualquer outra mudança e são publicadas com crédito a quem reportou, se a pessoa quiser.

## Versões cobertas

Só a versão mais recente da branch `main` recebe correções.

## O que o sistema já faz

- Senhas e códigos de recuperação com `scrypt` e sal individual; nada disso fica em texto puro.
- Sessão no servidor; cookie `HttpOnly`, `SameSite=Lax` e `Secure` em produção.
- Token CSRF em todo POST autenticado.
- Content Security Policy sem `unsafe-inline`, `X-Frame-Options: DENY`, `nosniff`.
- Limite de tentativas de login e de recuperação de senha.
- Consultas SQL sempre parametrizadas.
- Planilhas CSV exportadas com proteção contra injeção de fórmula.
- Permissões conferidas no servidor em toda rota, com testes para cada ação proibida.

## Dados

O repositório não contém dados reais. O banco (`data/`), os backups e a planilha de carga inicial (`dados-iniciais/*.csv`) ficam fora do controle de versão.
