const express = require('express');
const { all } = require('../db');
const { competencias, periodoDaRegra, condominiosAtivos, contaDe, CONTAS, EMPRESA, fmt } = require('../dominio');

const r = express.Router();
const DATA = /^\d{4}-\d{2}-\d{2}$/;

// Recortes de um mês: o período de fechamento cadastrado, o mês do calendário ou o ciclo de 16 a 15.
const RECORTES = { fechamento: 'Período de fechamento', calendario: 'Mês do calendário (1 ao último dia)', ciclo16: 'Do dia 16 ao dia 15' };

/**
 * Resolve o período pedido e o que a pessoa pode ver nele.
 * O período é um mês (competência), recortado pelo fechamento, pelo calendário ou de 16 a 15, ou um intervalo livre de datas.
 * Quem não é administrador só recebe lançamentos de meses em que todas as carteiras liberaram.
 */
function resolver(req) {
  const comps = competencias();
  const admin = req.user.admin;
  let de = String(req.query.de || '');
  let ate = String(req.query.ate || '');
  const intervalo = DATA.test(de) && DATA.test(ate) && de <= ate;
  let competencia = null;
  const recorte = RECORTES[req.query.recorte] ? req.query.recorte : 'fechamento';
  if (!intervalo) {
    competencia = comps.find((c) => c.competencia === req.query.competencia) || comps.find((c) => c.liberada) || comps[0] || null;
    if (competencia) {
      const p = recorte === 'calendario' ? periodoDaRegra(competencia.competencia, 1)
        : recorte === 'ciclo16' ? periodoDaRegra(competencia.competencia, 16) : competencia;
      de = p.de;
      ate = p.ate;
    }
  }
  const noPeriodo = de && ate
    ? all("SELECT DISTINCT competencia FROM lancamentos WHERE data BETWEEN ? AND ? AND status <> 'cancelado' ORDER BY competencia", de, ate).map((x) => comps.find((c) => c.competencia === x.competencia)).filter(Boolean)
    : [];
  const emConferencia = noPeriodo.filter((c) => !c.liberada);
  const liberadas = noPeriodo.filter((c) => c.liberada).map((c) => c.competencia);
  return {
    comps, admin, intervalo, competencia, recorte, recortes: RECORTES, de, ate, emConferencia,
    temPeriodo: !!(de && ate),
    // Administrador vê prévia de tudo o que já foi liberado; os demais, só os meses entregues.
    visivel: admin ? noPeriodo.length > 0 || intervalo : liberadas.length > 0,
    mesesPermitidos: admin ? null : liberadas,
  };
}

function filtroMeses(ctx, alias = 'l') {
  if (ctx.mesesPermitidos === null) return { sql: '', p: [] };
  if (!ctx.mesesPermitidos.length) return { sql: ' AND 0', p: [] };
  return { sql: ` AND ${alias}.competencia IN (${ctx.mesesPermitidos.map(() => '?').join(',')})`, p: ctx.mesesPermitidos };
}

function pendencias(ctx) {
  if (!ctx.emConferencia.length) return [];
  const meses = ctx.emConferencia.map((c) => c.competencia);
  return all(`SELECT COALESCE(u.nome, 'Sem responsável') AS nome, COUNT(*) AS pendentes
              FROM lancamentos l LEFT JOIN usuarios u ON u.id = l.responsavel_id
              WHERE l.status = 'pendente' AND l.competencia IN (${meses.map(() => '?').join(',')}) GROUP BY l.responsavel_id ORDER BY pendentes DESC`, ...meses);
}

// ---- Por condomínio
// O analítico imita o relatório que a Contabilidade já recebia: uma folha A4 por condomínio, quebrada
// em páginas numeradas. Descrições longas ocupam duas linhas, por isso a conta é feita em "linhas de texto".
// Capacidade de cada folha em "linhas de texto" (descrições longas ocupam duas ou mais).
const CAPACIDADE = { primeira: 36, seguintes: 40, indicePrimeira: 36, indiceSeguintes: 40 };
function paginar(linhas, primeira, seguintes, altura = () => 1) {
  const paginas = [[]];
  let usadas = 0;
  for (const l of linhas) {
    const h = altura(l);
    const limite = paginas.length === 1 ? primeira : seguintes;
    if (usadas + h > limite && paginas[paginas.length - 1].length) { paginas.push([]); usadas = 0; }
    paginas[paginas.length - 1].push(l);
    usadas += h;
  }
  return paginas;
}
const alturaLancamento = (l) => Math.max(1, Math.ceil(String(l.descricao || '').length / 30));
// Nome curto do item, para a coluna Item da folha.
const ROTULO_TIPO = { simples: 'P&B', colorida: 'Cor', duplex: 'Frente/verso' };
const rotuloItem = (l) => ROTULO_TIPO[l.item_tipo] || l.item_desc;

