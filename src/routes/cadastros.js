const express = require('express');
const { all, get, run, tx } = require('../db');
const auth = require('../auth');
const { nomeMaiusculo, emailMinusculo, emailValido, descricaoPadrao, descricaoValida, centavosDeReais } = require('../texto');
const { usuariosAtivos, itensTodos, descricoesPadrao, departamentos, equipeDe, auditar, CONTAS, diaInicio, periodoDaRegra, competenciaDaRegra, aplicarRegraFechamento } = require('../dominio');

const r = express.Router();
const erroDe = (res, status, titulo, mensagem) => res.status(status).render('erro', { titulo, mensagem });

// ---- Condomínios
r.get('/condominios', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80);
  const t = '%' + q + '%';
  const lista = all(`SELECT c.*, u.nome AS resp_nome FROM condominios c LEFT JOIN usuarios u ON u.id = c.responsavel_id
                     WHERE c.codigo LIKE ? OR c.nome LIKE ? ORDER BY c.codigo`, t, t);
  res.render('condominios', { lista, q });
});

r.get('/condominios/:id', (req, res) => {
  const novo = req.params.id === 'novo';
  const c = novo ? { id: 0, codigo: '', nome: '', conta_papercut: '', responsavel_id: null, gera_lancamento: 1, ativo: 1 } : get('SELECT * FROM condominios WHERE id = ?', parseInt(req.params.id, 10) || 0);
  if (!c) return erroDe(res, 404, 'Condomínio não encontrado', 'Ele não existe mais.');
  res.render('condominio_form', { c, erro: null, responsaveis: usuariosAtivos() });
});

r.post('/condominios/:id', (req, res) => {
  const id = req.params.id === 'novo' ? 0 : parseInt(req.params.id, 10) || 0;
  const b = req.body;
  const c = {
    id, codigo: String(b.codigo || '').trim().slice(0, 40), nome: String(b.nome || '').trim().slice(0, 120),
    conta_papercut: String(b.conta_papercut || '').trim().slice(0, 160) || null,
    responsavel_id: parseInt(b.responsavel_id, 10) || null, gera_lancamento: b.gera_lancamento ? 1 : 0, ativo: b.ativo ? 1 : 0,
  };
  let erro = null;
  if (!c.codigo || !c.nome) erro = 'Preencha o código e o nome.';
  else if (get('SELECT 1 AS x FROM condominios WHERE codigo = ? AND id <> ?', c.codigo, id)) erro = 'Já existe um condomínio com este código.';
  else if (c.conta_papercut && get('SELECT 1 AS x FROM condominios WHERE conta_papercut = ? AND id <> ?', c.conta_papercut, id)) erro = 'Esta conta do PaperCut já está ligada a outro condomínio.';
  if (erro) return res.status(400).render('condominio_form', { c, erro, responsaveis: usuariosAtivos() });

  let movidos = 0;
  tx(() => {
    if (id) {
      const antes = get('SELECT responsavel_id FROM condominios WHERE id = ?', id);
      run('UPDATE condominios SET codigo = ?, nome = ?, conta_papercut = ?, responsavel_id = ?, gera_lancamento = ?, ativo = ? WHERE id = ?',
        c.codigo, c.nome, c.conta_papercut, c.responsavel_id, c.gera_lancamento, c.ativo, id);
      // O novo gerente assume o que estava pendente com o gerente anterior (trabalhos sem usuário identificado).
      // O que está na carteira de quem imprimiu continua com quem imprimiu.
      if (c.responsavel_id && antes && antes.responsavel_id !== c.responsavel_id) {
        movidos = Number(run("UPDATE lancamentos SET responsavel_id = ? WHERE condominio_id = ? AND status = 'pendente' AND (responsavel_id IS NULL OR responsavel_id = ?)",
          c.responsavel_id, id, antes.responsavel_id || 0).changes);
      }
    } else {
      run('INSERT INTO condominios (codigo, nome, conta_papercut, responsavel_id, gera_lancamento, ativo) VALUES (?,?,?,?,?,?)',
        c.codigo, c.nome, c.conta_papercut, c.responsavel_id, c.gera_lancamento, c.ativo);
    }
  });
  auditar(req.user.id, id ? 'alterou condomínio' : 'criou condomínio', null, `${c.codigo} ${c.nome}`);
  auth.flash(req, 'ok', 'Condomínio salvo.' + (movidos ? ` ${movidos} lançamento(s) pendente(s) passaram para o novo responsável.` : ''));
  res.redirect('/cadastros/condominios');
});

