const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Banco descartável: precisa estar definido antes de carregar o módulo do banco.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'copp-teste-'));
const papercut = require('../src/papercut');
const { all, get, run } = require('../src/db');

const CAB = 'Data;Usuário;Nome completo;Conta cobrada;Nome da conta compartilhada;Nome da Impressora;Documento;Tipo de Uso;Total Páginas impressas;Total de páginas coloridas;Cópias;Custo;Duplo;Comentário;Impresso;Cancelado;Reembolsado;Paginas Duplex;Paginas Simplex';
const linha = (o) => [o.data, o.usuario || 'ger1', 'Pessoa Um', 'SHARED', 'conta' in o ? o.conta : '076 - Cond. A', o.imp || 'canon', o.doc || 'doc.pdf', 'PRINT',
  o.pag, o.cor || 0, 1, '"0,30"', 'N', o.com || '', o.impresso || 'Y', o.cancelado || 'N', 'NOT_REFUNDED', o.duplex || 0, 0].join(';');
const csv = (...ls) => Buffer.from(['# Relatório de uso de impressão', '"# Data mínima = 31/out/2026"', CAB, ...ls.map(linha), ''].join('\n'), 'utf8');

test('lê o cabeçalho depois dos comentários e filtra o que não foi impresso', () => {
  const a = papercut.analisar(csv(
    { data: '2026-11-04 17:15:10', pag: 5, com: '076 - MATERIAL ASSEMBLEIA' },
    { data: '2026-11-04 17:16:00', pag: 3, cancelado: 'Y' },
    { data: '2026-11-04 17:17:00', pag: 2, impresso: 'N' },
    { data: '2026-11-04 17:18:00', pag: 2, conta: '' },
  ));
  assert.equal(a.linhas, 4);
  assert.equal(a.trabalhos.length, 1);
  assert.equal(a.trabalhos[0].paginas, 5);
  assert.deepEqual(a.ignorados.map((i) => i.motivo).sort(), ['Cancelado', 'Não impresso', 'Sem conta compartilhada (conta pessoal)']);
});

test('aceita o export com nomes de coluna de Portugal (Utilizador, Conta Partilhada, Páginas a Cores)', () => {
  const cab = 'Data;Utilizador;Nome Completo;Conta Debitada;Nome da Conta Partilhada;Nome da Impressora;Documento;Tipo de Uso;Total de Páginas;Total Páginas a Cores;Cópias;Custo;Duplex;Comentário;Impresso;Cancelado;Reembolsado;Páginas Duplex;Páginas Simples';
  const texto = ['# Relatório de uso de impressão para gerente16', '"# Data mínima = 16/out/2026, Data máxima = 15/nov/2026"', cab,
    '2026-11-13 16:37:48;gerente16;Iago R. Prado Man;SHARED;076 - B. B. Boulogne;konica;multa.pdf;PRINT;2;1;1;"0,60";N;076;Y;N;NOT_REFUNDED;0;2',
    '2026-11-12 14:33:39;gerente16;Iago R. Prado Man;SHARED;033 - Prop;canon;fatura.pdf;PRINT;6;0;1;"1,80";Y;033;Y;N;NOT_REFUNDED;6;0', ''].join('\r\n');
  const a = papercut.analisar(Buffer.from(texto, 'utf8'));
  assert.equal(a.erro, undefined);
  assert.equal(a.trabalhos.length, 2);
  assert.deepEqual(a.trabalhos.map((t) => [t.usuario, t.nome, t.conta, t.paginas, t.coloridas, t.duplex]), [
    ['gerente16', 'Iago R. Prado Man', '076 - B. B. Boulogne', 2, 1, 0],
    ['gerente16', 'Iago R. Prado Man', '033 - Prop', 6, 0, 6],
  ]);
});

test('log por impressora: sem a coluna de páginas duplex, usa a marca Duplo (Y = todas as páginas em frente e verso)', () => {
  const cab = 'Data;Usuário;Nome completo;Conta cobrada;Nome da conta compartilhada;Nome da Impressora;Documento;Tipo de Uso;Total Páginas impressas;Total de páginas coloridas;Cópias;Custo;Duplo;Comentário;Impresso;Cancelado;Reembolsado';
  const texto = ['# Uso de Impressora - logs', cab,
    '2026-10-16 10:01:37;assistente09;;SHARED;328 - GIOIA;canon;a.pdf;PRINT;4;0;1;"1,20";Y;notificaçao;Y;N;NOT_REFUNDED',
    '2026-10-16 10:02:00;assistente09;;SHARED;328 - GIOIA;canon;b.pdf;PRINT;3;1;1;"0,90";N;;Y;N;NOT_REFUNDED', ''].join('\n');
  const a = papercut.analisar(Buffer.from(texto, 'utf8'));
  assert.equal(a.erro, undefined);
  assert.deepEqual(a.trabalhos.map((t) => [t.paginas, t.coloridas, t.duplex]), [[4, 0, 4], [3, 1, 0]]);
});

test('recusa arquivo que não é o export do PaperCut', () => {
  assert.match(papercut.analisar(Buffer.from('a;b;c\n1;2;3\n')).erro, /Colunas ausentes/);
  assert.match(papercut.analisar(Buffer.from('')).erro, /vazio/);
});