function porCondominio(ctx, conta, condominioId) {
  const m = filtroMeses(ctx);
  const p = [ctx.de, ctx.ate, conta, ...m.p];
  let filtro = '';
  if (condominioId) { filtro = ' AND l.condominio_id = ?'; p.push(condominioId); }
  const linhas = all(`SELECT l.id, l.data, l.descricao, l.quantidade, l.preco_centavos, l.valor_centavos, l.condominio_id, l.hora_inicio, l.hora_fim,
                             c.codigo AS cond_codigo, c.nome AS cond_nome, i.codigo AS item_codigo, i.descricao AS item_desc, i.tipo AS item_tipo, f.nome AS func_nome
                      FROM lancamentos l JOIN condominios c ON c.id = l.condominio_id JOIN itens i ON i.id = l.item_id LEFT JOIN usuarios f ON f.id = l.funcionario_id
                      WHERE l.status = 'liberado' AND l.data BETWEEN ? AND ? AND i.conta = ?${m.sql}${filtro}
                      ORDER BY c.codigo, l.data, l.id`, ...p);
  const grupos = [];
  for (const l of linhas) {
    let g = grupos[grupos.length - 1];
    if (!g || g.id !== l.condominio_id) { g = { id: l.condominio_id, codigo: l.cond_codigo, nome: l.cond_nome, linhas: [], quantidade: 0, valor: 0 }; grupos.push(g); }
    g.linhas.push(l);
    g.quantidade += l.quantidade;
    g.valor += l.valor_centavos;
  }
  for (const g of grupos) {
    g.paginas = paginar(g.linhas, CAPACIDADE.primeira, CAPACIDADE.seguintes, alturaLancamento);
    // Resumo por item, na ordem do código: é o que o síndico olha primeiro.
    const itens = new Map();
    for (const l of g.linhas) {
      l.item_rotulo = rotuloItem(l);
      const it = itens.get(l.item_codigo) || { codigo: l.item_codigo, rotulo: l.item_rotulo, quantidade: 0, valor: 0 };
      it.quantidade += l.quantidade; it.valor += l.valor_centavos;
      itens.set(l.item_codigo, it);
    }
    g.itens = [...itens.values()].sort((x, y) => Number(x.codigo) - Number(y.codigo));
  }
  const indice = paginar(grupos, CAPACIDADE.indicePrimeira, CAPACIDADE.indiceSeguintes);
  return { linhas, grupos, indice, total: { quantidade: linhas.reduce((s, l) => s + l.quantidade, 0), valor: linhas.reduce((s, l) => s + l.valor_centavos, 0) } };
}

const base = (ctx, req) => ({
  ...ctx, empresa: EMPRESA, contas: Object.values(CONTAS),
  consulta: new URLSearchParams(Object.entries(req.query).filter(([, v]) => typeof v === 'string' && v !== '')).toString(),
});

r.get('/', (req, res) => {
  const ctx = resolver(req);
  const conta = contaDe(req.query.conta);
  const condominio = parseInt(req.query.condominio, 10) || 0;
  const modo = req.query.modo === 'sintetico' ? 'sintetico' : 'analitico';
  const agora = new Date();
  const hora = (o) => agora.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', ...o });
  res.render('relatorios', {
    ...base(ctx, req), conta, condominio, modo,
    emitido: `Emitido em ${hora({ day: '2-digit', month: '2-digit', year: 'numeric' })} às ${hora({ hour: '2-digit', minute: '2-digit' })} pela PROP STARTER`,
    relatorio: ctx.visivel ? porCondominio(ctx, conta.codigo, condominio) : null,
    pendencias: pendencias(ctx), condominios: condominiosAtivos(),
  });
});

// Planilhas tratam células iniciadas por =, +, - ou @ como fórmula.
const celula = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
function enviarCsv(res, nome, cabecalho, linhas) {
  const csv = '﻿' + [cabecalho, ...linhas].map((l) => l.map(celula).join(';')).join('\r\n') + '\r\n';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
  res.send(csv);
}
const emAberto = (res) => res.status(409).render('erro', { titulo: 'Há lançamentos em aberto', mensagem: 'A planilha fica disponível quando todos os lançamentos do período estiverem liberados.' });
const negar = (res) => res.status(403).render('erro', { titulo: 'Período ainda não liberado', mensagem: 'O arquivo fica disponível quando todos os responsáveis liberarem seus lançamentos.' });

r.get('/csv', (req, res) => {
  const ctx = resolver(req);
  if (!ctx.visivel) return negar(res);
  if (ctx.emConferencia.length) return emAberto(res);
  const conta = contaDe(req.query.conta);
  const { linhas } = porCondominio(ctx, conta.codigo, parseInt(req.query.condominio, 10) || 0);
  enviarCsv(res, `${conta.codigo === '1741' ? 'conducao' : 'copias'}-${ctx.de}-a-${ctx.ate}.csv`,
    ['Período', 'Código', 'Condomínio', 'Conta', 'Nº lançamento', 'Data', 'Cód. item', 'Item', 'Descrição', 'Funcionário', 'Quantidade', 'Valor unitário', 'Valor'],
    linhas.map((l) => [`${fmt.data(ctx.de)} a ${fmt.data(ctx.ate)}`, l.cond_codigo, l.cond_nome, `${conta.codigo} - ${conta.nome}`, l.id, fmt.data(l.data), fmt.cod4(l.item_codigo), l.item_desc, l.descricao,
      l.func_nome || '', l.quantidade, fmt.dec(l.preco_centavos), fmt.dec(l.valor_centavos)]));
});