// ---- Itens e preços
r.get('/itens', (req, res) => {
  const usados = new Set(all('SELECT DISTINCT item_id FROM lancamentos').map((x) => x.item_id));
  res.render('itens', { itens: itensTodos().map((i) => ({ ...i, removivel: !i.tipo && !usados.has(i.id) })), contas: Object.values(CONTAS) });
});

// Preço de tabela: até R$ 99.999,99.
const precoEmCentavos = (texto) => centavosDeReais(texto, 9999999);

// Item novo. Na conta de cópias ele serve para lançamentos manuais: a importação do PaperCut
// continua usando só os três itens de origem (simples, colorida e dupla face).
r.post('/itens/novo', (req, res) => {
  const b = req.body;
  const conta = CONTAS[b.conta] ? String(b.conta) : null;
  const codigo = String(b.codigo || '').trim().replace(/^0+(?=\d)/, '');
  const descricao = String(b.descricao || '').trim().slice(0, 80);
  const livre = b.valor_livre ? 1 : 0;
  const preco = livre ? 0 : precoEmCentavos(b.preco);
  let erro = null;
  if (!conta) erro = 'Escolha a conta do item.';
  else if (!/^\d{1,4}$/.test(codigo)) erro = 'O código do item é um número de até 4 dígitos.';
  else if (!descricao) erro = 'Descreva o item.';
  else if (preco === null) erro = 'Informe o preço no formato 0,38, ou marque que o valor é informado em cada lançamento.';
  else if (get('SELECT 1 AS x FROM itens WHERE CAST(codigo AS INTEGER) = ?', parseInt(codigo, 10))) erro = `Já existe um item com o código ${codigo.padStart(4, '0')}.`;
  if (erro) auth.flash(req, 'erro', erro);
  else {
    run('INSERT INTO itens (codigo, descricao, conta, preco_centavos, ativo, valor_livre) VALUES (?,?,?,?,1,?)', codigo, descricao, conta, preco, livre);
    auditar(req.user.id, 'criou item', null, `${codigo.padStart(4, '0')} ${descricao} (conta ${conta})${livre ? ', valor informado no lançamento' : ': ' + preco / 100}`);
    auth.flash(req, 'ok', `Item ${codigo.padStart(4, '0')} criado.`);
  }
  res.redirect('/cadastros/itens');
});

