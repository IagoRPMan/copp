const express = require('express');
const { all, get, run, tx } = require('../db');
const { flash } = require('../auth');
const { competencias, competenciaDe, competenciaLiberada, auditar, condominiosAtivos, itensTodos, usuariosAtivos, equipeDe, descricoesPadrao, idLista } = require('../dominio');
const { descricaoPadrao, descricaoValida, dataValida } = require('../texto');
const { quantidadeRestante } = require('../papercut');

const r = express.Router();
const LIMITE = 3000;
// Quem confere e libera é sempre a Contabilidade (e o administrador). Ninguém aprova o próprio lançamento.
// Para ver: Contabilidade, administrador e Diretoria veem tudo; os demais acompanham, só para consulta,
// o que imprimiram ou lançaram, a carteira de quem responde a eles e os prédios que gerenciam.
// Quem lançou à mão ainda pode corrigir ou cancelar o próprio lançamento enquanto ele estiver pendente.
const veTudo = (req) => req.user.verTudo || req.user.conferir;
const carteira = (req) => (req.carteira || (req.carteira = equipeDe(req.user.id)));
const podeVer = (req, l) => veTudo(req) || carteira(req).includes(l.responsavel_id) || carteira(req).includes(l.cond_gerente) || l.criado_por === req.user.id;
const podeLiberar = (req) => !!req.user.conferir;
const podeMexer = (req, l) => !!req.user.conferir || (l.criado_por === req.user.id && l.status === 'pendente');

const SELECAO = `SELECT l.*, c.codigo AS cond_codigo, c.nome AS cond_nome, i.codigo AS item_codigo, i.descricao AS item_desc, i.conta AS conta, i.valor_livre AS valor_livre,
                        c.responsavel_id AS cond_gerente, u.nome AS resp_nome, f.nome AS func_nome
                 FROM lancamentos l JOIN condominios c ON c.id = l.condominio_id JOIN itens i ON i.id = l.item_id
                 LEFT JOIN usuarios u ON u.id = l.responsavel_id LEFT JOIN usuarios f ON f.id = l.funcionario_id`;

function carregar(req, res) {
  const l = get(SELECAO + ' WHERE l.id = ?', parseInt(req.params.id, 10) || 0);
  if (!l || !podeVer(req, l)) {
    res.status(404).render('erro', { titulo: 'Lançamento não encontrado', mensagem: 'Ele não existe ou pertence à carteira de outra pessoa.' });
    return null;
  }
  return l;
}

