const express = require('express');
const path = require('path');
const fs = require('fs');
const { get, run, tx } = require('./src/db');
const auth = require('./src/auth');
const { fmt, auditar } = require('./src/dominio');
const { nomeMaiusculo, emailMinusculo, emailValido } = require('./src/texto');

auth.garantirAdmin();
// Meses sem nenhum lançamento liberado seguem sempre a regra de fechamento atual.
tx(() => require('./src/dominio').reajustarPeriodosAbertos());

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'");
  next();
});
// Sem prazo de cache: o navegador revalida a cada visita (resposta 304, barata) e uma
// correção de estilo ou script aparece na hora, sem precisar de Ctrl+F5.
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0 }));

// Verificação de saúde para monitor externo (UptimeRobot e parecidos): responde 200 se o banco responde.
// Não exige login e não revela nada além de "está no ar".
app.get('/saude', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    get('SELECT 1 AS x');
    res.json({ ok: true });
  } catch (e) {
    console.error('saúde:', e);
    res.status(503).json({ ok: false });
  }
});

app.use(express.urlencoded({ extended: true, limit: '2mb', parameterLimit: 20000 }));
app.use(auth.carregarSessao);

// O endereço do estilo e do script leva a data da última alteração (style.css?v=...), calculada uma vez
// na subida do serviço. Toda publicação reinicia o serviço, então o navegador busca a versão nova na hora.
const VERSAO = (() => {
  try {
    return ['style.css', 'app.js'].map((f) => Math.round(fs.statSync(path.join(__dirname, 'public', f)).mtimeMs).toString(36)).join('');
  } catch { return '0'; }
})();
app.use((req, res, next) => {
  res.locals.fmt = fmt;
  res.locals.versao = VERSAO;
  res.locals.caminho = req.path;
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// ---- Entrada e saída
app.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { erro: null, login: '' });
});

app.post('/login', (req, res) => {
  const login = String(req.body.login || '').trim();
  const senha = String(req.body.senha || '');
  const chave = login.toLowerCase() + '|' + req.ip;
  if (auth.loginBloqueado(chave)) {
    return res.status(429).render('login', { erro: 'Muitas tentativas. Aguarde 15 minutos e tente de novo.', login });
  }
  const u = get('SELECT id, senha_hash FROM usuarios WHERE login = ? AND ativo = 1', login);
  if (!u || !auth.confereSenha(senha, u.senha_hash)) {
    auth.registrarFalha(chave);
    return res.status(401).render('login', { erro: 'Usuário ou senha incorretos.', login });
  }
  auth.limparFalhas(chave);
  run("UPDATE usuarios SET ultimo_acesso = datetime('now','localtime') WHERE id = ?", u.id);
  auth.abrirSessao(res, u.id);
  res.redirect('/');
});

// ---- Esqueci minha senha
// Com o código de recuperação, o próprio usuário cria uma senha nova. Sem ele, registra um pedido
// e o administrador gera uma senha temporária. As respostas não revelam se o usuário existe.
app.get('/recuperar', (req, res) => {
  if (req.user) return res.redirect('/conta');
  res.render('recuperar', { erro: null, ok: null, login: String(req.query.login || '').slice(0, 60) });
});

