const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'copp.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY,
  login TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nome TEXT NOT NULL,
  papel TEXT NOT NULL DEFAULT 'responsavel' CHECK (papel IN ('admin','responsavel','contabilidade')),
  senha_hash TEXT,
  trocar_senha INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS sessoes (
  token TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  flash TEXT,
  expira_em INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS condominios (
  id INTEGER PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  conta_papercut TEXT UNIQUE,
  responsavel_id INTEGER REFERENCES usuarios(id),
  gera_lancamento INTEGER NOT NULL DEFAULT 1,
  ativo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS itens (
  id INTEGER PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE,
  descricao TEXT NOT NULL,
  conta TEXT NOT NULL DEFAULT '1732',
  tipo TEXT,
  preco_centavos INTEGER NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1,
  valor_livre INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS importacoes (
  id INTEGER PRIMARY KEY,
  arquivo TEXT NOT NULL,
  hash TEXT NOT NULL,
  usuario_id INTEGER REFERENCES usuarios(id),
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  linhas INTEGER NOT NULL,
  importados INTEGER NOT NULL,
  duplicados INTEGER NOT NULL,
  ignorados INTEGER NOT NULL,
  lancamentos INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS trabalhos (
  id INTEGER PRIMARY KEY,
  importacao_id INTEGER NOT NULL REFERENCES importacoes(id),
  chave TEXT NOT NULL UNIQUE,
  data_hora TEXT NOT NULL,
  pc_usuario TEXT,
  pc_nome TEXT,
  conta TEXT,
  impressora TEXT,
  documento TEXT,
  paginas INTEGER NOT NULL,
  coloridas INTEGER NOT NULL,
  duplex INTEGER NOT NULL,
  comentario TEXT,
  condominio_id INTEGER REFERENCES condominios(id)
);
CREATE TABLE IF NOT EXISTS lancamentos (
  id INTEGER PRIMARY KEY,
  competencia TEXT NOT NULL,
  condominio_id INTEGER NOT NULL REFERENCES condominios(id),
  item_id INTEGER NOT NULL REFERENCES itens(id),
  data TEXT NOT NULL,
  descricao TEXT NOT NULL,
  quantidade INTEGER NOT NULL,
  preco_centavos INTEGER NOT NULL,
  valor_centavos INTEGER NOT NULL,
  responsavel_id INTEGER REFERENCES usuarios(id),
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','liberado','cancelado')),
  origem TEXT NOT NULL DEFAULT 'papercut',
  alerta TEXT,
  importacao_id INTEGER REFERENCES importacoes(id),
  liberado_por INTEGER REFERENCES usuarios(id),
  liberado_em TEXT,
  cancelado_motivo TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_lanc_comp ON lancamentos (competencia, status);
CREATE INDEX IF NOT EXISTS ix_lanc_resp ON lancamentos (responsavel_id, competencia);
CREATE TABLE IF NOT EXISTS lancamento_trabalhos (
  lancamento_id INTEGER NOT NULL REFERENCES lancamentos(id) ON DELETE CASCADE,
  trabalho_id INTEGER NOT NULL REFERENCES trabalhos(id),
  quantidade INTEGER NOT NULL,
  PRIMARY KEY (lancamento_id, trabalho_id)
);
CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id),
  acao TEXT NOT NULL,
  lancamento_id INTEGER,
  detalhe TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_aud_lanc ON auditoria (lancamento_id);
CREATE TABLE IF NOT EXISTS descricoes (
  id INTEGER PRIMARY KEY,
  texto TEXT NOT NULL UNIQUE COLLATE NOCASE
);
CREATE INDEX IF NOT EXISTS ix_trab_imp ON trabalhos (importacao_id);
CREATE INDEX IF NOT EXISTS ix_lt_trab ON lancamento_trabalhos (trabalho_id);
`);

// Migrações simples: acrescenta colunas que não existiam nas primeiras versões.
function garantirColuna(tabela, coluna, definicao) {
  const tem = db.prepare(`PRAGMA table_info(${tabela})`).all().some((c) => c.name === coluna);
  if (!tem) db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicao}`);
}
db.exec(`
CREATE TABLE IF NOT EXISTS departamentos (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE COLLATE NOCASE,
  funcao TEXT NOT NULL DEFAULT 'comum' CHECK (funcao IN ('comum','gerencia','contabilidade','diretoria')),
  ordem INTEGER NOT NULL DEFAULT 0
);`);
// A primeira versão só aceitava itens de cópia. A tabela é refeita para aceitar também os de condução.
const itensAntiga = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'itens'").get();
if (itensAntiga && itensAntiga.sql.includes('CHECK (tipo IN')) {
  db.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN;
    CREATE TABLE itens_nova (
      id INTEGER PRIMARY KEY, codigo TEXT NOT NULL UNIQUE, descricao TEXT NOT NULL, conta TEXT NOT NULL DEFAULT '1732',
      tipo TEXT, preco_centavos INTEGER NOT NULL, ativo INTEGER NOT NULL DEFAULT 1, valor_livre INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO itens_nova (id, codigo, descricao, conta, tipo, preco_centavos, ativo) SELECT id, codigo, descricao, '1732', tipo, preco_centavos, ativo FROM itens;
    DROP TABLE itens;
    ALTER TABLE itens_nova RENAME TO itens;
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_itens_tipo ON itens (tipo) WHERE tipo IS NOT NULL');
garantirColuna('lancamentos', 'funcionario_id', 'INTEGER REFERENCES usuarios(id)');
garantirColuna('lancamentos', 'hora_inicio', 'TEXT');
garantirColuna('lancamentos', 'hora_fim', 'TEXT');
garantirColuna('usuarios', 'departamento_id', 'INTEGER REFERENCES departamentos(id)');
garantirColuna('usuarios', 'superior_id', 'INTEGER REFERENCES usuarios(id)');
garantirColuna('usuarios', 'matricula', 'TEXT');
garantirColuna('lancamentos', 'criado_por', 'INTEGER REFERENCES usuarios(id)');
garantirColuna('importacoes', 'desfeita_em', 'TEXT');
garantirColuna('importacoes', 'acrescidos', 'INTEGER NOT NULL DEFAULT 0');
garantirColuna('usuarios', 'recuperacao_hash', 'TEXT');
garantirColuna('usuarios', 'ultimo_acesso', 'TEXT');
garantirColuna('usuarios', 'email', 'TEXT');
{
  // Descrições em MAIÚSCULAS: lista padrão e lançamentos ainda pendentes. Os liberados ficam como foram aprovados.
  const { descricaoPadrao, descricaoValida } = require('./texto');
  const vistos = new Set();
  for (const d of db.prepare('SELECT id, texto FROM descricoes ORDER BY id').all()) {
    const novo = descricaoPadrao(d.texto);
    if (!descricaoValida(novo) || vistos.has(novo)) { db.prepare('DELETE FROM descricoes WHERE id = ?').run(d.id); continue; }
    vistos.add(novo);
    if (novo !== d.texto) db.prepare('UPDATE descricoes SET texto = ? WHERE id = ?').run(novo, d.id);
  }
  const ajustar = db.prepare('UPDATE lancamentos SET descricao = ? WHERE id = ?');
  for (const l of db.prepare("SELECT id, descricao FROM lancamentos WHERE status = 'pendente'").all()) {
    const novo = descricaoPadrao(l.descricao);
    const final = descricaoValida(novo) ? novo : 'CÓPIAS E IMPRESSÕES';
    if (final !== l.descricao) ajustar.run(final, l.id);
  }
}
// Os três itens de cópia que a importação usa ficam sempre ativos.
db.exec("UPDATE itens SET ativo = 1 WHERE tipo IN ('simples', 'colorida', 'duplex') AND ativo = 0");
{
  // Nomes em maiúsculas e e-mails em minúsculas também para quem foi cadastrado antes dessa regra.
  const { nomeMaiusculo, emailMinusculo } = require('./texto');
  const ajustar = db.prepare('UPDATE usuarios SET nome = ?, email = ? WHERE id = ?');
  for (const u of db.prepare('SELECT id, nome, email FROM usuarios').all()) {
    const nome = nomeMaiusculo(u.nome) || u.nome;
    const email = u.email ? emailMinusculo(u.email) : null;
    if (nome !== u.nome || email !== u.email) ajustar.run(nome, email, u.id);
  }
}
db.exec(`
CREATE TABLE IF NOT EXISTS configuracoes (chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
-- Datas de cada competência, gravadas quando ela nasce. Mudar a regra de fechamento não mexe nos meses já entregues.
CREATE TABLE IF NOT EXISTS periodos (competencia TEXT PRIMARY KEY, de TEXT NOT NULL, ate TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pedidos_senha (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  atendido_em TEXT,
  atendido_por INTEGER REFERENCES usuarios(id)
);`);

const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) { s = db.prepare(sql); cache.set(sql, s); }
  return s;
}
const all = (sql, ...p) => stmt(sql).all(...p);
const get = (sql, ...p) => stmt(sql).get(...p);
const run = (sql, ...p) => stmt(sql).run(...p);

function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// Competências criadas antes da regra de fechamento eram sempre o mês do calendário.
for (const { competencia } of all('SELECT DISTINCT competencia FROM lancamentos WHERE competencia NOT IN (SELECT competencia FROM periodos)')) {
  const [a, m] = competencia.split('-').map(Number);
  run('INSERT INTO periodos (competencia, de, ate) VALUES (?,?,?)', competencia, `${competencia}-01`, new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10));
}

// Tabela de preços do sistema atual. Dupla face entra desativada até o preço ser confirmado:
// enquanto estiver inativa, páginas em dupla face contam como cópia simples.
if (!get('SELECT 1 AS x FROM itens LIMIT 1')) {
  run("INSERT INTO itens (codigo, descricao, tipo, preco_centavos, ativo) VALUES ('1','Cópias simples','simples',38,1)");
  run("INSERT INTO itens (codigo, descricao, tipo, preco_centavos, ativo) VALUES ('2','Cópias simples coloridas','colorida',135,1)");
  run("INSERT INTO itens (codigo, descricao, tipo, preco_centavos, ativo) VALUES ('10','Dupla face laser','duplex',38,0)");
}

// Itens de condução (conta 1741), com os preços vistos no relatório do sistema antigo.
// Os dois trajetos sem preço conhecido entram desativados até o administrador informar o valor.
if (!get("SELECT 1 AS x FROM itens WHERE conta = '1741' LIMIT 1")) {
  const conducao = [['11', 'Ônibus + ônibus', 1060, 1, 0], ['12', 'Metrô + metrô', 1080, 1, 0], ['13', 'Metrô + trólebus + trólebus + metrô', 0, 0, 0],
    ['15', 'Isento', 0, 1, 0], ['16', 'Ida e volta (ônibus + metrô + metrô + ônibus)', 0, 0, 0], ['19', 'Valor específico', 0, 1, 1]];
  for (const [codigo, descricao, preco, ativo, livre] of conducao) {
    if (!get('SELECT 1 AS x FROM itens WHERE codigo = ?', codigo)) run("INSERT INTO itens (codigo, descricao, conta, preco_centavos, ativo, valor_livre) VALUES (?,?,'1741',?,?,?)", codigo, descricao, preco, ativo, livre);
  }
}

// Descrições que se repetem todo mês. Servem de sugestão na conferência.
if (!get('SELECT 1 AS x FROM descricoes LIMIT 1')) {
  for (const t of ['Cópias e impressões', 'Material de assembleia', 'Balancete e conciliação', 'Folha de pagamento', 'Holerites',
    'Circular aos condôminos', 'Documentos para a pasta de prestação de contas', 'Notas fiscais e boletos', 'Convenção e regulamento interno', 'Ata de assembleia']) {
    run('INSERT INTO descricoes (texto) VALUES (?)', t);
  }
}

// Departamentos da administradora. A "função" define o que o departamento enxerga além da própria carteira:
// gerencia = gerentes de prédio; contabilidade = importa o PaperCut e emite relatórios; diretoria = vê todas as carteiras.
if (!get('SELECT 1 AS x FROM departamentos LIMIT 1')) {
  const deptos = [['DIRETORIA', 'diretoria'], ['GERÊNCIA', 'gerencia'], ['CONTABILIDADE', 'contabilidade'], ['FINANCEIRO', 'comum'], ['RH', 'comum'],
    ['EXPEDIÇÃO', 'comum'], ['LOCAÇÃO', 'comum'], ['CADASTRO', 'comum'], ['PROVIDÊNCIAS', 'comum'], ['NORMAS', 'comum'], ['RECEPÇÃO', 'comum']];
  deptos.forEach(([nome, funcao], i) => run('INSERT INTO departamentos (nome, funcao, ordem) VALUES (?,?,?)', nome, funcao, i + 1));
}
// O antigo perfil "contabilidade" virou departamento: todo mundo que não é administrador é usuário comum.
run(`UPDATE usuarios SET papel = 'responsavel', departamento_id = COALESCE(departamento_id, (SELECT id FROM departamentos WHERE funcao = 'contabilidade' ORDER BY ordem LIMIT 1))
     WHERE papel = 'contabilidade'`);

module.exports = { db, all, get, run, tx, DATA_DIR };
