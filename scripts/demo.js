// Demonstração com dados fictícios: monta um banco novo em ./demo-data e sobe o sistema.
// Uso: npm run demo   (depois abra http://localhost:3210)
//
// Nenhum dado real: condomínios, pessoas e documentos são inventados. O relatório do PaperCut
// é gerado aqui mesmo e passa pela mesma importação usada em produção.
const fs = require('fs');
const path = require('path');

const PASTA = path.join(__dirname, '..', 'demo-data');
const SENHA = 'demo1234';
fs.rmSync(PASTA, { recursive: true, force: true });
process.env.DATA_DIR = PASTA;
process.env.ADMIN_SENHA = SENHA;
process.env.EMPRESA_NOME = process.env.EMPRESA_NOME || 'Administradora Exemplo - Administração de Imóveis';

const app = require('../server');
const { get, run, tx } = require('../src/db');
const auth = require('../src/auth');
const papercut = require('../src/papercut');
const { competenciaDe, auditar } = require('../src/dominio');

// Sorteio previsível: a demonstração sai igual toda vez.
let semente = 20261120;
const sorte = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648; };
const um = (lista) => lista[Math.floor(sorte() * lista.length)];

const depto = (nome) => get('SELECT id FROM departamentos WHERE nome = ?', nome).id;
function pessoa(login, nome, departamento, superior) {
  const id = Number(run(`INSERT INTO usuarios (login, nome, email, papel, senha_hash, trocar_senha, recuperacao_hash, departamento_id, superior_id)
                         VALUES (?, ?, ?, 'responsavel', ?, 0, 'demo', ?, ?)`,
  login, nome, login + '@exemplo.com.br', auth.hashSenha(SENHA), depto(departamento), superior || null).lastInsertRowid);
  return id;
}

const CONDOMINIOS = [
  ['0012', 'COND. ED. JARDIM DAS ACÁCIAS'], ['0027', 'RES. PARQUE DOS IPÊS'], ['0033', 'COND. ED. MIRANTE DO SOL'],
  ['0041', 'CJ. RES. VILA DAS PALMEIRAS'], ['0058', 'COND. ED. SOLAR DAS ORQUÍDEAS'], ['0064', 'RES. BOSQUE DAS ARAUCÁRIAS'],
  ['0076', 'COND. ED. PORTO BELO'], ['0089', 'COND. ED. ALAMEDA DOS JASMINS'], ['0093', 'RES. RECANTO DAS ÁGUAS'],
  ['0105', 'COND. ED. TORRE DO PARQUE'], ['0118', 'CJ. RES. MORADA DO VALE'], ['0124', 'COND. ED. ATLÂNTICO SUL'],
];
const DOCUMENTOS = ['Convocação AGO', 'Edital de assembleia', 'Balancete mensal', 'Circular aos condôminos', 'Ata da assembleia', 'Lista de presença',
  'Boleto de cota extra', 'Relatório de inadimplência', 'Regulamento interno', 'Notificação de multa', 'Contrato de manutenção', 'Orçamento de obra'];
const COMENTARIOS = ['MATERIAL DE ASSEMBLEIA', 'BALANCETE', 'CIRCULAR AOS CONDÔMINOS', 'NOTIFICAÇÃO', 'PRESTAÇÃO DE CONTAS', ''];

tx(() => {
  run("UPDATE usuarios SET nome = 'ADMINISTRADOR DO SISTEMA', email = 'admin@exemplo.com.br', recuperacao_hash = 'demo', trocar_senha = 0 WHERE login = 'admin'");
  pessoa('ana.contabil', 'ANA PAULA MOREIRA', 'CONTABILIDADE');
  pessoa('diretor', 'RICARDO ALVES NOGUEIRA', 'DIRETORIA');
  const sup = pessoa('marta.sup', 'MARTA REGINA COSTA', 'GERÊNCIA');
  const gerentes = [pessoa('bruno.gerente', 'BRUNO HENRIQUE LIMA', 'GERÊNCIA', sup), pessoa('carla.gerente', 'CARLA SOUZA PRADO', 'GERÊNCIA', sup),
    pessoa('diego.gerente', 'DIEGO MARTINS ROCHA', 'GERÊNCIA', sup)];
  pessoa('edson.exp', 'EDSON PEREIRA DIAS', 'EXPEDIÇÃO');
  CONDOMINIOS.forEach(([codigo, nome], i) => run('INSERT INTO condominios (codigo, nome, conta_papercut, responsavel_id) VALUES (?,?,?,?)',
    codigo, nome, `${codigo.slice(1)} - ${nome.replace(/^(COND\. ED\.|RES\.|CJ\. RES\.) /, '')}`, gerentes[i % gerentes.length]));
  run("INSERT INTO condominios (codigo, nome, conta_papercut, gera_lancamento) VALUES ('0001', 'ADMINISTRADORA (USO INTERNO)', '001 - Administradora', 0)");
});

