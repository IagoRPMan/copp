const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { get, run, DATA_DIR } = require('./db');
const { perfilIncompleto } = require('./texto');

const COOKIE = 'copp_sid';
const DURACAO_MS = 12 * 60 * 60 * 1000;
const COOKIE_SEGURO = process.env.COOKIE_SEGURO === '1';

function hashSenha(senha) {
  const sal = crypto.randomBytes(16);
  return sal.toString('hex') + ':' + crypto.scryptSync(senha, sal, 64).toString('hex');
}

function confereSenha(senha, armazenado) {
  if (!armazenado || !armazenado.includes(':')) return false;
  const [sal, hash] = armazenado.split(':');
  const esperado = Buffer.from(hash, 'hex');
  const obtido = crypto.scryptSync(senha, Buffer.from(sal, 'hex'), 64);
  return esperado.length === obtido.length && crypto.timingSafeEqual(esperado, obtido);
}

function senhaTemporaria() {
  return crypto.randomBytes(9).toString('base64url');
}

// Código de recuperação: 16 caracteres sem os que se confundem (0/O, 1/I/L), em 4 grupos.
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const normalizarCodigo = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function codigoRecuperacao() {
  let s = '';
  for (let i = 0; i < 16; i++) s += ALFABETO[crypto.randomInt(ALFABETO.length)];
  return s.match(/.{4}/g).join('-');
}
/** Gera um código novo para o usuário, guarda só o hash e devolve o código para ser mostrado uma única vez. */
function novoCodigoRecuperacao(usuarioId) {
  const codigo = codigoRecuperacao();
  run('UPDATE usuarios SET recuperacao_hash = ? WHERE id = ?', hashSenha(normalizarCodigo(codigo)), usuarioId);
  return codigo;
}
const confereCodigo = (codigo, armazenado) => confereSenha(normalizarCodigo(codigo), armazenado);

function validarSenhaNova(senha) {
  if (typeof senha !== 'string' || senha.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (senha.length > 200) return 'A senha é longa demais.';
  return null;
}

// Primeiro acesso: cria o administrador e grava a senha num arquivo, fora do banco e do log.
function garantirAdmin() {
  if (get("SELECT 1 AS x FROM usuarios WHERE papel = 'admin' AND senha_hash IS NOT NULL LIMIT 1")) return;
  const senha = process.env.ADMIN_SENHA || senhaTemporaria();
  const existente = get("SELECT id FROM usuarios WHERE login = 'admin'");
  if (existente) {
    run("UPDATE usuarios SET senha_hash = ?, papel = 'admin', ativo = 1, trocar_senha = 1 WHERE id = ?", hashSenha(senha), existente.id);
  } else {
    run("INSERT INTO usuarios (login, nome, papel, senha_hash, trocar_senha) VALUES ('admin', 'Administrador', 'admin', ?, 1)", hashSenha(senha));
  }
  if (!process.env.ADMIN_SENHA) {
    const arquivo = path.join(DATA_DIR, 'admin-inicial.txt');
    fs.writeFileSync(arquivo, `login: admin\nsenha: ${senha}\n\nTroque a senha no primeiro acesso e apague este arquivo.\n`, { mode: 0o600 });
    console.log(`Administrador criado. A senha inicial está em ${arquivo}`);
  }
}

function lerCookie(req) {
  const bruto = req.headers.cookie || '';
  for (const parte of bruto.split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === COOKIE) return parte.slice(i + 1).trim();
  }
  return null;
}

