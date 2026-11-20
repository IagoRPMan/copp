# Como contribuir

Obrigado pelo interesse. O COPP é pequeno de propósito; contribuições que mantêm essa simplicidade são as mais fáceis de aceitar.

## Preparar o ambiente

```bash
git clone https://github.com/IagoRPMan/copp.git
cd copp
npm install
npm run demo     # sistema com dados fictícios em http://localhost:3210
npm test         # todos os testes precisam passar
```

Node.js 22.13 ou mais novo. Não há banco para instalar nem etapa de build.

## Antes de abrir um pull request

- **Rode `npm test`.** Mudou uma regra de negócio ou de permissão? Acrescente um teste em `test/regras.test.js`, de preferência pela rota HTTP, como os que já existem.
- **Nada de dados reais.** Nomes de condomínios, pessoas, logins e arquivos do PaperCut de verdade não entram no repositório, nem em testes, nem em capturas de tela. Use os dados fictícios de `scripts/demo.js`.
- **Dinheiro em centavos inteiros**, sempre. Para ler o que a pessoa digitou, use `centavosDeReais` em `src/texto.js`.
- **Toda alteração de dado relevante passa por `auditar()`**, com o antes e o depois.
- **Sem script ou estilo inline.** A CSP proíbe; use `public/app.js` e `public/style.css`.
- **O sistema precisa funcionar sem JavaScript** no navegador. O script só melhora a experiência.
- **Textos da interface em português**, no tom das telas que já existem: verbos claros, frase curta, dizendo o que acontece.
- **Mudança de esquema** vai em `src/db.js`, de forma aditiva (`garantirColuna`), para que uma instalação existente suba sem passos manuais.

## Commits

Mensagens em português, no imperativo, com o porquê no corpo quando não for óbvio. Um assunto por commit.

## Reportar problemas

Use os modelos de issue. Para falhas de segurança, siga o [SECURITY.md](SECURITY.md) e não abra issue pública.