// ---- Lista de conferência
r.get('/', (req, res) => {
  const comps = competencias();
  const competencia = String(req.query.competencia || (comps[0] && comps[0].competencia) || '');
  const status = ['pendente', 'liberado', 'cancelado', 'ativos'].includes(req.query.status) ? req.query.status : 'ativos';
  const filtros = { competencia, status, condominio: parseInt(req.query.condominio, 10) || 0, responsavel: 0, q: String(req.query.q || '').trim().slice(0, 80), alerta: req.query.alerta === '1', conta: ['1732', '1741'].includes(req.query.conta) ? req.query.conta : '' };

  const onde = ['l.competencia = ?'];
  const p = [competencia];
  if (status === 'ativos') onde.push("l.status <> 'cancelado'"); else { onde.push('l.status = ?'); p.push(status); }
  if (veTudo(req)) {
    filtros.responsavel = parseInt(req.query.responsavel, 10) || 0;
    if (filtros.responsavel) { onde.push('l.responsavel_id = ?'); p.push(filtros.responsavel); }
  } else {
    const ids = carteira(req);
    filtros.responsavel = ids.includes(parseInt(req.query.responsavel, 10)) ? parseInt(req.query.responsavel, 10) : 0;
    if (filtros.responsavel) { onde.push('l.responsavel_id = ?'); p.push(filtros.responsavel); }
    else { onde.push(`(l.responsavel_id IN (${ids.join(',')}) OR c.responsavel_id IN (${ids.join(',')}) OR l.criado_por = ?)`); p.push(req.user.id); }
  }
  if (filtros.condominio) { onde.push('l.condominio_id = ?'); p.push(filtros.condominio); }
  if (filtros.alerta) onde.push('l.alerta IS NOT NULL');
  if (filtros.conta) { onde.push('i.conta = ?'); p.push(filtros.conta); }
  if (filtros.q) { onde.push('(l.descricao LIKE ? OR c.nome LIKE ? OR c.codigo LIKE ?)'); const t = '%' + filtros.q + '%'; p.push(t, t, t); }

  const linhas = all(`${SELECAO} WHERE ${onde.join(' AND ')} ORDER BY c.codigo, l.data, l.id LIMIT ${LIMITE + 1}`, ...p);
  // Nomes dos arquivos impressos que formam cada lançamento (do PaperCut), para ajudar a conferir a descrição.
  if (linhas.length) {
    const ids = linhas.map((l) => l.id);
    const docs = new Map();
    for (let i = 0; i < ids.length; i += 500) {
      const lote = ids.slice(i, i + 500);
      for (const d of all(`SELECT DISTINCT lt.lancamento_id AS id, t.documento FROM lancamento_trabalhos lt JOIN trabalhos t ON t.id = lt.trabalho_id
                            WHERE lt.lancamento_id IN (${lote.map(() => '?').join(',')}) AND t.documento <> '' ORDER BY t.data_hora`, ...lote)) {
        if (!docs.has(d.id)) docs.set(d.id, []);
        docs.get(d.id).push(d.documento);
      }
    }
    for (const l of linhas) l.arquivos = docs.get(l.id) || [];
  }
  const cortado = linhas.length > LIMITE;
  if (cortado) linhas.pop();

  const grupos = [];
  for (const l of linhas) {
    l.editavel = l.status === 'pendente' && podeMexer(req, l);
    let g = grupos[grupos.length - 1];
    if (!g || g.id !== l.condominio_id) { g = { id: l.condominio_id, codigo: l.cond_codigo, nome: l.cond_nome, linhas: [], valor: 0, pendentes: 0 }; grupos.push(g); }
    g.linhas.push(l);
    if (l.status !== 'cancelado') g.valor += l.valor_centavos;
    if (l.status === 'pendente') g.pendentes++;
  }
  const resumo = {
    pendentes: linhas.filter((l) => l.status === 'pendente').length,
    liberados: linhas.filter((l) => l.status === 'liberado').length,
    valor: linhas.filter((l) => l.status !== 'cancelado').reduce((s, l) => s + l.valor_centavos, 0),
    alertas: linhas.filter((l) => l.alerta && l.status === 'pendente').length,
  };
  res.render('lancamentos', {
    comps, filtros, grupos, resumo, cortado, limite: LIMITE,
    condominios: condominiosAtivos(), descricoes: descricoesPadrao(),
    responsaveis: veTudo(req) ? usuariosAtivos() : (carteira(req).length > 1 ? usuariosAtivos().filter((u) => carteira(req).includes(u.id)) : []),
    podeLiberar: podeLiberar(req), veTudo: veTudo(req),
    compLiberada: competencia ? competenciaLiberada(competencia) : false,
    voltar: req.originalUrl,
  });
});

// ---- Lote: salva o que foi editado direto na lista e, se pedido, libera os marcados
r.post('/lote', (req, res) => {
  const liberar = req.body.acao === 'liberar';
  const marcados = new Set(idLista(req.body.ids));
  let salvos = 0;
  let liberados = 0;
  const invalidos = [];
  tx(() => {
    for (const chave of Object.keys(req.body)) {
      const m = /^d_(\d+)$/.exec(chave);
      if (!m) continue;
      const id = parseInt(m[1], 10);
      const l = get('SELECT l.id, l.responsavel_id, l.criado_por, l.status, l.descricao, l.quantidade, l.preco_centavos, c.responsavel_id AS cond_gerente FROM lancamentos l JOIN condominios c ON c.id = l.condominio_id WHERE l.id = ?', id);
      if (!l || l.status !== 'pendente' || !podeMexer(req, l)) continue;
      const descricao = descricaoPadrao(req.body[chave]);
      const bruto = String(req.body['q_' + id] ?? '').trim();
      const quantidade = /^\d{1,7}$/.test(bruto) ? parseInt(bruto, 10) : 0;
      if (!descricaoValida(descricao) || quantidade < 1) { invalidos.push(id); marcados.delete(id); continue; }
      const mudancas = [];
      if (quantidade !== l.quantidade) mudancas.push(`quantidade: ${l.quantidade} → ${quantidade}`);
      if (descricao !== l.descricao) mudancas.push(`descrição: "${l.descricao}" → "${descricao}"`);
      if (!mudancas.length) continue;
      run("UPDATE lancamentos SET descricao = ?, quantidade = ?, valor_centavos = ?, atualizado_em = datetime('now','localtime') WHERE id = ?",
        descricao, quantidade, quantidade * l.preco_centavos, id);
      auditar(req.user.id, 'editou', id, mudancas.join('; '));
      salvos++;
    }
    if (liberar) {
      for (const id of marcados) {
        const l = get('SELECT id, status FROM lancamentos WHERE id = ?', id);
        if (!l || l.status !== 'pendente' || !podeLiberar(req)) continue;
        run("UPDATE lancamentos SET status = 'liberado', liberado_por = ?, liberado_em = datetime('now','localtime'), atualizado_em = datetime('now','localtime') WHERE id = ?", req.user.id, id);
        auditar(req.user.id, 'liberou', id, null);
        liberados++;
      }
    }
  });
  const partes = [];
  if (salvos) partes.push(`${salvos} alteraç${salvos > 1 ? 'ões salvas' : 'ão salva'}`);
  if (liberados) partes.push(`${liberados} lançamento${liberados > 1 ? 's liberados' : ' liberado'}`);
  if (invalidos.length) {
    flash(req, 'erro', `${partes.length ? partes.join(' e ') + '. ' : ''}Não salvei ${invalidos.length} lançamento(s) (nº ${invalidos.join(', ')}): a descrição precisa dizer o que foi impresso (pelo menos 3 letras) e a quantidade precisa ser um inteiro maior que zero.`);
  } else if (partes.length) flash(req, 'ok', partes.join(' e ') + '.');
  else flash(req, 'aviso', liberar ? 'Marque ao menos um lançamento pendente para liberar.' : 'Nada foi alterado.');
  res.redirect(voltarSeguro(req.body.voltar));
});