test('reimpressões idênticas no mesmo segundo recebem chaves diferentes e estáveis', () => {
  const arq = csv({ data: '2026-11-13 16:37:48', pag: 2 }, { data: '2026-11-13 16:37:48', pag: 2 });
  const a = papercut.analisar(arq);
  const b = papercut.analisar(arq);
  assert.notEqual(a.trabalhos[0].chave, a.trabalhos[1].chave);
  assert.deepEqual(a.trabalhos.map((t) => t.chave), b.trabalhos.map((t) => t.chave));
});

test('comentário: tira o código e alerta quando aponta para outro condomínio', () => {
  assert.deepEqual(papercut.lerComentario('076 - MATERIAL ASSEMBLEIA', 76), { descricao: 'MATERIAL ASSEMBLEIA', alerta: null });
  assert.deepEqual(papercut.lerComentario('76', 76), { descricao: papercut.DESCRICAO_PADRAO, alerta: null });
  assert.match(papercut.lerComentario('033', 1).alerta, /033/);
  assert.deepEqual(papercut.lerComentario('2 vias do contrato.', 76), { descricao: '2 VIAS DO CONTRATO', alerta: null });
  assert.deepEqual(papercut.lerComentario('.', 76), { descricao: papercut.DESCRICAO_PADRAO, alerta: null });
  assert.deepEqual(papercut.lerComentario('076 - doc', 76), { descricao: 'DOC', alerta: null });
  assert.deepEqual(papercut.lerComentario('', 76), { descricao: papercut.DESCRICAO_PADRAO, alerta: null });
});

test('divide páginas em simples, coloridas e dupla face', () => {
  const t = { paginas: 10, coloridas: 2, duplex: 6 };
  assert.deepEqual(papercut.dividirPaginas(t, false), { simples: 8, colorida: 2, duplex: 0 });
  assert.deepEqual(papercut.dividirPaginas(t, true), { simples: 2, colorida: 2, duplex: 6 });
});

test('importa, agrupa por condomínio × item × descrição e não duplica ao reimportar', () => {
  const arq = csv(
    { data: '2026-11-04 17:15:10', pag: 5, com: '076 - MATERIAL ASSEMBLEIA' },
    { data: '2026-11-04 17:16:05', pag: 90, com: '076 - MATERIAL ASSEMBLEIA', doc: 'b.pdf' },
    { data: '2026-11-13 16:37:48', pag: 2, cor: 1, com: '076', doc: 'c.pdf' },
    { data: '2026-11-06 13:48:09', pag: 1, com: '033', conta: '001 - Cond. B', doc: 'd.pdf' },
  );
  const a = papercut.analisar(arq);
  const previa = papercut.processar(a.trabalhos, { linhas: a.linhas });
  assert.equal(previa.novos, 4);
  assert.equal(get('SELECT COUNT(*) AS n FROM lancamentos').n, 0, 'a prévia não grava');

  const r = papercut.processar(a.trabalhos, { gravar: true, linhas: a.linhas, arquivo: 't.csv', hash: 'x' });
  assert.equal(r.lancamentos, 4);
  const lancs = all(`SELECT c.codigo, i.tipo, l.descricao, l.quantidade, l.valor_centavos, l.alerta, l.competencia, l.status
                     FROM lancamentos l JOIN condominios c ON c.id = l.condominio_id JOIN itens i ON i.id = l.item_id ORDER BY c.codigo, i.tipo, l.descricao`);
  assert.deepEqual(lancs.map((l) => [l.codigo, l.tipo, l.descricao, l.quantidade, l.valor_centavos]), [
    ['0001', 'simples', papercut.DESCRICAO_PADRAO, 1, 38],
    ['0076', 'colorida', papercut.DESCRICAO_PADRAO, 1, 135],
    ['0076', 'simples', papercut.DESCRICAO_PADRAO, 1, 38],
    ['0076', 'simples', 'MATERIAL ASSEMBLEIA', 95, 3610],
  ]);
  assert.ok(lancs.every((l) => l.status === 'pendente' && l.competencia === '2026-11'));
  assert.match(lancs[0].alerta, /033/);
  assert.equal(get('SELECT COUNT(*) AS n FROM usuarios WHERE login = ?', 'ger1').n, 1);

  const de_novo = papercut.processar(papercut.analisar(arq).trabalhos, { gravar: true, linhas: 4 });
  assert.equal(de_novo.novos, 0);
  assert.equal(de_novo.duplicados, 4);
  assert.equal(get('SELECT COUNT(*) AS n FROM lancamentos').n, 4);
});

test('conta marcada para não gerar lançamento só guarda os trabalhos', () => {
  run("INSERT INTO condominios (codigo, nome, conta_papercut, gera_lancamento) VALUES ('0033', 'Interna', '033 - Interna', 0)");
  const a = papercut.analisar(csv({ data: '2026-11-09 16:04:42', pag: 11, conta: '033 - Interna', doc: 'e.pdf' }));
  const antes = get('SELECT COUNT(*) AS n FROM lancamentos').n;
  const r = papercut.processar(a.trabalhos, { gravar: true, linhas: 1 });
  assert.equal(r.semLancamento, 1);
  assert.equal(get('SELECT COUNT(*) AS n FROM lancamentos').n, antes);
  assert.equal(get("SELECT COUNT(*) AS n FROM trabalhos WHERE conta = '033 - Interna'").n, 1);
});