r.post('/itens/:id', (req, res) => {
  const item = get('SELECT * FROM itens WHERE id = ?', parseInt(req.params.id, 10) || 0);
  if (!item) return erroDe(res, 404, 'Item não encontrado', 'Ele não existe mais.');
  if (req.body.acao === 'remover') {
    if (item.tipo) auth.flash(req, 'erro', 'Este item é usado pela importação do PaperCut e não pode ser removido.');
    else if (get('SELECT 1 AS x FROM lancamentos WHERE item_id = ? LIMIT 1', item.id)) auth.flash(req, 'erro', 'Há lançamentos com este item. Desative-o em vez de remover.');
    else {
      run('DELETE FROM itens WHERE id = ?', item.id);
      auditar(req.user.id, 'removeu item', null, `${item.codigo} ${item.descricao}`);
      auth.flash(req, 'ok', 'Item removido.');
    }
    return res.redirect('/cadastros/itens');
  }
  const centavos = item.valor_livre ? 0 : precoEmCentavos(req.body.preco);
  if (centavos === null) { auth.flash(req, 'erro', 'Informe o preço no formato 0,38.'); return res.redirect('/cadastros/itens'); }
  const descricao = String(req.body.descricao || '').trim().slice(0, 80) || item.descricao;
  // Cópia simples e colorida são a base da divisão das páginas e ficam sempre ativas; os demais itens podem ser desligados.
  const ativo = ['simples', 'colorida', 'duplex'].includes(item.tipo) ? 1 : (req.body.ativo ? 1 : 0);
  let recalculados = 0;
  tx(() => {
    run('UPDATE itens SET descricao = ?, preco_centavos = ?, ativo = ? WHERE id = ?', descricao, centavos, ativo, item.id);
    if (req.body.aplicar && centavos !== item.preco_centavos) {
      recalculados = Number(run("UPDATE lancamentos SET preco_centavos = ?, valor_centavos = quantidade * ?, atualizado_em = datetime('now','localtime') WHERE item_id = ? AND status = 'pendente'", centavos, centavos, item.id).changes);
    }
    if (centavos !== item.preco_centavos || ativo !== item.ativo) {
      auditar(req.user.id, 'alterou item', null, `${item.codigo} ${descricao}: preço ${item.preco_centavos / 100} → ${centavos / 100}${ativo !== item.ativo ? (ativo ? ', ativado' : ', desativado') : ''}${recalculados ? `; ${recalculados} pendentes recalculados` : ''}`);
    }
  });
  auth.flash(req, 'ok', recalculados
    ? `Item salvo e ${recalculados} lançamento(s) pendente(s) recalculados. Os já liberados mantêm o preço da época.`
    : 'Item salvo. O preço novo vale para as próximas importações; lançamentos existentes mantêm o preço da época.');
  res.redirect('/cadastros/itens');
});

// ---- Fechamento do mês
r.get('/fechamento', (req, res) => {
  const periodos = all(`SELECT p.*, COUNT(l.id) AS lancamentos, SUM(l.status = 'liberado') AS liberados, SUM(l.status = 'pendente') AS pendentes
                        FROM periodos p LEFT JOIN lancamentos l ON l.competencia = p.competencia AND l.status <> 'cancelado'
                        GROUP BY p.competencia ORDER BY p.competencia DESC`);
  res.render('fechamento', { dia: diaInicio(), periodos, exemplo: (d) => periodoDaRegra(competenciaDaRegra(new Date().toISOString().slice(0, 10), d), d) });
});

r.post('/fechamento', (req, res) => {
  const escolha = req.body.regra === 'outro' ? parseInt(req.body.dia, 10) : parseInt(req.body.regra, 10);
  if (!(escolha >= 1 && escolha <= 28)) {
    auth.flash(req, 'erro', 'Escolha um dia de início entre 1 e 28.');
    return res.redirect('/cadastros/fechamento');
  }
  const antes = diaInicio();
  const r2 = tx(() => aplicarRegraFechamento(escolha));
  const nome = (d) => (d === 1 ? 'mês do calendário' : `do dia ${d} ao dia ${d - 1}`);
  auditar(req.user.id, 'mudou o fechamento', null, `${nome(antes)} → ${nome(escolha)}; ${r2.periodos} período(s) refeitos, ${r2.lancamentos} lançamento(s) mudaram de competência`);
  auth.flash(req, 'ok', `Fechamento agora é ${nome(escolha)}. ${r2.periodos ? `${r2.periodos} período(s) ainda sem liberação foram refeitos e ${r2.lancamentos} lançamento(s) mudaram de competência.` : 'Nenhum período em aberto precisou mudar.'} Meses com lançamentos liberados mantêm as datas.`);
  res.redirect('/cadastros/fechamento');
});