// Só volta para páginas do próprio sistema: a lista de lançamentos ou a área de novo lançamento.
function voltarSeguro(v) {
  return typeof v === 'string' && /^\/(lancamentos|lancar)(\?|$)/.test(v) ? v : '/lancamentos';
}

// ---- Formulário
function opcoes(req, l) {
  const conta = (l && l.conta) || '1732';
  return { condominios: condominiosAtivos(), descricoes: descricoesPadrao(),
    itens: itensTodos().filter((i) => i.conta === conta && (i.ativo || (l && i.id === l.item_id))),
    podeLiberar: l && l.id ? podeLiberar(req) : false,
    podeEditar: !l || !l.id || podeMexer(req, l),
    podeMover: podeLiberar(req) };
}

function centavosDe(texto) {
  const m = /^\s*(\d{1,6})(?:[.,](\d{1,2}))?\s*$/.exec(String(texto || ''));
  return m ? parseInt(m[1], 10) * 100 + parseInt((m[2] || '0').padEnd(2, '0'), 10) : null;
}

/** Lê e valida o formulário. "atual" é o lançamento em edição, ou só { conta } num lançamento novo. */
function lerFormulario(req, atual) {
  const b = req.body;
  const dados = {
    condominio_id: parseInt(b.condominio_id, 10) || 0,
    item_id: parseInt(b.item_id, 10) || 0,
    data: String(b.data || ''),
    descricao: descricaoPadrao(b.descricao),
    quantidade: /^\d{1,7}$/.test(String(b.quantidade || '').trim()) ? parseInt(b.quantidade, 10) : 0,
    responsavel_id: undefined,
    valor: String(b.valor || '').trim().slice(0, 12),
  };
  const erros = [];
  if (!get('SELECT 1 AS x FROM condominios WHERE id = ? AND ativo = 1', dados.condominio_id)) erros.push('Escolha o condomínio.');
  const item = get('SELECT * FROM itens WHERE id = ?', dados.item_id);
  if (!item || (!item.ativo && atual.item_id !== item.id)) erros.push('Escolha o item.');
  else if (item.conta !== atual.conta) erros.push('O item precisa ser da mesma conta do lançamento.');
  if (!dataValida(dados.data)) erros.push('Informe uma data válida.');
  if (!descricaoValida(dados.descricao)) erros.push('Descreva o que foi impresso (pelo menos 3 letras).');
  if (dados.quantidade < 1) erros.push('A quantidade precisa ser um número inteiro maior que zero.');
  let preco = null;
  if (item && item.valor_livre) {
    preco = centavosDe(dados.valor);
    if (!preco) erros.push('Informe o valor da condução, no formato 12,50.');
  }
  return { dados, erros, item, preco };
}

const contaPedida = (v) => (String(v) === '1741' ? '1741' : '1732');

