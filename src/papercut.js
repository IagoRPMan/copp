const crypto = require('crypto');
const { parse } = require('csv-parse/sync');
const { db, all, get, run, tx } = require('./db');
const { auditar, competenciaDe, reajustarPeriodosAbertos } = require('./dominio');
const { nomeMaiusculo, descricaoPadrao, descricaoValida } = require('./texto');

const DESCRICAO_PADRAO = 'CÓPIAS E IMPRESSÕES';
// O PaperCut muda o nome das colunas conforme o idioma da instalação (português do Brasil, de Portugal, inglês).
// Cada coluna usada aqui aceita todos esses nomes; acento, maiúscula e dois-pontos no fim não importam.
const COLUNAS = {
  data: { nome: 'Data', apelidos: ['data', 'date'] },
  usuario: { nome: 'Usuário', apelidos: ['usuario', 'utilizador', 'user', 'username'] },
  nome: { nome: 'Nome completo', apelidos: ['nome completo', 'full name'] },
  conta: { nome: 'Nome da conta compartilhada', apelidos: ['nome da conta compartilhada', 'nome da conta partilhada', 'shared account name', 'shared account'] },
  impressora: { nome: 'Nome da Impressora', apelidos: ['nome da impressora', 'printer name', 'printer'] },
  documento: { nome: 'Documento', apelidos: ['documento', 'document name', 'document'] },
  paginas: { nome: 'Total de páginas', apelidos: ['total paginas impressas', 'total de paginas', 'total de paginas impressas', 'total printed pages', 'total pages', 'pages'] },
  coloridas: { nome: 'Páginas coloridas', apelidos: ['total de paginas coloridas', 'total paginas a cores', 'total de paginas a cores', 'total color pages', 'color pages'] },
  duplex: { nome: 'Páginas duplex', apelidos: ['paginas duplex', 'duplex pages'] },
  // Marca Y/N de trabalho frente e verso. O relatório "Log de impressão" por impressora traz só ela, sem a contagem de páginas duplex.
  duplo: { nome: 'Duplo', apelidos: ['duplo', 'duplex'] },
  comentario: { nome: 'Comentário', apelidos: ['comentario', 'comment'] },
  impresso: { nome: 'Impresso', apelidos: ['impresso', 'printed'] },
  cancelado: { nome: 'Cancelado', apelidos: ['cancelado', 'cancelled', 'canceled'] },
  reembolsado: { nome: 'Reembolsado', apelidos: ['reembolsado', 'refunded'] },
};
const OBRIGATORIAS = ['data', 'usuario', 'conta', 'paginas', 'coloridas', 'documento'];
const normalizarColuna = (h) => String(h).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[:\s]+$/, '').replace(/\s+/g, ' ').trim();
const PELO_APELIDO = new Map(Object.entries(COLUNAS).flatMap(([chave, c]) => c.apelidos.map((a) => [a, chave])));
// Cabeçalho do CSV → chave interna; colunas que o sistema não usa ficam com o nome original.
const lerCabecalho = (cabecalho) => {
  const vistas = new Set();
  return cabecalho.map((h) => {
    const chave = PELO_APELIDO.get(normalizarColuna(h));
    if (!chave || vistas.has(chave)) return String(h).trim();
    vistas.add(chave);
    return chave;
  });
};