function gravarCookie(res, token, maxAgeSeg) {
  const partes = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeg}`];
  if (COOKIE_SEGURO) partes.push('Secure');
  res.setHeader('Set-Cookie', partes.join('; '));
}

function abrirSessao(res, usuarioId) {
  const token = crypto.randomBytes(32).toString('hex');
  run('DELETE FROM sessoes WHERE expira_em < ?', Date.now());
  run('INSERT INTO sessoes (token, usuario_id, csrf, expira_em) VALUES (?, ?, ?, ?)',
    token, usuarioId, crypto.randomBytes(24).toString('hex'), Date.now() + DURACAO_MS);
  gravarCookie(res, token, DURACAO_MS / 1000);
}

function fecharSessao(req, res) {
  const token = lerCookie(req);
  if (token) run('DELETE FROM sessoes WHERE token = ?', token);
  gravarCookie(res, '', 0);
}

function encerrarSessoesDe(usuarioId, excetoToken) {
  run('DELETE FROM sessoes WHERE usuario_id = ? AND token <> ?', usuarioId, excetoToken || '');
}

function carregarSessao(req, res, next) {
  req.user = null;
  res.locals.user = null;
  res.locals.csrf = '';
  res.locals.flash = null;
  const token = lerCookie(req);
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    const s = get(`SELECT s.token, s.csrf, s.flash, u.id, u.login, u.nome, u.email, u.papel, u.trocar_senha, u.recuperacao_hash IS NULL AS sem_codigo, d.nome AS depto, d.funcao
                   FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id LEFT JOIN departamentos d ON d.id = u.departamento_id
                   WHERE s.token = ? AND s.expira_em > ? AND u.ativo = 1`, token, Date.now());
    if (s) {
      // Só o administrador mexe em cadastros. Os demais criam, editam e aprovam lançamentos;
      // o departamento acrescenta o que cada um enxerga além da própria carteira.
      const admin = s.papel === 'admin';
      req.user = {
        id: s.id, login: s.login, nome: s.nome, email: s.email || '', papel: s.papel, trocarSenha: !!s.trocar_senha, semCodigo: !!s.sem_codigo,
        completarPerfil: perfilIncompleto(s),
        depto: s.depto || null, funcao: s.funcao || 'comum', admin,
        podeImportar: admin || s.funcao === 'contabilidade',
        verRelatorios: admin || s.funcao === 'contabilidade' || s.funcao === 'diretoria',
        verTudo: admin || s.funcao === 'diretoria',
        logado: true,
      };
      req.sessao = { token: s.token, csrf: s.csrf };
      res.locals.user = req.user;
      res.locals.csrf = s.csrf;
      if (s.flash && req.method === 'GET') {
        try { res.locals.flash = JSON.parse(s.flash); } catch { /* ignora */ }
        run('UPDATE sessoes SET flash = NULL WHERE token = ?', token);
      }
    }
  }
  next();
}

function flash(req, tipo, texto) {
  if (req.sessao) run('UPDATE sessoes SET flash = ? WHERE token = ?', JSON.stringify({ tipo, texto }), req.sessao.token);
}

function exigirLogin(req, res, next) {
  if (!req.user) return res.redirect('/login');
  if ((req.user.trocarSenha || req.user.completarPerfil) && !['/conta', '/conta/dados', '/sair'].includes(req.path)) return res.redirect('/conta');
  next();
}

function exigir(permissao) {
  return (req, res, next) => {
    if (!req.user) return res.redirect('/login');
    if (!req.user[permissao]) {
      return res.status(403).render('erro', { titulo: 'Acesso negado', mensagem: 'Seu perfil não tem acesso a esta área.' });
    }
    next();
  };
}

// Vale para todo POST autenticado. Em upload, precisa rodar depois do multer.
function conferirCsrf(req, res, next) {
  if (req.method !== 'POST') return next();
  const enviado = req.body && req.body._csrf;
  const esperado = req.sessao && req.sessao.csrf;
  if (!esperado || typeof enviado !== 'string' || enviado.length !== esperado.length ||
      !crypto.timingSafeEqual(Buffer.from(enviado), Buffer.from(esperado))) {
    return res.status(403).render('erro', { titulo: 'Sessão expirada', mensagem: 'Recarregue a página e tente de novo.' });
  }
  next();
}

// Limite simples de tentativas de login, em memória.
const tentativas = new Map();
function loginBloqueado(chave) {
  const t = tentativas.get(chave);
  return !!t && t.n >= 8 && Date.now() - t.inicio < 15 * 60 * 1000;
}
function registrarFalha(chave) {
  const t = tentativas.get(chave);
  if (!t || Date.now() - t.inicio > 15 * 60 * 1000) tentativas.set(chave, { n: 1, inicio: Date.now() });
  else t.n += 1;
}
function limparFalhas(chave) { tentativas.delete(chave); }

module.exports = {
  hashSenha, confereSenha, senhaTemporaria, validarSenhaNova, garantirAdmin, novoCodigoRecuperacao, confereCodigo,
  abrirSessao, fecharSessao, encerrarSessoesDe, carregarSessao, flash,
  exigirLogin, exigir, conferirCsrf, loginBloqueado, registrarFalha, limparFalhas,
};