r.get('/novo', (req, res) => {
  const hoje = new Date();
  const l = { id: 0, status: 'pendente', conta: contaPedida(req.query.conta), condominio_id: 0, item_id: 0, descricao: '', quantidade: '', responsavel_id: null,
    valor: '',
    data: `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}` };
  if (l.conta === '1741') l.quantidade = 1;
  res.render('lancamento_form', { l, erros: [], trabalhos: [], historico: [], voltar: voltarSeguro(req.query.voltar), ...opcoes(req, l) });
});

r.post('/novo', (req, res) => {
  const conta = contaPedida(req.body.conta);
  const { dados, erros, item, preco: valorInformado } = lerFormulario(req, { conta, item_id: 0 });
  const voltar = voltarSeguro(req.body.voltar);
  if (erros.length) {
    const l = { id: 0, status: 'pendente', conta, ...dados };
    return res.status(400).render('lancamento_form', { l, erros, trabalhos: [], historico: [], voltar, ...opcoes(req, l) });
  }
  const preco = item.valor_livre ? valorInformado : item.preco_centavos;
  // Fica registrado em nome de quem lançou; a conferência e a liberação são da Contabilidade.
  const resp = req.user.id;
  const competencia = competenciaDe(dados.data);
  // Funcionário é sempre quem lançou (o relatório por funcionário usa esse campo).
  const ins = run(`INSERT INTO lancamentos (competencia, condominio_id, item_id, data, descricao, quantidade, preco_centavos, valor_centavos, responsavel_id, origem, criado_por, funcionario_id)
                   VALUES (?,?,?,?,?,?,?,?,?,'manual',?,?)`,
    competencia, dados.condominio_id, dados.item_id, dados.data, dados.descricao, dados.quantidade, preco, dados.quantidade * preco, resp, req.user.id,
    req.user.id);
  auditar(req.user.id, conta === '1741' ? 'lançou condução' : 'criou manualmente', Number(ins.lastInsertRowid), null);
  const id = Number(ins.lastInsertRowid);
  // Quem lançou pela área "Novo lançamento" volta para ela, pronto para lançar o próximo.
  if (voltar.startsWith('/lancar')) {
    flash(req, 'ok', `Lançamento nº ${id} registrado. Ele aparece abaixo e vai para a conferência da Contabilidade.`);
    return res.redirect('/lancar');
  }
  flash(req, 'ok', podeLiberar(req) ? 'Lançamento criado como pendente. Confira e libere quando estiver certo.' : 'Lançamento criado. Ele vai para a conferência da Contabilidade; enquanto estiver pendente, você ainda pode corrigi-lo.');
  res.redirect('/lancamentos?competencia=' + competencia);
});

function detalhes(id) {
  return {
    trabalhos: all(`SELECT t.*, lt.quantidade AS qtd FROM lancamento_trabalhos lt JOIN trabalhos t ON t.id = lt.trabalho_id WHERE lt.lancamento_id = ? ORDER BY t.data_hora`, id),
    historico: all(`SELECT a.*, u.nome AS usuario_nome FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id WHERE a.lancamento_id = ? ORDER BY a.id DESC`, id),
  };
}

r.get('/:id', (req, res) => {
  const l = carregar(req, res);
  if (!l) return;
  res.render('lancamento_form', { l, erros: [], voltar: voltarSeguro(req.query.voltar), ...detalhes(l.id), ...opcoes(req, l) });
});

