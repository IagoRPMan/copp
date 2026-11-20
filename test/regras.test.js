const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// Banco descartável: precisa estar definido antes de carregar o módulo do banco.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'copp-regras-'));
process.env.ADMIN_SENHA = 'senha-de-teste-123';
const app = require('../server');
const papercut = require('../src/papercut');
const { get, run } = require('../src/db');
const { dataValida } = require('../src/texto');
const auth = require('../src/auth');

const CAB = 'Data;Usuário;Nome completo;Conta cobrada;Nome da conta compartilhada;Nome da Impressora;Documento;Tipo de Uso;Total Páginas impressas;Total de páginas coloridas;Cópias;Custo;Duplo;Comentário;Impresso;Cancelado;Reembolsado';
const csv = (...ls) => Buffer.from([CAB, ...ls.map((o) => [o.data, o.usuario || 'ger1', 'Gerente Um', 'SHARED', o.conta || '076 - Cond. A', 'canon', o.doc, 'PRINT', o.pag, 0, 1, '"0,30"', 'N', o.com || '076 - BALANCETE', 'Y', 'N', 'NOT_REFUNDED'].join(';')), ''].join('\n'), 'utf8');
const importar = (arquivo, ...ls) => {
  const a = papercut.analisar(csv(...ls));
  return papercut.processar(a.trabalhos, { gravar: true, linhas: a.linhas, arquivo, hash: arquivo });
};

// Pessoas com perfil completo e sessão aberta, para conversar com o app de verdade.
const deptoDe = (funcao) => get('SELECT id FROM departamentos WHERE funcao = ? ORDER BY ordem LIMIT 1', funcao).id;
function pessoa(login, nome, funcao) {
  const u = get('SELECT id FROM usuarios WHERE login = ?', login);
  const id = u ? u.id : Number(run("INSERT INTO usuarios (login, nome, papel) VALUES (?, ?, 'responsavel')", login, nome).lastInsertRowid);
  run('UPDATE usuarios SET nome = ?, email = ?, departamento_id = ?, senha_hash = ?, trocar_senha = 0, recuperacao_hash = ? WHERE id = ?',
    nome, login + '@teste.com.br', deptoDe(funcao), auth.hashSenha('x'.repeat(10)), 'x', id);
  const token = crypto.randomBytes(32).toString('hex');
  const csrf = crypto.randomBytes(24).toString('hex');
  run('INSERT INTO sessoes (token, usuario_id, csrf, expira_em) VALUES (?, ?, ?, ?)', token, id, csrf, Date.now() + 3600e3);
  return { id, cookie: 'copp_sid=' + token, csrf };
}