// ---- Usuários
r.get('/usuarios', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80);
  const depto = parseInt(req.query.departamento, 10) || 0;
  const t = '%' + q + '%';
  const lista = all(`SELECT u.id, u.login, u.nome, u.email, u.papel, u.ativo, u.matricula, u.senha_hash IS NOT NULL AS tem_senha, d.nome AS depto, s.nome AS superior,
                            (SELECT COUNT(*) FROM condominios c WHERE c.responsavel_id = u.id) AS condominios,
                            (SELECT MIN(p.criado_em) FROM pedidos_senha p WHERE p.usuario_id = u.id AND p.atendido_em IS NULL) AS pediu_senha
                     FROM usuarios u LEFT JOIN departamentos d ON d.id = u.departamento_id LEFT JOIN usuarios s ON s.id = u.superior_id
                     WHERE (u.nome LIKE ? OR u.login LIKE ?) AND (? = 0 OR u.departamento_id = ?)
                     ORDER BY u.ativo DESC, d.ordem, u.nome COLLATE NOCASE`, t, t, depto, depto);
  const pedidos = all(`SELECT u.id, u.nome, u.login, p.criado_em FROM pedidos_senha p JOIN usuarios u ON u.id = p.usuario_id
                        WHERE p.atendido_em IS NULL AND u.ativo = 1 ORDER BY p.criado_em`);
  res.render('usuarios', { lista, q, depto, departamentos: departamentos(), pedidos });
});

r.get('/usuarios/:id', (req, res) => {
  const novo = req.params.id === 'novo';
  const u = novo ? { id: 0, login: '', nome: '', papel: 'responsavel', ativo: 1, tem_senha: 0, departamento_id: null, superior_id: null, matricula: '' }
    : get(`SELECT id, login, nome, email, papel, ativo, departamento_id, superior_id, matricula, senha_hash IS NOT NULL AS tem_senha, ultimo_acesso,
                  (SELECT MIN(criado_em) FROM pedidos_senha p WHERE p.usuario_id = usuarios.id AND p.atendido_em IS NULL) AS pediu_senha
           FROM usuarios WHERE id = ?`, parseInt(req.params.id, 10) || 0);
  if (!u) return erroDe(res, 404, 'Usuário não encontrado', 'Ele não existe mais.');
  res.render('usuario_form', { u, erro: null, senhaGerada: null, ...listasUsuario(u.id) });
});