app.post('/recuperar', (req, res) => {
  const login = String(req.body.login || '').trim().slice(0, 60);
  const nova = String(req.body.nova || '');
  const chave = 'rec|' + login.toLowerCase() + '|' + req.ip;
  const tela = (status, erro) => res.status(status).render('recuperar', { erro, ok: null, login });
  if (auth.loginBloqueado(chave)) return tela(429, 'Muitas tentativas. Aguarde 15 minutos e tente de novo.');
  const u = get('SELECT id, recuperacao_hash FROM usuarios WHERE login = ? AND ativo = 1', login);
  if (!u || !u.recuperacao_hash || !auth.confereCodigo(req.body.codigo, u.recuperacao_hash)) {
    auth.registrarFalha(chave);
    return tela(401, 'Usuário ou código de recuperação incorretos.');
  }
  const erro = nova !== String(req.body.repetir || '') ? 'As duas senhas novas não são iguais.' : auth.validarSenhaNova(nova);
  if (erro) return tela(400, erro);
  auth.limparFalhas(chave);
  // O código usado deixa de valer: um novo é gerado e mostrado agora.
  const codigo = tx(() => {
    run('UPDATE usuarios SET senha_hash = ?, trocar_senha = 0 WHERE id = ?', auth.hashSenha(nova), u.id);
    run("UPDATE pedidos_senha SET atendido_em = datetime('now','localtime') WHERE usuario_id = ? AND atendido_em IS NULL", u.id);
    auth.encerrarSessoesDe(u.id, '');
    auditar(u.id, 'recuperou a senha', null, 'com o código de recuperação');
    return auth.novoCodigoRecuperacao(u.id);
  });
  res.render('codigo_recuperacao', { codigo, logado: false, motivo: 'recuperou' });
});

app.post('/recuperar/pedido', (req, res) => {
  const login = String(req.body.login || '').trim().slice(0, 60);
  const chave = 'ped|' + req.ip;
  if (auth.loginBloqueado(chave)) return res.status(429).render('recuperar', { erro: 'Muitos pedidos seguidos. Aguarde 15 minutos.', ok: null, login });
  auth.registrarFalha(chave);
  const u = login && get('SELECT id FROM usuarios WHERE login = ? AND ativo = 1', login);
  if (u && !get('SELECT 1 AS x FROM pedidos_senha WHERE usuario_id = ? AND atendido_em IS NULL', u.id)) {
    run('INSERT INTO pedidos_senha (usuario_id) VALUES (?)', u.id);
    auditar(u.id, 'pediu senha nova', null, null);
  }
  res.render('recuperar', { erro: null, login: '',
    ok: 'Pedido registrado. O administrador vai gerar uma senha temporária para você; ela vale para um único acesso, e aí você cria a sua.' });
});

app.use(auth.exigirLogin);

app.post('/sair', auth.conferirCsrf, (req, res) => {
  auth.fecharSessao(req, res);
  res.redirect('/login');
});

app.get('/', (req, res) => {
  if (req.user.verTudo) return res.redirect('/painel');
  // A Contabilidade confere e libera tudo: entra direto na conferência.
  if (req.user.conferir) return res.redirect('/lancamentos');
  // Os demais entram onde mais usam: lançar cópias e conduções.
  res.redirect('/lancar');
});

// ---- Minha conta
// Nome e e-mail que a própria pessoa informa (no primeiro acesso é obrigatório).
function lerDados(b) {
  const nome = nomeMaiusculo(b.nome).slice(0, 120);
  const email = emailMinusculo(b.email);
  let erro = null;
  if (nome.split(' ').length < 2) erro = 'Informe seu nome completo, com sobrenome.';
  else if (!emailValido(email)) erro = 'Informe um e-mail válido, como nome@propstarter.com.br.';
  return { nome, email, erro };
}
const telaConta = (req, extra = {}) => ({ erro: null, erroCodigo: null, erroDados: null, dados: { nome: req.user.completarPerfil && req.user.nome.toUpperCase() === req.user.login.toUpperCase() ? '' : req.user.nome, email: req.user.email }, ...extra });