// ---- Por funcionário
// Cópias vindas do PaperCut são atribuídas a quem imprimiu cada trabalho; lançamentos manuais e de condução, ao funcionário informado.
function porFuncionario(ctx) {
  const m = filtroMeses(ctx);
  const p = [ctx.de, ctx.ate, ...m.p];
  return all(`
    SELECT CASE WHEN u.id IS NOT NULL THEN 'u' || u.id ELSE 'p' || LOWER(t.pc_usuario) END AS chave,
           COALESCE(u.nome, NULLIF(t.pc_nome, ''), t.pc_usuario) AS nome, substr(t.data_hora, 1, 10) AS data, l.id, l.descricao,
           lt.quantidade AS quantidade, lt.quantidade * l.preco_centavos AS valor, c.codigo AS cond_codigo, c.nome AS cond_nome, i.codigo AS item_codigo, i.descricao AS item_desc, i.conta
    FROM lancamento_trabalhos lt JOIN trabalhos t ON t.id = lt.trabalho_id JOIN lancamentos l ON l.id = lt.lancamento_id
         JOIN condominios c ON c.id = l.condominio_id JOIN itens i ON i.id = l.item_id LEFT JOIN usuarios u ON u.login = t.pc_usuario
    WHERE l.status = 'liberado' AND l.data BETWEEN ? AND ?${m.sql}
    UNION ALL
    SELECT 'u' || COALESCE(u.id, 0), COALESCE(u.nome, 'Sem funcionário'), l.data, l.id, l.descricao,
           l.quantidade, l.valor_centavos, c.codigo, c.nome, i.codigo, i.descricao, i.conta
    FROM lancamentos l JOIN condominios c ON c.id = l.condominio_id JOIN itens i ON i.id = l.item_id
         LEFT JOIN usuarios u ON u.id = COALESCE(l.funcionario_id, l.criado_por, l.responsavel_id)
    WHERE l.status = 'liberado' AND l.data BETWEEN ? AND ?${m.sql}
      AND NOT EXISTS (SELECT 1 FROM lancamento_trabalhos x WHERE x.lancamento_id = l.id)
    ORDER BY 2, 3, 4`, ...p, ...p);
}

function agrupar(linhas) {
  const mapa = new Map();
  for (const l of linhas) {
    let f = mapa.get(l.chave);
    if (!f) { f = { chave: l.chave, nome: l.nome, paginas: 0, valorCopias: 0, conducoes: 0, valorConducao: 0, total: 0, linhas: [] }; mapa.set(l.chave, f); }
    if (l.conta === '1741') { f.conducoes += l.quantidade; f.valorConducao += l.valor; } else { f.paginas += l.quantidade; f.valorCopias += l.valor; }
    f.total += l.valor;
    f.linhas.push(l);
  }
  return [...mapa.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

r.get('/funcionarios', (req, res) => {
  const ctx = resolver(req);
  const todos = ctx.visivel ? agrupar(porFuncionario(ctx)) : [];
  const chave = String(req.query.funcionario || '');
  const escolhido = todos.find((f) => f.chave === chave) || null;
  const soma = (campo) => todos.reduce((s, f) => s + f[campo], 0);
  res.render('relatorio_funcionarios', {
    ...base(ctx, req), todos, escolhido, chave, pendencias: pendencias(ctx),
    total: { paginas: soma('paginas'), valorCopias: soma('valorCopias'), conducoes: soma('conducoes'), valorConducao: soma('valorConducao'), total: soma('total') },
  });
});

r.get('/funcionarios/csv', (req, res) => {
  const ctx = resolver(req);
  if (!ctx.visivel) return negar(res);
  if (ctx.emConferencia.length) return emAberto(res);
  const chave = String(req.query.funcionario || '');
  const linhas = porFuncionario(ctx).filter((l) => !chave || l.chave === chave);
  enviarCsv(res, `despesas-por-funcionario-${ctx.de}-a-${ctx.ate}.csv`,
    ['Período', 'Funcionário', 'Data', 'Nº lançamento', 'Conta', 'Código', 'Condomínio', 'Cód. item', 'Item', 'Descrição', 'Quantidade', 'Valor'],
    linhas.map((l) => [`${fmt.data(ctx.de)} a ${fmt.data(ctx.ate)}`, l.nome, fmt.data(l.data), l.id, contaDe(l.conta).nome, l.cond_codigo, l.cond_nome, fmt.cod4(l.item_codigo), l.item_desc, l.descricao, l.quantidade, fmt.dec(l.valor)]));
});

module.exports = r;