const inteiro = (v) => {
  const n = parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Lê o CSV de "registro de trabalhos de impressão" do PaperCut.
 * Devolve os trabalhos aproveitáveis e os ignorados, com o motivo.
 */
function analisar(buffer) {
  let texto = buffer.toString('utf8');
  if (texto.includes('�')) texto = buffer.toString('latin1');
  texto = texto.replace(/^﻿/, '');

  // O PaperCut abre o arquivo com linhas de comentário ("# Relatório de uso...").
  const linhas = texto.split(/\r?\n/);
  let inicio = 0;
  while (inicio < linhas.length && (/^\s*"?#/.test(linhas[inicio]) || linhas[inicio].trim() === '')) inicio++;
  const corpo = linhas.slice(inicio).join('\n');
  if (!corpo.trim()) return { erro: 'O arquivo está vazio.' };

  let registros;
  try {
    registros = parse(corpo, { delimiter: ';', columns: lerCabecalho, skip_empty_lines: true, relax_quotes: true, relax_column_count: true, trim: true });
  } catch (e) {
    return { erro: 'Não foi possível ler o arquivo como CSV do PaperCut (' + e.message + ').' };
  }
  if (!registros.length) return { erro: 'O arquivo não tem nenhum trabalho de impressão.' };

  const faltando = OBRIGATORIAS.filter((c) => !(c in registros[0]));
  if (faltando.length) {
    return { erro: 'Este não parece ser o export de trabalhos de impressão do PaperCut. Colunas ausentes: ' + faltando.map((c) => COLUNAS[c].nome).join(', ') + '.' };
  }

  const trabalhos = [];
  const ignorados = new Map();
  const ignorar = (motivo) => ignorados.set(motivo, (ignorados.get(motivo) || 0) + 1);
  const ocorrencias = new Map();

  for (const r of registros) {
    const dataHora = String(r.data || '');
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(dataHora)) { ignorar('Data inválida'); continue; }
    if ('impresso' in r && r.impresso !== 'Y') { ignorar('Não impresso'); continue; }
    if (r.cancelado === 'Y') { ignorar('Cancelado'); continue; }
    if ('reembolsado' in r && r.reembolsado && r.reembolsado !== 'NOT_REFUNDED') { ignorar('Reembolsado'); continue; }
    const conta = String(r.conta || '').trim();
    if (!conta) { ignorar('Sem conta compartilhada (conta pessoal)'); continue; }
    const paginas = inteiro(r.paginas);
    if (!paginas) { ignorar('Sem páginas'); continue; }

    const t = {
      dataHora,
      usuario: String(r.usuario || '').trim(),
      nome: String(r.nome || '').trim(),
      conta,
      impressora: String(r.impressora || '').trim(),
      documento: String(r.documento || '').trim().slice(0, 300),
      paginas,
      coloridas: Math.min(inteiro(r.coloridas), paginas),
      duplex: 'duplex' in r ? Math.min(inteiro(r.duplex), paginas) : r.duplo === 'Y' ? paginas : 0,
      comentario: String(r.comentario || '').trim().slice(0, 300),
    };
    // O export não traz identificador do trabalho. A chave junta os campos estáveis e a
    // ordem de aparição, para que reimpressões idênticas no mesmo segundo não se anulem.
    const base = [t.dataHora, t.usuario, t.impressora, t.documento, t.paginas].join('|');
    const n = (ocorrencias.get(base) || 0) + 1;
    ocorrencias.set(base, n);
    t.chave = crypto.createHash('sha1').update(base + '#' + n).digest('hex');
    trabalhos.push(t);
  }

  return { linhas: registros.length, trabalhos, ignorados: [...ignorados].map(([motivo, quantidade]) => ({ motivo, quantidade })) };
}

/** "076 - B. B. Boulogne" → { numero: 76, codigo: "0076", nome: "B. B. Boulogne" } */
function lerConta(conta) {
  const m = /^\s*(\d{1,6})\s*-\s*(.+)$/.exec(conta);
  if (!m) return { numero: null, codigo: conta.slice(0, 40), nome: conta };
  return { numero: parseInt(m[1], 10), codigo: m[1].padStart(4, '0'), nome: m[2].trim() };
}

/**
 * O comentário do PaperCut é texto livre: "076 - MATERIAL ASSEMBLEIA", "76", "033".
 * Tira o código do começo e avisa quando ele aponta para outro condomínio.
 */
function lerComentario(comentario, numeroConta) {
  let descricao = (comentario || '').trim();
  let alerta = null;
  const m = /^(\d{1,4})\s*(?:$|-\s*(.*)$)/.exec(descricao);
  if (m) {
    descricao = (m[2] || '').trim();
    if (numeroConta !== null && parseInt(m[1], 10) !== numeroConta) {
      alerta = `O comentário no PaperCut cita o código ${m[1].padStart(3, '0')}, diferente da conta cobrada.`;
    }
  }
  // Comentário sem letras suficientes (".", "1", vazio) vira a descrição padrão.
  descricao = descricaoPadrao(descricao);
  return { descricao: descricaoValida(descricao) ? descricao : DESCRICAO_PADRAO, alerta };
}

function dividirPaginas(t, duplexAtivo) {
  const colorida = t.coloridas;
  const resto = t.paginas - colorida;
  const duplex = duplexAtivo ? Math.min(t.duplex, resto) : 0;
  return { simples: resto - duplex, colorida, duplex };
}

/**
 * Monta os lançamentos a partir dos trabalhos. Com gravar = false devolve só a prévia.
 * Um lançamento = condomínio × item × descrição × responsável, dentro da competência.
 */
function processar(trabalhos, opcoes = {}) {
  if (opcoes.gravar) return montar(trabalhos, opcoes);
  // A prévia pode precisar criar períodos de fechamento novos; nada disso fica gravado.
  db.exec('BEGIN');
  try { return montar(trabalhos, opcoes); } finally { db.exec('ROLLBACK'); }
}

function montar(trabalhos, { gravar = false, usuarioId = null, arquivo = '', hash = '', linhas = 0, ignorados = 0 } = {}) {
  const itens = {};
  for (const i of all('SELECT * FROM itens WHERE tipo IS NOT NULL')) itens[i.tipo] = i;
  const duplexAtivo = !!(itens.duplex && itens.duplex.ativo);

  const condPorConta = new Map(all('SELECT * FROM condominios WHERE conta_papercut IS NOT NULL').map((c) => [c.conta_papercut, c]));
  // Condomínio já cadastrado mas ainda sem conta do PaperCut: casa pelo código ("076 - ..." → 0076).
  const semConta = new Map(all('SELECT * FROM condominios WHERE conta_papercut IS NULL').map((c) => [c.codigo, c]));
  const vinculos = new Map();
  const acharCond = (nomeConta) => {
    let c = condPorConta.get(nomeConta);
    if (!c) {
      const lida = lerConta(nomeConta);
      c = lida.numero !== null ? semConta.get(lida.codigo) : null;
      if (c) { condPorConta.set(nomeConta, c); semConta.delete(lida.codigo); vinculos.set(nomeConta, c); }
    }
    return c;
  };
  const usuarios = new Map(all('SELECT id, login FROM usuarios').map((u) => [u.login.toLowerCase(), u.id]));
  const nomes = new Map(all('SELECT id, nome FROM usuarios').map((u) => [u.id, u.nome]));
  const porCarteira = new Map();

  const novos = [];
  let duplicados = 0;
  for (const t of trabalhos) {
    if (get('SELECT 1 AS x FROM trabalhos WHERE chave = ?', t.chave)) duplicados++;
    else novos.push(t);
  }

  const contasNovas = new Map();
  const usuariosNovos = new Map();
  const grupos = new Map();
  const porConta = new Map();
  const competencias = new Set();
  let semLancamento = 0;

  for (const t of novos) {
    const cond = acharCond(t.conta);
    const conta = lerConta(t.conta);
    if (!cond) contasNovas.set(t.conta, conta);
    const gera = cond ? !!cond.gera_lancamento : true;
    const partes = dividirPaginas(t, duplexAtivo);

    let r = porConta.get(t.conta);
    if (!r) { r = { conta: t.conta, nova: !cond, condominio: cond ? `${cond.codigo} · ${cond.nome}` : null, gera, trabalhos: 0, simples: 0, colorida: 0, duplex: 0, valor: 0 }; porConta.set(t.conta, r); }
    r.trabalhos++;
    if (!gera) { semLancamento++; continue; }

    // Cada um confere o que imprimiu: o lançamento vai para a carteira do usuário do PaperCut.
    // Trabalho sem usuário identificado fica com o gerente do prédio.
    let resp = null;
    if (t.usuario) {
      resp = 'login:' + t.usuario.toLowerCase();
      if (!usuarios.has(t.usuario.toLowerCase())) usuariosNovos.set(t.usuario.toLowerCase(), { login: t.usuario, nome: t.nome || t.usuario });
    } else if (cond && cond.responsavel_id) resp = 'id:' + cond.responsavel_id;

    const competencia = competenciaDe(t.dataHora);
    competencias.add(competencia);
    const { descricao, alerta } = lerComentario(t.comentario, conta.numero);

    for (const tipo of ['simples', 'colorida', 'duplex']) {
      const q = partes[tipo];
      if (!q) continue;
      r[tipo] += q;
      r.valor += q * itens[tipo].preco_centavos;
      const dono = resp && resp.startsWith('id:') ? nomes.get(Number(resp.slice(3))) : (resp ? (nomes.get(usuarios.get(resp.slice(6))) || t.nome || t.usuario) : 'Sem responsável');
      let cart = porCarteira.get(resp || '');
      if (!cart) { cart = { nome: dono, contas: new Set(), paginas: 0, valor: 0 }; porCarteira.set(resp || '', cart); }
      cart.contas.add(t.conta);
      cart.paginas += q;
      cart.valor += q * itens[tipo].preco_centavos;
      const chave = [competencia, t.conta, tipo, descricao.toUpperCase(), alerta || '', resp || ''].join('\u0001');
      let g = grupos.get(chave);
      if (!g) { g = { competencia, conta: t.conta, tipo, descricao, alerta, resp, quantidade: 0, data: t.dataHora.slice(0, 10), trabalhos: [] }; grupos.set(chave, g); }
      g.quantidade += q;
      if (t.dataHora.slice(0, 10) > g.data) g.data = t.dataHora.slice(0, 10);
      g.trabalhos.push({ chave: t.chave, quantidade: q });
    }
  }

  const resumo = {
    linhas, ignorados, duplicados,
    novos: novos.length,
    semLancamento,
    lancamentos: grupos.size,
    alertas: [...grupos.values()].filter((g) => g.alerta).length,
    valor: [...porConta.values()].reduce((s, r) => s + r.valor, 0),
    competencias: [...competencias].sort(),
    contas: [...porConta.values()].sort((a, b) => a.conta.localeCompare(b.conta, 'pt-BR')),
    contasNovas: [...contasNovas.keys()].sort(),
    vinculadas: vinculos.size,
    carteiras: [...porCarteira.values()].map((c) => ({ nome: c.nome, condominios: c.contas.size, paginas: c.paginas, valor: c.valor })).sort((a, b) => b.valor - a.valor),
    usuariosNovos: [...usuariosNovos.values()],
    duplexAtivo,
  };
  resumo.acrescidos = 0;
  for (const g of grupos.values()) {
    const cond = condPorConta.get(g.conta);
    if (cond && pendenteIgual(g, cond.id, itens[g.tipo].id, idResponsavel(g.resp, usuarios))) resumo.acrescidos++;
  }
  resumo.criados = grupos.size - resumo.acrescidos;
  if (!gravar || !novos.length) return resumo;

  tx(() => {
    const imp = run('INSERT INTO importacoes (arquivo, hash, usuario_id, linhas, importados, duplicados, ignorados, lancamentos) VALUES (?,?,?,?,?,?,?,?)',
      arquivo, hash, usuarioId, linhas, novos.length, duplicados, ignorados, grupos.size);
    const importacaoId = Number(imp.lastInsertRowid);
    for (const [nomeConta, c] of vinculos) run('UPDATE condominios SET conta_papercut = ? WHERE id = ? AND conta_papercut IS NULL', nomeConta, c.id);

    for (const [nomeConta, c] of contasNovas) {
      let codigo = c.codigo;
      if (get('SELECT 1 AS x FROM condominios WHERE codigo = ?', codigo)) codigo = (codigo + '-PC' + importacaoId).slice(0, 40);
      const ins = run('INSERT INTO condominios (codigo, nome, conta_papercut) VALUES (?,?,?)', codigo, c.nome, nomeConta);
      condPorConta.set(nomeConta, { id: Number(ins.lastInsertRowid), responsavel_id: null, gera_lancamento: 1 });
    }
    for (const [login, u] of usuariosNovos) {
      const ins = run("INSERT INTO usuarios (login, nome, papel) VALUES (?,?,'responsavel')", u.login, nomeMaiusculo(u.nome) || u.login);
      usuarios.set(login, Number(ins.lastInsertRowid));
    }

    const idTrabalho = new Map();
    for (const t of novos) {
      const ins = run(`INSERT INTO trabalhos (importacao_id, chave, data_hora, pc_usuario, pc_nome, conta, impressora, documento, paginas, coloridas, duplex, comentario, condominio_id)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        importacaoId, t.chave, t.dataHora, t.usuario, t.nome, t.conta, t.impressora, t.documento, t.paginas, t.coloridas, t.duplex, t.comentario, condPorConta.get(t.conta).id);
      idTrabalho.set(t.chave, Number(ins.lastInsertRowid));
    }

    let acrescidos = 0;
    for (const g of grupos.values()) {
      const item = itens[g.tipo];
      const respId = idResponsavel(g.resp, usuarios);
      const condId = condPorConta.get(g.conta).id;
      // Importações parciais do mesmo mês somam no lançamento que ainda está pendente,
      // em vez de criar um lançamento repetido a cada arquivo.
      const atual = pendenteIgual(g, condId, item.id, respId);
      let lancId;
      if (atual) {
        const qtd = atual.quantidade + g.quantidade;
        run("UPDATE lancamentos SET quantidade = ?, valor_centavos = ?, data = MAX(data, ?), atualizado_em = datetime('now','localtime') WHERE id = ?",
          qtd, qtd * atual.preco_centavos, g.data, atual.id);
        auditar(usuarioId, 'importação acrescentou', atual.id, `quantidade: ${atual.quantidade} → ${qtd} (${arquivo})`);
        lancId = atual.id;
        acrescidos++;
      } else {
        const ins = run(`INSERT INTO lancamentos (competencia, condominio_id, item_id, data, descricao, quantidade, preco_centavos, valor_centavos, responsavel_id, origem, alerta, importacao_id)
                         VALUES (?,?,?,?,?,?,?,?,?,'papercut',?,?)`,
          g.competencia, condId, item.id, g.data, g.descricao, g.quantidade, item.preco_centavos, g.quantidade * item.preco_centavos, respId, g.alerta, importacaoId);
        lancId = Number(ins.lastInsertRowid);
      }
      for (const t of g.trabalhos) run('INSERT INTO lancamento_trabalhos (lancamento_id, trabalho_id, quantidade) VALUES (?,?,?)', lancId, idTrabalho.get(t.chave), t.quantidade);
    }
    run('UPDATE importacoes SET lancamentos = ?, acrescidos = ? WHERE id = ?', grupos.size - acrescidos, acrescidos, importacaoId);
    auditar(usuarioId, 'importou do PaperCut', null, `${arquivo}: ${novos.length} trabalhos, ${grupos.size - acrescidos} lançamentos novos, ${acrescidos} acrescidos`);
    resumo.importacaoId = importacaoId;
    resumo.acrescidos = acrescidos;
    resumo.criados = grupos.size - acrescidos;
  });
  return resumo;
}

function idResponsavel(resp, usuarios) {
  if (!resp) return null;
  if (resp.startsWith('id:')) return Number(resp.slice(3));
  return usuarios.get(resp.slice(6)) || null;
}

function pendenteIgual(g, condId, itemId, respId) {
  return get(`SELECT id, quantidade, preco_centavos FROM lancamentos
              WHERE status = 'pendente' AND origem = 'papercut' AND competencia = ? AND condominio_id = ? AND item_id = ?
                AND UPPER(descricao) = UPPER(?) AND COALESCE(responsavel_id, 0) = ? AND COALESCE(alerta, '') = ?`,
    g.competencia, condId, itemId, g.descricao, respId || 0, g.alerta || '');
}

/**
 * Desfaz uma importação inteira. Só é permitido enquanto nenhum lançamento que ela
 * alimentou tiver sido liberado: o que já foi para a Contabilidade não some.
 */
function desfazer(importacaoId, usuarioId, { excluir = false } = {}) {
  const imp = get('SELECT * FROM importacoes WHERE id = ?', importacaoId);
  if (!imp) return { erro: 'Importação não encontrada.' };
  if (imp.desfeita_em && !excluir) return { erro: 'Esta importação já foi desfeita.' };
  const afetados = all(`SELECT l.id, l.status, l.quantidade, l.preco_centavos, SUM(lt.quantidade) AS desta,
                               (SELECT COUNT(*) FROM lancamento_trabalhos x JOIN trabalhos tx ON tx.id = x.trabalho_id WHERE x.lancamento_id = l.id AND tx.importacao_id <> ?) AS de_outras
                        FROM lancamentos l JOIN lancamento_trabalhos lt ON lt.lancamento_id = l.id JOIN trabalhos t ON t.id = lt.trabalho_id
                        WHERE t.importacao_id = ? GROUP BY l.id`, importacaoId, importacaoId);
  const liberados = afetados.filter((l) => l.status === 'liberado').length;
  if (liberados && !excluir) return { erro: `${liberados} lançamento(s) desta importação já foram liberados. Reabra-os antes de desfazer, ou peça ao administrador para excluir a importação.` };

  let removidos = 0;
  let reduzidos = 0;
  tx(() => {
    for (const l of afetados) {
      run('DELETE FROM lancamento_trabalhos WHERE lancamento_id = ? AND trabalho_id IN (SELECT id FROM trabalhos WHERE importacao_id = ?)', l.id, importacaoId);
      if (!l.de_outras) { run('DELETE FROM lancamentos WHERE id = ?', l.id); removidos++; }
      else {
        const qtd = Math.max(1, l.quantidade - l.desta);
        run("UPDATE lancamentos SET quantidade = ?, valor_centavos = ?, atualizado_em = datetime('now','localtime') WHERE id = ?", qtd, qtd * l.preco_centavos, l.id);
        auditar(usuarioId, 'importação desfeita', l.id, `quantidade: ${l.quantidade} → ${qtd}`);
        reduzidos++;
      }
    }
    run('DELETE FROM trabalhos WHERE importacao_id = ?', importacaoId);
    if (excluir) {
      // Excluir tira a importação também do histórico. O registro fica só na auditoria.
      run('UPDATE lancamentos SET importacao_id = NULL WHERE importacao_id = ?', importacaoId);
      run('DELETE FROM importacoes WHERE id = ?', importacaoId);
      auditar(usuarioId, 'excluiu importação', null, `${imp.arquivo} (de ${imp.criado_em}): ${removidos} lançamentos removidos, ${reduzidos} reduzidos${liberados ? `, ${liberados} já estavam liberados` : ''}`);
    } else {
      run("UPDATE importacoes SET desfeita_em = datetime('now','localtime') WHERE id = ?", importacaoId);
      auditar(usuarioId, 'desfez importação', null, `${imp.arquivo}: ${removidos} lançamentos removidos, ${reduzidos} reduzidos`);
    }
    reajustarPeriodosAbertos();
  });
  return { removidos, reduzidos, liberados };
}

module.exports = { analisar, processar, desfazer, lerConta, lerComentario, dividirPaginas, DESCRICAO_PADRAO };