r.post('/usuarios/:id', (req, res) => {
  const id = req.params.id === 'novo' ? 0 : parseInt(req.params.id, 10) || 0;
  const b = req.body;
  const u = {
    id, login: String(b.login || '').trim().slice(0, 60), nome: nomeMaiusculo(b.nome).slice(0, 120), email: emailMinusculo(b.email) || null,
    papel: b.papel === 'admin' ? 'admin' : 'responsavel', ativo: b.ativo ? 1 : 0, tem_senha: 0,
    departamento_id: parseInt(b.departamento_id, 10) || null, superior_id: parseInt(b.superior_id, 10) || null, matricula: String(b.matricula || '').trim().slice(0, 20) || null,
  };
  const atual = id ? get('SELECT id, papel, ativo, senha_hash FROM usuarios WHERE id = ?', id) : null;
  if (id && !atual) return erroDe(res, 404, 'Usuário não encontrado', 'Ele não existe mais.');
  if (atual) u.tem_senha = atual.senha_hash ? 1 : 0;

  let erro = null;
  if (!/^[A-Za-z0-9._@-]{2,60}$/.test(u.login)) erro = 'O login aceita letras, números, ponto, hífen e sublinhado.';
  else if (!u.nome) erro = 'Preencha o nome.';
  else if (u.email && !emailValido(u.email)) erro = 'E-mail inválido.';
  else if (get('SELECT 1 AS x FROM usuarios WHERE login = ? AND id <> ?', u.login, id)) erro = 'Já existe um usuário com este login.';
  else if (atual && atual.papel === 'admin' && (u.papel !== 'admin' || !u.ativo) &&
           !get("SELECT 1 AS x FROM usuarios WHERE papel = 'admin' AND ativo = 1 AND senha_hash IS NOT NULL AND id <> ?", id)) {
    erro = 'Este é o único administrador com acesso. Promova outro antes de mudar este.';
  } else if (u.departamento_id && !get('SELECT 1 AS x FROM departamentos WHERE id = ?', u.departamento_id)) erro = 'Departamento inválido.';
  else if (u.superior_id && (!get('SELECT 1 AS x FROM usuarios WHERE id = ?', u.superior_id) || (id && equipeDe(id).includes(u.superior_id)))) {
    erro = 'O superior não pode ser a própria pessoa nem alguém que responde a ela.';
  }
  if (erro) return res.status(400).render('usuario_form', { u, erro, senhaGerada: null, ...listasUsuario(id) });

  let senhaGerada = null;
  const gerar = b.acao === 'senha' || !id;
  tx(() => {
    if (id) run('UPDATE usuarios SET login = ?, nome = ?, email = ?, papel = ?, ativo = ?, departamento_id = ?, superior_id = ?, matricula = ? WHERE id = ?', u.login, u.nome, u.email, u.papel, u.ativo, u.departamento_id, u.superior_id, u.matricula, id);
    else u.id = Number(run('INSERT INTO usuarios (login, nome, email, papel, ativo, departamento_id, superior_id, matricula) VALUES (?,?,?,?,?,?,?,?)', u.login, u.nome, u.email, u.papel, u.ativo, u.departamento_id, u.superior_id, u.matricula).lastInsertRowid);
    if (gerar) {
      senhaGerada = auth.senhaTemporaria();
      run('UPDATE usuarios SET senha_hash = ?, trocar_senha = 1 WHERE id = ?', auth.hashSenha(senhaGerada), u.id);
      run("UPDATE pedidos_senha SET atendido_em = datetime('now','localtime'), atendido_por = ? WHERE usuario_id = ? AND atendido_em IS NULL", req.user.id, u.id);
      u.tem_senha = 1;
    }
    if (!u.ativo || gerar) auth.encerrarSessoesDe(u.id, u.id === req.user.id ? req.sessao.token : '');
  });
  auditar(req.user.id, id ? 'alterou usuário' : 'criou usuário', null, `${u.login} (${u.papel})${gerar ? ', senha temporária gerada' : ''}${u.ativo ? '' : ', inativo'}`);
  // A senha temporária aparece uma única vez, nesta resposta, e não fica guardada em texto.
  if (senhaGerada) return res.render('usuario_form', { u, erro: null, senhaGerada, ...listasUsuario(u.id) });
  auth.flash(req, 'ok', 'Usuário salvo.');
  res.redirect('/cadastros/usuarios');
});

function listasUsuario(id) {
  const equipe = id ? equipeDe(id) : [];
  return { departamentos: departamentos(), superiores: usuariosAtivos().filter((p) => !equipe.includes(p.id)) };
}

// ---- Departamentos
const FUNCOES = ['comum', 'gerencia', 'contabilidade', 'diretoria'];
r.get('/departamentos', (req, res) => res.render('departamentos', { lista: departamentos(), funcoes: FUNCOES }));