r.post('/:id', (req, res) => {
  const l = carregar(req, res);
  if (!l) return;
  const voltar = voltarSeguro(req.body.voltar);
  if (l.status !== 'pendente') { flash(req, 'aviso', 'Só lançamentos pendentes podem ser editados. Reabra o lançamento primeiro.'); return res.redirect('/lancamentos/' + l.id); }
  if (!podeMexer(req, l)) { flash(req, 'erro', 'Só a Contabilidade confere e altera este lançamento.'); return res.redirect('/lancamentos/' + l.id); }
  const { dados, erros, preco: valorInformado } = lerFormulario(req, l);
  if (erros.length) return res.status(400).render('lancamento_form', { l: { ...l, ...dados, responsavel_id: dados.responsavel_id === undefined ? l.responsavel_id : dados.responsavel_id }, erros, voltar, ...detalhes(l.id), ...opcoes(req, l) });

  const mudancas = [];
  const novoCond = get('SELECT codigo, nome, responsavel_id FROM condominios WHERE id = ?', dados.condominio_id);
  const novoItem = get('SELECT descricao, preco_centavos FROM itens WHERE id = ?', dados.item_id);
  let preco = l.preco_centavos;
  // Administrador pode escolher o responsável; em branco, o lançamento continua com quem já estava.
  // Trocar o condomínio não muda a carteira: quem imprimiu continua respondendo pelo lançamento.
  let resp = dados.responsavel_id === undefined ? l.responsavel_id : (dados.responsavel_id || null);
  if (dados.condominio_id !== l.condominio_id) mudancas.push(`condomínio: ${l.cond_codigo} ${l.cond_nome} → ${novoCond.codigo} ${novoCond.nome}`);
  if (!resp) resp = l.responsavel_id || novoCond.responsavel_id;
  if (dados.item_id !== l.item_id) { mudancas.push(`item: ${l.item_desc} → ${novoItem.descricao}`); preco = novoItem.preco_centavos; }
  if (valorInformado) {
    if (valorInformado !== preco) mudancas.push(`valor: ${preco / 100} → ${valorInformado / 100}`);
    preco = valorInformado;
  }
  if (dados.quantidade !== l.quantidade) mudancas.push(`quantidade: ${l.quantidade} → ${dados.quantidade}`);
  if (dados.descricao !== l.descricao) mudancas.push(`descrição: "${l.descricao}" → "${dados.descricao}"`);
  if (dados.data !== l.data) mudancas.push(`data: ${l.data} → ${dados.data}`);
  if ((resp || null) !== (l.responsavel_id || null)) mudancas.push('responsável alterado');

  const liberar = req.body.acao === 'liberar' && podeLiberar(req);
  tx(() => {
    run(`UPDATE lancamentos SET competencia = ?, condominio_id = ?, item_id = ?, data = ?, descricao = ?, quantidade = ?, preco_centavos = ?, valor_centavos = ?,
                responsavel_id = ?, alerta = CASE WHEN ? THEN NULL ELSE alerta END, atualizado_em = datetime('now','localtime') WHERE id = ?`,
      competenciaDe(dados.data), dados.condominio_id, dados.item_id, dados.data, dados.descricao, dados.quantidade, preco, dados.quantidade * preco,
      resp, dados.condominio_id !== l.condominio_id ? 1 : 0, l.id);
    if (mudancas.length) auditar(req.user.id, 'editou', l.id, mudancas.join('; '));
    if (liberar) {
      run("UPDATE lancamentos SET status = 'liberado', liberado_por = ?, liberado_em = datetime('now','localtime') WHERE id = ?", req.user.id, l.id);
      auditar(req.user.id, 'liberou', l.id, null);
    }
  });
  flash(req, 'ok', liberar ? 'Lançamento salvo e liberado.' : 'Alterações salvas.');
  res.redirect(voltar);
});