let base;
let servidor;
test.before(async () => {
  servidor = app.listen(0, '127.0.0.1');
  await new Promise((ok) => servidor.once('listening', ok));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
test.after(() => servidor.close());

const pedir = (quem, caminho) => fetch(base + caminho, { headers: { cookie: quem.cookie }, redirect: 'manual' });
const enviar = (quem, caminho, campos) => fetch(base + caminho, {
  method: 'POST', redirect: 'manual',
  headers: { cookie: quem.cookie, 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ _csrf: quem.csrf, ...campos }).toString(),
});
const status = (id) => get('SELECT status FROM lancamentos WHERE id = ?', id).status;

test('data: recusa dias que não existem no calendário', () => {
  assert.equal(dataValida('2026-02-28'), true);
  assert.equal(dataValida('2024-02-29'), true);
  assert.equal(dataValida('2026-02-31'), false);
  assert.equal(dataValida('2025-02-29'), false);
  assert.equal(dataValida('2026-13-01'), false);
  assert.equal(dataValida('31/01/2026'), false);
});

test('quantidade que sobra: sem correção manual segue as páginas; com correção, desconta só o que sai', () => {
  assert.deepEqual(papercut.quantidadeRestante(10, 10, 4), { quantidade: 6, editado: false, restante: 6 });
  assert.deepEqual(papercut.quantidadeRestante(8, 10, 4), { quantidade: 4, editado: true, restante: 6 });
  // A correção deixou menos do que sai: volta para as páginas que continuam ligadas.
  assert.deepEqual(papercut.quantidadeRestante(3, 10, 4), { quantidade: 6, editado: true, restante: 6 });
});

test('desfazer uma importação mantém a correção manual da quantidade', () => {
  importar('a.csv', { data: '2026-11-03 10:00:00', pag: 10, doc: 'a.pdf', com: '076 - ATA' });
  importar('b.csv', { data: '2026-11-04 10:00:00', pag: 4, doc: 'b.pdf', com: '076 - ATA' });
  const l = get("SELECT id, quantidade FROM lancamentos WHERE descricao = 'ATA'");
  assert.equal(l.quantidade, 14);
  run('UPDATE lancamentos SET quantidade = 12, valor_centavos = 12 * preco_centavos WHERE id = ?', l.id);
  const b = get("SELECT id FROM importacoes WHERE arquivo = 'b.csv'");
  papercut.desfazer(b.id, null);
  assert.equal(get('SELECT quantidade FROM lancamentos WHERE id = ?', l.id).quantidade, 8);
});

test('só a Contabilidade libera; quem imprimiu acompanha sem aprovar', async () => {
  importar('c.csv', { data: '2026-11-05 10:00:00', pag: 3, doc: 'c.pdf', com: '076 - CIRCULAR' });
  const ger = pessoa('ger1', 'GERENTE UM', 'gerencia');
  const conta = pessoa('conta1', 'ANA CONTABIL', 'contabilidade');
  const l = get("SELECT id, responsavel_id FROM lancamentos WHERE descricao = 'CIRCULAR'");
  assert.equal(l.responsavel_id, ger.id);

  assert.equal((await pedir(ger, '/lancamentos/' + l.id)).status, 200, 'quem imprimiu consegue ver');
  await enviar(ger, '/lancamentos/lote', { acao: 'liberar', ids: String(l.id), ['d_' + l.id]: 'CIRCULAR', ['q_' + l.id]: '3' });
  assert.equal(status(l.id), 'pendente', 'quem imprimiu não libera');
  await enviar(ger, '/lancamentos/' + l.id + '/cancelar', { motivo: 'não quero' });
  assert.equal(status(l.id), 'pendente', 'nem cancela');

  await enviar(conta, '/lancamentos/lote', { acao: 'liberar', ids: String(l.id), ['d_' + l.id]: 'CIRCULAR', ['q_' + l.id]: '3' });
  assert.equal(status(l.id), 'liberado', 'a Contabilidade libera');
  await enviar(ger, '/lancamentos/' + l.id + '/reabrir', {});
  assert.equal(status(l.id), 'liberado', 'só a Contabilidade reabre');
});

test('lançamento manual: quem lançou corrige, mas não aprova o próprio', async () => {
  const ger = pessoa('ger1', 'GERENTE UM', 'gerencia');
  const conta = pessoa('conta1', 'ANA CONTABIL', 'contabilidade');
  const cond = get("SELECT id FROM condominios WHERE codigo = '0076'").id;
  const item = get("SELECT id FROM itens WHERE tipo = 'simples'").id;
  const form = { condominio_id: String(cond), item_id: String(item), data: '2026-11-10', descricao: 'Holerites', quantidade: '5', conta: '1732' };

  assert.equal((await enviar(ger, '/lancamentos/novo', { ...form, data: '2026-02-31' })).status, 400, 'data inexistente é recusada');
  assert.equal((await enviar(ger, '/lancamentos/novo', form)).status, 302);
  const l = get("SELECT id FROM lancamentos WHERE descricao = 'HOLERITES'");

  await enviar(ger, '/lancamentos/' + l.id, { ...form, quantidade: '6', acao: 'liberar' });
  const depois = get('SELECT status, quantidade FROM lancamentos WHERE id = ?', l.id);
  assert.deepEqual([depois.status, depois.quantidade], ['pendente', 6], 'corrigiu, mas continua pendente');

  await enviar(conta, '/lancamentos/' + l.id, { ...form, quantidade: '6', acao: 'liberar' });
  assert.equal(status(l.id), 'liberado');
  await enviar(ger, '/lancamentos/' + l.id, { ...form, quantidade: '1' });
  assert.equal(get('SELECT quantidade FROM lancamentos WHERE id = ?', l.id).quantidade, 6, 'liberado não muda mais');
});

test('saúde responde sem login', async () => {
  const r = await fetch(base + '/saude');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
});

test('tentativas de login vencidas são descartadas', () => {
  auth._tentativas.set('velha', { n: 3, inicio: Date.now() - 16 * 60 * 1000 });
  auth.registrarFalha('nova');
  assert.equal(auth._tentativas.has('velha'), false);
  assert.equal(auth._tentativas.get('nova').n, 1);
  auth.limparFalhas('nova');
});