r.post('/departamentos/:id', (req, res) => {
  const novo = req.params.id === 'novo';
  const id = novo ? 0 : parseInt(req.params.id, 10) || 0;
  const nome = String(req.body.nome || '').trim().slice(0, 60);
  const funcao = FUNCOES.includes(req.body.funcao) ? req.body.funcao : 'comum';
  const conducao = req.body.lanca_conducao ? 1 : 0;
  if (req.body.acao === 'remover' && id) {
    if (get('SELECT 1 AS x FROM usuarios WHERE departamento_id = ?', id)) auth.flash(req, 'erro', 'Há usuários neste departamento. Mova-os antes de remover.');
    else { run('DELETE FROM departamentos WHERE id = ?', id); auth.flash(req, 'ok', 'Departamento removido.'); }
  } else if (!nome) auth.flash(req, 'erro', 'Dê um nome ao departamento.');
  else if (get('SELECT 1 AS x FROM departamentos WHERE nome = ? AND id <> ?', nome, id)) auth.flash(req, 'erro', 'Já existe um departamento com este nome.');
  else {
    if (novo) run('INSERT INTO departamentos (nome, funcao, lanca_conducao, ordem) VALUES (?,?,?,(SELECT COALESCE(MAX(ordem), 0) + 1 FROM departamentos))', nome, funcao, conducao);
    else run('UPDATE departamentos SET nome = ?, funcao = ?, lanca_conducao = ? WHERE id = ?', nome, funcao, conducao, id);
    auditar(req.user.id, novo ? 'criou departamento' : 'alterou departamento', null, `${nome} (${funcao}${conducao ? ', lança condução' : ''})`);
    auth.flash(req, 'ok', 'Departamento salvo.');
  }
  res.redirect('/cadastros/departamentos');
});

// ---- Descrições padrão
r.get('/descricoes', (req, res) => res.render('descricoes', { lista: descricoesPadrao() }));

r.post('/descricoes', (req, res) => {
  const texto = descricaoPadrao(req.body.texto);
  if (!descricaoValida(texto)) auth.flash(req, 'erro', 'Escreva a descrição (pelo menos 3 letras).');
  else if (get('SELECT 1 AS x FROM descricoes WHERE texto = ?', texto)) auth.flash(req, 'aviso', 'Esta descrição já está na lista.');
  else { run('INSERT INTO descricoes (texto) VALUES (?)', texto); auth.flash(req, 'ok', 'Descrição incluída.'); }
  res.redirect('/cadastros/descricoes');
});

r.post('/descricoes/:id', (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const atual = get('SELECT texto FROM descricoes WHERE id = ?', id);
  const texto = descricaoPadrao(req.body.texto);
  if (!atual) auth.flash(req, 'erro', 'Esta descrição não existe mais.');
  else if (!descricaoValida(texto)) auth.flash(req, 'erro', 'A descrição precisa de pelo menos 3 letras. Para tirá-la da lista, use Remover.');
  else if (texto === atual.texto) auth.flash(req, 'aviso', 'Nada foi alterado.');
  else if (get('SELECT 1 AS x FROM descricoes WHERE texto = ? AND id <> ?', texto, id)) auth.flash(req, 'erro', `"${texto}" já está na lista.`);
  else {
    run('UPDATE descricoes SET texto = ? WHERE id = ?', texto, id);
    auditar(req.user.id, 'alterou descrição padrão', null, `"${atual.texto}" → "${texto}"`);
    auth.flash(req, 'ok', 'Descrição alterada. Lançamentos que já usam o texto antigo não mudam.');
  }
  res.redirect('/cadastros/descricoes');
});

r.post('/descricoes/:id/remover', (req, res) => {
  run('DELETE FROM descricoes WHERE id = ?', parseInt(req.params.id, 10) || 0);
  auth.flash(req, 'ok', 'Descrição removida da lista de sugestões. Lançamentos que já a usam não mudam.');
  res.redirect('/cadastros/descricoes');
});

// ---- Auditoria
r.get('/auditoria', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80);
  const t = '%' + q + '%';
  const lista = all(`SELECT a.*, u.nome AS usuario_nome FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
                     WHERE a.acao LIKE ? OR a.detalhe LIKE ? OR u.nome LIKE ? OR CAST(a.lancamento_id AS TEXT) = ?
                     ORDER BY a.id DESC LIMIT 500`, t, t, t, q);
  res.render('auditoria', { lista, q });
});

module.exports = r;