// ---- Mover trabalhos cobrados da conta errada para o condomínio certo
r.post('/:id/mover', (req, res) => {
  const l = carregar(req, res);
  if (!l) return;
  const destino = get('SELECT id, codigo, nome, responsavel_id FROM condominios WHERE id = ? AND ativo = 1', parseInt(req.body.condominio_id, 10) || 0);
  const escolhidos = new Set(idLista(req.body.trabalhos));
  const vinculos = all('SELECT trabalho_id, quantidade FROM lancamento_trabalhos WHERE lancamento_id = ?', l.id);
  const mover = vinculos.filter((v) => escolhidos.has(v.trabalho_id));
  const aqui = '/lancamentos/' + l.id + '?voltar=' + encodeURIComponent(voltarSeguro(req.body.voltar));
  if (!podeLiberar(req)) { flash(req, 'erro', 'Só a Contabilidade move trabalhos entre condomínios.'); return res.redirect(aqui); }
  if (l.status !== 'pendente') { flash(req, 'aviso', 'Só lançamentos pendentes podem ser divididos.'); return res.redirect(aqui); }
  if (!destino || destino.id === l.condominio_id) { flash(req, 'erro', 'Escolha um condomínio de destino diferente do atual.'); return res.redirect(aqui); }
  if (!mover.length) { flash(req, 'erro', 'Marque os trabalhos que pertencem a outro condomínio.'); return res.redirect(aqui); }

  const qtd = mover.reduce((s, v) => s + v.quantidade, 0);
  const vinculado = vinculos.reduce((s, v) => s + v.quantidade, 0);
  const sobra = quantidadeRestante(l.quantidade, vinculado, qtd);
  if (mover.length < vinculos.length && sobra.editado && l.quantidade - qtd < 1) {
    flash(req, 'erro', `A quantidade deste lançamento foi corrigida para ${l.quantidade}, menos do que as ${qtd} página(s) marcadas. Ajuste a quantidade antes de mover.`);
    return res.redirect(aqui);
  }
  const resp = l.responsavel_id || destino.responsavel_id;
  let novoId = l.id;
  tx(() => {
    if (mover.length === vinculos.length) {
      // Todos os trabalhos mudam: basta trocar o condomínio do lançamento.
      run("UPDATE lancamentos SET condominio_id = ?, responsavel_id = ?, alerta = NULL, atualizado_em = datetime('now','localtime') WHERE id = ?", destino.id, resp, l.id);
      auditar(req.user.id, 'editou', l.id, `condomínio: ${l.cond_codigo} ${l.cond_nome} → ${destino.codigo} ${destino.nome}`);
    } else {
      const resto = sobra.quantidade;
      const ins = run(`INSERT INTO lancamentos (competencia, condominio_id, item_id, data, descricao, quantidade, preco_centavos, valor_centavos, responsavel_id, origem, importacao_id)
                       VALUES (?,?,?,?,?,?,?,?,?,'papercut',?)`,
        l.competencia, destino.id, l.item_id, l.data, l.descricao, qtd, l.preco_centavos, qtd * l.preco_centavos, resp, l.importacao_id);
      novoId = Number(ins.lastInsertRowid);
      for (const v of mover) run('UPDATE lancamento_trabalhos SET lancamento_id = ? WHERE lancamento_id = ? AND trabalho_id = ?', novoId, l.id, v.trabalho_id);
      run("UPDATE lancamentos SET quantidade = ?, valor_centavos = ?, alerta = NULL, atualizado_em = datetime('now','localtime') WHERE id = ?", resto, resto * l.preco_centavos, l.id);
      auditar(req.user.id, 'dividiu', l.id, `${mover.length} trabalho(s), ${qtd} página(s), foram para ${destino.codigo} ${destino.nome} (lançamento ${novoId}); quantidade: ${l.quantidade} → ${resto}`);
      auditar(req.user.id, 'criou por divisão', novoId, `veio do lançamento ${l.id} (${l.cond_codigo} ${l.cond_nome})`);
    }
  });
  flash(req, 'ok', `${qtd} página(s) movidas para ${destino.codigo} · ${destino.nome}.`);
  res.redirect('/lancamentos/' + novoId);
});

r.post('/:id/cancelar', (req, res) => {
  const l = carregar(req, res);
  if (!l) return;
  const motivo = String(req.body.motivo || '').trim().slice(0, 200);
  if (!podeMexer(req, l)) flash(req, 'erro', 'Só a Contabilidade cancela este lançamento.');
  else if (l.status !== 'pendente') flash(req, 'aviso', 'Só lançamentos pendentes podem ser cancelados.');
  else if (!motivo) { flash(req, 'erro', 'Informe o motivo do cancelamento.'); return res.redirect('/lancamentos/' + l.id); }
  else {
    run("UPDATE lancamentos SET status = 'cancelado', cancelado_motivo = ?, atualizado_em = datetime('now','localtime') WHERE id = ?", motivo, l.id);
    auditar(req.user.id, 'cancelou', l.id, motivo);
    flash(req, 'ok', 'Lançamento cancelado. Ele não vai para a Contabilidade.');
  }
  res.redirect(voltarSeguro(req.body.voltar));
});

r.post('/:id/reabrir', (req, res) => {
  const l = carregar(req, res);
  if (!l) return;
  if (l.status === 'pendente') flash(req, 'aviso', 'Este lançamento já está pendente.');
  else if (!podeLiberar(req)) flash(req, 'erro', 'Só a Contabilidade reabre lançamentos.');
  else {
    run("UPDATE lancamentos SET status = 'pendente', liberado_por = NULL, liberado_em = NULL, cancelado_motivo = NULL, atualizado_em = datetime('now','localtime') WHERE id = ?", l.id);
    auditar(req.user.id, 'reabriu', l.id, l.status === 'cancelado' ? 'estava cancelado' : 'estava liberado');
    flash(req, 'ok', 'Lançamento reaberto para conferência.');
  }
  res.redirect('/lancamentos/' + l.id);
});

module.exports = r;
