const { all, get, run } = require('./db');

// Identidade da administradora que usa o sistema. Fica na configuração do servidor, não no código:
// EMPRESA_NOME aparece no topo das folhas, EMPRESA_CURTA no "Emitido ... pela X" e EMPRESA_LOGO é o caminho de uma imagem.
const EMPRESA = process.env.EMPRESA_NOME || 'Administradora Exemplo';
const EMPRESA_CURTA = process.env.EMPRESA_CURTA || EMPRESA.split(/\s+-\s+/)[0].toLocaleUpperCase('pt-BR');
const EMPRESA_LOGO = process.env.EMPRESA_LOGO || '';
const CONTAS = {
  1732: { codigo: '1732', nome: 'Cópias xerográficas', titulo: 'Relatório de cópias xerográficas', tituloFolha: 'RELATÓRIO DE CÓPIAS XEROGRÁFICAS', unidade: 'páginas' },
  1741: { codigo: '1741', nome: 'Despesas de condução', titulo: 'Relatório de despesas de condução', tituloFolha: 'RELATÓRIO DE DESPESAS DE CONDUÇÃO', unidade: 'conduções' },
};
const contaDe = (v) => (String(v) === '1741' ? CONTAS[1741] : CONTAS[1732]);
const CONTA_CONTABIL = '1732 - Cópias xerográficas';
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const fmt = {
  brl: (centavos) => ((centavos || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
  dec: (centavos) => ((centavos || 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  num: (n) => (n || 0).toLocaleString('pt-BR'),
  cod4: (c) => String(c || '').padStart(4, '0'),
  data: (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : ''),
  dataHora: (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${iso.slice(11, 16)}` : ''),
  comp: (c) => (c ? `${MESES[parseInt(c.slice(5, 7), 10) - 1]}/${c.slice(0, 4)}` : ''),
  papel: (p) => (p === 'admin' ? 'Administrador' : 'Usuário'),
  funcao: (f) => ({ comum: 'Acompanha o que imprimiu ou lançou', gerencia: 'Gerentes de prédio: acompanham os seus condomínios', contabilidade: 'Importa, confere, libera e emite relatórios', diretoria: 'Acompanha tudo, sem liberar' }[f] || f),
};

// Total do condomínio no formato do relatório que a Contabilidade já recebia (ex.: 1,002.26).
fmt.totalFolha = (centavos) => ((centavos || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MESES_LONGOS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
fmt.mesAno = (c) => (c ? `${MESES_LONGOS[parseInt(c.slice(5, 7), 10) - 1]}/${c.slice(0, 4)}` : '');
fmt.periodo = (de, ate) => (de && ate ? `${fmt.data(de).slice(0, 5)} a ${fmt.data(ate)}` : '');

// ---- Configurações gerais
function config(chave, padrao) {
  const r = get('SELECT valor FROM configuracoes WHERE chave = ?', chave);
  return r ? r.valor : padrao;
}
function definirConfig(chave, valor) {
  run('INSERT INTO configuracoes (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor', chave, String(valor));
}

// ---- Fechamento
// O período de cada competência segue o "dia de início": 1 = mês do calendário (1 a 30/31);
// 16 = do dia 16 do mês anterior ao dia 15 do mês. A competência leva o nome do mês em que o período termina.
const pad = (n) => String(n).padStart(2, '0');
const isoDia = (d) => d.toISOString().slice(0, 10);
const somaDias = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return isoDia(d); };
const proximoMes = (comp) => { const [a, m] = comp.split('-').map(Number); const d = new Date(Date.UTC(a, m, 1)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`; };

function diaInicio() {
  const d = parseInt(config('dia_inicio', '1'), 10);
  return d >= 1 && d <= 28 ? d : 1;
}

function periodoDaRegra(comp, dia = diaInicio()) {
  const [a, m] = comp.split('-').map(Number);
  if (dia === 1) return { de: `${comp}-01`, ate: isoDia(new Date(Date.UTC(a, m, 0))) };
  return { de: isoDia(new Date(Date.UTC(a, m - 2, dia))), ate: isoDia(new Date(Date.UTC(a, m - 1, dia - 1))) };
}

function competenciaDaRegra(data, dia = diaInicio()) {
  const [a, m, d] = data.slice(0, 10).split('-').map(Number);
  const comp = `${a}-${pad(m)}`;
  return dia === 1 || d < dia ? comp : proximoMes(comp);
}

const competenciaFechada = (comp) => !!get("SELECT 1 AS x FROM lancamentos WHERE competencia = ? AND status = 'liberado' LIMIT 1", comp);

/**
 * Competência de uma data. Se a data cai num período que já existe, é ele. Senão, cria o período
 * pela regra atual, encaixado entre os vizinhos para não haver sobreposição (é o que acontece na
 * transição de uma regra para outra: o primeiro período da regra nova pode sair mais curto ou mais longo).
 */
function competenciaDe(data) {
  data = String(data).slice(0, 10);
  const achado = get('SELECT competencia FROM periodos WHERE ? BETWEEN de AND ate', data);
  if (achado) return achado.competencia;
  let comp = competenciaDaRegra(data);
  let { de, ate } = periodoDaRegra(comp);
  const antes = get('SELECT * FROM periodos WHERE ate < ? ORDER BY ate DESC LIMIT 1', data);
  const depois = get('SELECT * FROM periodos WHERE de > ? ORDER BY de LIMIT 1', data);
  if (antes && de <= antes.ate) de = somaDias(antes.ate, 1);
  if (depois && ate >= depois.de) ate = somaDias(depois.de, -1);
  for (let voltas = 0; voltas < 24 && get('SELECT 1 AS x FROM periodos WHERE competencia = ?', comp); voltas++) {
    // O nome já é de um vizinho ainda aberto: ele cresce até cobrir a data. Se já foi entregue, o período ganha o nome do mês seguinte.
    if (antes && antes.competencia === comp && !competenciaFechada(comp)) { run('UPDATE periodos SET ate = ? WHERE competencia = ?', ate, comp); return comp; }
    if (depois && depois.competencia === comp && !competenciaFechada(comp)) { run('UPDATE periodos SET de = ? WHERE competencia = ?', de, comp); return comp; }
    comp = proximoMes(comp);
  }
  run('INSERT INTO periodos (competencia, de, ate) VALUES (?,?,?)', comp, de, ate);
  return comp;
}

/**
 * Aplica uma regra nova de fechamento. Os períodos com algum lançamento liberado ficam como estão;
 * os demais são refeitos pela regra nova e os lançamentos deles mudam de competência conforme a data.
 */
function aplicarRegraFechamento(dia) {
  definirConfig('dia_inicio', dia);
  const abertos = all("SELECT competencia FROM periodos WHERE competencia NOT IN (SELECT competencia FROM lancamentos WHERE status = 'liberado')").map((p) => p.competencia);
  if (!abertos.length) return { periodos: 0, lancamentos: 0 };
  const marcas = abertos.map(() => '?').join(',');
  run(`DELETE FROM periodos WHERE competencia IN (${marcas})`, ...abertos);
  let mudaram = 0;
  for (const l of all(`SELECT id, data, competencia FROM lancamentos WHERE competencia IN (${marcas}) ORDER BY data, id`, ...abertos)) {
    const nova = competenciaDe(l.data);
    if (nova !== l.competencia) { run('UPDATE lancamentos SET competencia = ? WHERE id = ?', nova, l.id); mudaram++; }
  }
  return { periodos: abertos.length, lancamentos: mudaram };
}

/**
 * Refaz pela regra atual os períodos que não têm nenhum lançamento liberado. Serve para quando um mês
 * deixa de ter liberação (importação excluída ou desfeita): ele não fica preso às datas de uma regra antiga.
 */
const reajustarPeriodosAbertos = () => aplicarRegraFechamento(diaInicio());

/** Uma competência está liberada quando tem lançamentos e nenhum deles está pendente. */
function competencias() {
  return all(`SELECT l.competencia, p.de, p.ate,
                     SUM(l.status = 'pendente') AS pendentes,
                     SUM(l.status = 'liberado') AS liberados,
                     SUM(CASE WHEN l.status = 'liberado' THEN l.valor_centavos ELSE 0 END) AS valor_liberado,
                     SUM(l.valor_centavos) AS valor_total,
                     MAX(l.liberado_em) AS liberada_em
              FROM lancamentos l LEFT JOIN periodos p ON p.competencia = l.competencia WHERE l.status <> 'cancelado'
              GROUP BY l.competencia ORDER BY l.competencia DESC`)
    .map((c) => ({ ...c, ...(c.de ? {} : periodoDaRegra(c.competencia, 1)), total: c.pendentes + c.liberados, liberada: c.pendentes === 0 && c.liberados > 0 }));
}

function competenciaLiberada(competencia) {
  const c = get(`SELECT SUM(status = 'pendente') AS p, SUM(status = 'liberado') AS l FROM lancamentos WHERE competencia = ? AND status <> 'cancelado'`, competencia);
  return !!c && c.p === 0 && c.l > 0;
}

function auditar(usuarioId, acao, lancamentoId, detalhe) {
  run('INSERT INTO auditoria (usuario_id, acao, lancamento_id, detalhe) VALUES (?,?,?,?)', usuarioId, acao, lancamentoId || null, detalhe || null);
}

const condominiosAtivos = () => all('SELECT id, codigo, nome, responsavel_id FROM condominios WHERE ativo = 1 ORDER BY codigo');
const itensTodos = () => all('SELECT * FROM itens ORDER BY CAST(codigo AS INTEGER)');
const usuariosAtivos = () => all('SELECT id, login, nome, papel FROM usuarios WHERE ativo = 1 ORDER BY nome COLLATE NOCASE');
const departamentos = () => all('SELECT d.*, (SELECT COUNT(*) FROM usuarios u WHERE u.departamento_id = d.id) AS usuarios FROM departamentos d ORDER BY d.ordem, d.nome');

/** A pessoa e todos os que respondem a ela, direta ou indiretamente. É o alcance da carteira de um supervisor. */
function equipeDe(usuarioId) {
  return all(`WITH RECURSIVE e(id) AS (SELECT ? UNION SELECT u.id FROM usuarios u JOIN e ON u.superior_id = e.id) SELECT id FROM e`, usuarioId).map((r) => r.id);
}

const descricoesPadrao = () => all('SELECT id, texto FROM descricoes ORDER BY texto COLLATE NOCASE');

const idLista = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => parseInt(x, 10)).filter((n) => Number.isInteger(n) && n > 0);

module.exports = { CONTA_CONTABIL, EMPRESA, EMPRESA_CURTA, EMPRESA_LOGO, CONTAS, contaDe, fmt, config, definirConfig, diaInicio, periodoDaRegra, competenciaDaRegra, competenciaDe, aplicarRegraFechamento, reajustarPeriodosAbertos, competencias, competenciaLiberada, auditar, condominiosAtivos, itensTodos, usuariosAtivos, departamentos, equipeDe, descricoesPadrao, idLista };
