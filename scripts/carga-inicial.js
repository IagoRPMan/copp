// Carrega condomínios, gerentes e supervisores a partir de dados-iniciais/condominios.csv.
// Uso: node scripts/carga-inicial.js [arquivo.csv]   (pode rodar com o sistema no ar; repetir não duplica)
const fs = require('fs');
const path = require('path');
const { carregarCondominios } = require('../src/carga');
const { get } = require('../src/db');

const arquivo = process.argv[2] || path.join(__dirname, '..', 'dados-iniciais', 'condominios.csv');
const r = carregarCondominios(fs.readFileSync(arquivo), null);
console.log(`${r.criados} condomínios criados, ${r.atualizados} atualizados, ${r.usuariosNovos} usuários novos.`);
if (r.problemas.length) { console.log('Linhas que não entraram:'); r.problemas.forEach((p) => console.log('  ' + p)); }
const t = get('SELECT (SELECT COUNT(*) FROM condominios) AS c, (SELECT COUNT(*) FROM condominios WHERE responsavel_id IS NOT NULL) AS g, (SELECT COUNT(*) FROM usuarios) AS u');
console.log(`No banco agora: ${t.c} condomínios (${t.g} com gerente) e ${t.u} usuários.`);