app.get('/conta', (req, res) => res.render('conta', telaConta(req)));
app.post('/conta/dados', auth.conferirCsrf, (req, res) => {
  const d = lerDados(req.body);
  if (d.erro) return res.status(400).render('conta', telaConta(req, { erroDados: d.erro, dados: d }));
  run('UPDATE usuarios SET nome = ?, email = ? WHERE id = ?', d.nome, d.email, req.user.id);
  auditar(req.user.id, 'atualizou os próprios dados', null, `${d.nome} <${d.email}>`);
  auth.flash(req, 'ok', 'Dados salvos.');
  res.redirect(req.user.trocarSenha ? '/conta' : '/');
});
app.post('/conta', auth.conferirCsrf, (req, res) => {
  const atual = String(req.body.atual || '');
  const nova = String(req.body.nova || '');
  const u = get('SELECT senha_hash FROM usuarios WHERE id = ?', req.user.id);
  let erro = null;
  if (!auth.confereSenha(atual, u.senha_hash)) erro = 'A senha atual não confere.';
  else if (nova !== String(req.body.repetir || '')) erro = 'As duas senhas novas não são iguais.';
  else if (nova === atual) erro = 'A senha nova precisa ser diferente da atual.';
  else erro = auth.validarSenhaNova(nova);
  // No primeiro acesso, a mesma tela pede nome e e-mail junto com a senha nova.
  const pedeDados = req.user.trocarSenha && req.user.completarPerfil;
  const d = pedeDados ? lerDados(req.body) : null;
  if (!erro && d && d.erro) erro = d.erro;
  if (erro) return res.status(400).render('conta', telaConta(req, { erro, ...(d ? { dados: d } : {}) }));
  run('UPDATE usuarios SET senha_hash = ?, trocar_senha = 0 WHERE id = ?', auth.hashSenha(nova), req.user.id);
  if (d) run('UPDATE usuarios SET nome = ?, email = ? WHERE id = ?', d.nome, d.email, req.user.id);
  auth.encerrarSessoesDe(req.user.id, req.sessao.token);
  // No primeiro acesso, a pessoa já sai com o código que permite recuperar a senha sozinha.
  if (req.user.semCodigo) {
    res.locals.user = { ...req.user, trocarSenha: false, semCodigo: false, completarPerfil: req.user.completarPerfil && !d, ...(d ? { nome: d.nome, email: d.email } : {}) };
    return res.render('codigo_recuperacao', { codigo: auth.novoCodigoRecuperacao(req.user.id), logado: true, motivo: 'primeiro' });
  }
  auth.flash(req, 'ok', 'Senha alterada.');
  res.redirect('/');
});

app.post('/conta/codigo', auth.conferirCsrf, (req, res) => {
  const u = get('SELECT senha_hash FROM usuarios WHERE id = ?', req.user.id);
  if (!auth.confereSenha(String(req.body.senha || ''), u.senha_hash)) return res.status(400).render('conta', telaConta(req, { erroCodigo: 'A senha não confere.' }));
  const codigo = auth.novoCodigoRecuperacao(req.user.id);
  auditar(req.user.id, 'gerou código de recuperação', null, null);
  res.locals.user = { ...req.user, semCodigo: false };
  res.render('codigo_recuperacao', { codigo, logado: true, motivo: 'novo' });
});

// ---- Áreas
app.use('/importacoes', auth.exigir('podeImportar'), require('./src/routes/importacoes'));
app.use('/cadastros/carga', auth.exigir('admin'), require('./src/routes/carga'));
app.use(auth.conferirCsrf);
app.use('/painel', auth.exigir('verRelatorios'), require('./src/routes/painel'));
app.use('/lancar', auth.exigir('logado'), require('./src/routes/lancar'));
app.use('/lancamentos', auth.exigir('logado'), require('./src/routes/lancamentos'));
app.use('/relatorios', auth.exigir('verRelatorios'), require('./src/routes/relatorios'));
app.use('/cadastros', auth.exigir('admin'), require('./src/routes/cadastros'));

app.use((req, res) => res.status(404).render('erro', { titulo: 'Página não encontrada', mensagem: 'O endereço não existe ou foi movido.' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  const grande = err && err.code === 'LIMIT_FILE_SIZE';
  res.status(grande ? 413 : 500).render('erro', {
    titulo: grande ? 'Arquivo grande demais' : 'Erro inesperado',
    mensagem: grande ? 'O limite é de 30 MB por arquivo.' : 'A operação não foi concluída. Tente de novo; se continuar, avise o administrador.',
  });
});

const porta = parseInt(process.env.PORT || '3210', 10);
if (require.main === module) {
  app.listen(porta, process.env.HOST || '127.0.0.1', () => console.log(`COPP no ar em http://localhost:${porta}`));
}
module.exports = app;
