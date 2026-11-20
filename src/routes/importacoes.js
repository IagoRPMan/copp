const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { all, DATA_DIR } = require('../db');
const { conferirCsrf, flash } = require('../auth');
const papercut = require('../papercut');

const r = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024, files: 1 } });
const pastaUploads = path.join(DATA_DIR, 'uploads');
const caminhoDe = (hash) => path.join(pastaUploads, hash + '.csv');

function historico() {
  return all(`SELECT i.*, u.nome AS usuario_nome FROM importacoes i LEFT JOIN usuarios u ON u.id = i.usuario_id ORDER BY i.id DESC LIMIT 50`);
}

r.get('/', (req, res) => res.render('importacoes', { historico: historico(), erro: null }));

// Passo 1: lê o arquivo e mostra o que seria lançado. Nada é gravado ainda.
r.post('/', upload.single('arquivo'), conferirCsrf, (req, res) => {
  if (!req.file) return res.status(400).render('importacoes', { historico: historico(), erro: 'Escolha o arquivo CSV exportado do PaperCut.' });
  const analise = papercut.analisar(req.file.buffer);
  if (analise.erro) return res.status(400).render('importacoes', { historico: historico(), erro: analise.erro });

  const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
  fs.writeFileSync(caminhoDe(hash), req.file.buffer);
  const ignorados = analise.ignorados.reduce((s, i) => s + i.quantidade, 0);
  const previa = papercut.processar(analise.trabalhos, { linhas: analise.linhas, ignorados });
  const arquivo = path.basename(req.file.originalname || 'papercut.csv').slice(0, 120);
  res.render('importacao_previa', { previa, motivos: analise.ignorados, hash, arquivo });
});

// Passo 2: grava os lançamentos como pendentes.
r.post('/confirmar', conferirCsrf, (req, res) => {
  const hash = String(req.body.hash || '');
  if (!/^[a-f0-9]{64}$/.test(hash) || !fs.existsSync(caminhoDe(hash))) {
    flash(req, 'erro', 'A prévia expirou. Envie o arquivo de novo.');
    return res.redirect('/importacoes');
  }
  const buffer = fs.readFileSync(caminhoDe(hash));
  const analise = papercut.analisar(buffer);
  const ignorados = analise.ignorados.reduce((s, i) => s + i.quantidade, 0);
  const resultado = papercut.processar(analise.trabalhos, {
    gravar: true, usuarioId: req.user.id, hash, linhas: analise.linhas, ignorados,
    arquivo: String(req.body.arquivo || 'papercut.csv').slice(0, 120),
  });
  fs.unlinkSync(caminhoDe(hash));
  if (!resultado.novos) {
    flash(req, 'aviso', 'Nenhum trabalho novo: tudo neste arquivo já tinha sido importado.');
    return res.redirect('/importacoes');
  }
  flash(req, 'ok', `${resultado.novos} trabalhos importados: ${resultado.criados} lançamentos novos` +
    (resultado.acrescidos ? ` e ${resultado.acrescidos} pendentes que já existiam receberam as páginas a mais.` : '.'));
  res.redirect('/lancamentos?competencia=' + (resultado.competencias[resultado.competencias.length - 1] || ''));
});

// Desfaz a importação inteira, enquanto nada dela tiver sido liberado.
r.post('/:id/desfazer', conferirCsrf, (req, res) => {
  const resultado = papercut.desfazer(parseInt(req.params.id, 10) || 0, req.user.id);
  if (resultado.erro) flash(req, 'erro', resultado.erro);
  else flash(req, 'ok', `Importação desfeita: ${resultado.removidos} lançamento(s) removidos e ${resultado.reduzidos} reduzidos. O arquivo pode ser importado de novo.`);
  res.redirect('/importacoes');
});

// Exclui a importação do sistema, com tudo o que ela lançou, inclusive o que já foi liberado. Só o administrador.
r.post('/:id/excluir', conferirCsrf, (req, res) => {
  if (!req.user.admin) return res.status(403).render('erro', { titulo: 'Acesso negado', mensagem: 'Só o administrador exclui importações.' });
  const resultado = papercut.desfazer(parseInt(req.params.id, 10) || 0, req.user.id, { excluir: true });
  if (resultado.erro) flash(req, 'erro', resultado.erro);
  else flash(req, 'ok', `Importação excluída: ${resultado.removidos} lançamento(s) removidos` + (resultado.liberados ? `, ${resultado.liberados} deles já liberados.` : '.'));
  res.redirect('/importacoes');
});

module.exports = r;
