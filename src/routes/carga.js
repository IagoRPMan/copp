const express = require('express');
const multer = require('multer');
const { conferirCsrf, flash } = require('../auth');
const { carregarCondominios, COLUNAS } = require('../carga');

// Fica fora do roteador de cadastros porque o upload precisa ser lido antes da conferência do token CSRF.
const r = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

r.get('/modelo.csv', (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="modelo-condominios.csv"');
  res.send('﻿' + COLUNAS.join(';') + '\r\n0076;COND. ED. EXEMPLO;076 - Exemplo;maria.silva;Maria Silva;0007;GERÊNCIA;joao.souza;João Souza\r\n');
});

r.post('/', upload.single('arquivo'), conferirCsrf, (req, res) => {
  if (!req.file) { flash(req, 'erro', 'Escolha a planilha em CSV.'); return res.redirect('/cadastros/condominios'); }
  let x;
  try { x = carregarCondominios(req.file.buffer, req.user.id); } catch (e) { flash(req, 'erro', 'Não consegui ler a planilha: ' + e.message); return res.redirect('/cadastros/condominios'); }
  const resumo = `${x.criados} condomínio(s) criados, ${x.atualizados} atualizados` + (x.usuariosNovos ? `, ${x.usuariosNovos} usuário(s) novos sem senha` : '') + '.';
  if (x.problemas.length) flash(req, 'erro', resumo + ' Não entraram: ' + x.problemas.slice(0, 8).join('; ') + (x.problemas.length > 8 ? `; e mais ${x.problemas.length - 8}` : '') + '.');
  else flash(req, 'ok', resumo);
  res.redirect('/cadastros/condominios');
});

module.exports = r;