// Relatório de trabalhos de impressão do mês, no formato exportado pelo PaperCut.
const contas = CONDOMINIOS.map(([codigo, nome]) => `${codigo.slice(1)} - ${nome.replace(/^(COND\. ED\.|RES\.|CJ\. RES\.) /, '')}`);
const usuarios = [['bruno.gerente', 'Bruno Henrique Lima'], ['carla.gerente', 'Carla Souza Prado'], ['diego.gerente', 'Diego Martins Rocha'], ['marta.sup', 'Marta Regina Costa']];
const linhas = ['# Relatório de uso de impressão', 'Data;Usuário;Nome completo;Conta cobrada;Nome da conta compartilhada;Nome da Impressora;Documento;Tipo de Uso;Total Páginas impressas;Total de páginas coloridas;Cópias;Custo;Duplo;Comentário;Impresso;Cancelado;Reembolsado'];
for (let i = 0; i < 140; i++) {
  const dia = 1 + Math.floor(sorte() * 19);
  const data = new Date(Date.UTC(2026, 10, dia, 8 + Math.floor(sorte() * 10), Math.floor(sorte() * 60), Math.floor(sorte() * 60)));
  const conta = i % 23 === 0 ? '001 - Administradora' : um(contas);
  const [login, nome] = um(usuarios);
  const paginas = 1 + Math.floor(sorte() * (sorte() < 0.15 ? 120 : 12));
  const cor = sorte() < 0.2 ? Math.ceil(paginas * sorte()) : 0;
  // De vez em quando o comentário cita outro condomínio: vira alerta na conferência.
  const codigo = i % 17 === 0 ? um(contas).slice(0, 3) : conta.slice(0, 3);
  const comentario = um(COMENTARIOS);
  linhas.push([data.toISOString().slice(0, 19).replace('T', ' '), login, nome, 'SHARED', conta, 'copiadora-andar1', `${um(DOCUMENTOS)} ${conta.slice(0, 3)}.pdf`, 'PRINT',
    paginas, cor, 1, '"0,38"', sorte() < 0.3 ? 'Y' : 'N', comentario ? `${codigo} - ${comentario}` : codigo, 'Y', 'N', 'NOT_REFUNDED'].join(';'));
}
const analise = papercut.analisar(Buffer.from(linhas.join('\n'), 'utf8'));
papercut.processar(analise.trabalhos, { gravar: true, linhas: analise.linhas, arquivo: 'papercut-novembro.csv', hash: 'demo', usuarioId: get("SELECT id FROM usuarios WHERE login = 'ana.contabil'").id });

tx(() => {
  // Lançamentos manuais: cópias feitas fora do PaperCut e conduções da Expedição.
  const exp = get("SELECT id FROM usuarios WHERE login = 'edson.exp'").id;
  const ger = get("SELECT id FROM usuarios WHERE login = 'carla.gerente'").id;
  const simples = get("SELECT id, preco_centavos FROM itens WHERE tipo = 'simples'");
  const onibus = get("SELECT id, preco_centavos FROM itens WHERE codigo = '11'");
  const cond = (codigo) => get('SELECT id FROM condominios WHERE codigo = ?', codigo).id;
  const manual = (quem, codigoCond, item, data, descricao, qtd) => {
    const id = Number(run(`INSERT INTO lancamentos (competencia, condominio_id, item_id, data, descricao, quantidade, preco_centavos, valor_centavos, responsavel_id, origem, criado_por, funcionario_id)
                           VALUES (?,?,?,?,?,?,?,?,?,'manual',?,?)`, competenciaDe(data), cond(codigoCond), item.id, data, descricao, qtd, item.preco_centavos, qtd * item.preco_centavos, quem, quem, quem).lastInsertRowid);
    auditar(quem, 'criou manualmente', id, null);
  };
  manual(exp, '0033', onibus, '2026-11-04', 'AO CONDOMÍNIO ENTREGAR / RETIRAR MALOTE', 1);
  manual(exp, '0089', onibus, '2026-11-07', 'AO CONDOMÍNIO ENTREGAR DOCUMENTOS DA ASSEMBLEIA', 1);
  manual(exp, '0124', onibus, '2026-11-11', 'AO CONDOMÍNIO RETIRAR NOTAS FISCAIS', 1);
  manual(ger, '0058', simples, '2026-11-06', 'CÓPIAS NA GRÁFICA: CONVOCAÇÃO AGE', 85);

  // Parte já conferida pela Contabilidade, para o painel mostrar o mês em andamento.
  const ana = get("SELECT id FROM usuarios WHERE login = 'ana.contabil'").id;
  const pendentes = get("SELECT COUNT(*) AS n FROM lancamentos WHERE status = 'pendente'").n;
  run(`UPDATE lancamentos SET status = 'liberado', liberado_por = ?, liberado_em = datetime('now','localtime')
       WHERE id IN (SELECT id FROM lancamentos WHERE status = 'pendente' AND alerta IS NULL ORDER BY id LIMIT ?)`, ana, Math.floor(pendentes * 0.55));
});

const porta = parseInt(process.env.PORT || '3210', 10);
app.listen(porta, '127.0.0.1', () => {
  console.log(`\nCOPP de demonstração em http://localhost:${porta}\n`);
  console.log(`Senha de todos: ${SENHA}`);
  console.log('  admin          administrador (vê e faz tudo)');
  console.log('  ana.contabil   Contabilidade: importa, confere e libera');
  console.log('  carla.gerente  Gerência: acompanha e lança cópias');
  console.log('  edson.exp      Expedição: lança condução');
  console.log('  diretor        Diretoria: acompanha tudo, sem liberar\n');
});
