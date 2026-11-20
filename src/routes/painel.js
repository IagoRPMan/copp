const express = require('express');
const { all } = require('../db');
const { competencias, EMPRESA } = require('../dominio');

const r = express.Router();
const DIA = 24 * 60 * 60 * 1000;
const diasDesde = (texto) => (texto ? Math.max(0, Math.floor((Date.now() - new Date(texto.replace(' ', 'T')).getTime()) / DIA)) : null);

r.get('/', (req, res) => {
  const comps = competencias();
  const competencia = comps.find((c) => c.competencia === req.query.competencia) || comps[0] || null;
  const carteiras = competencia
    ? all(`SELECT u.id, COALESCE(u.nome, 'Sem responsável') AS nome, u.login, u.senha_hash IS NOT NULL AS tem_acesso, u.ultimo_acesso, d.nome AS depto, s.nome AS superior,
                  SUM(l.status = 'pendente') AS pendentes, SUM(l.status = 'liberado') AS liberados,
                  COUNT(DISTINCT CASE WHEN l.status = 'pendente' THEN l.condominio_id END) AS condominios,
                  SUM(CASE WHEN l.status = 'pendente' THEN l.valor_centavos ELSE 0 END) AS valor_pendente, SUM(l.valor_centavos) AS valor,
                  SUM(l.alerta IS NOT NULL AND l.status = 'pendente') AS alertas,
                  MIN(CASE WHEN l.status = 'pendente' THEN l.criado_em END) AS pendente_desde,
                  MAX(l.liberado_em) AS ultima_liberacao
           FROM lancamentos l LEFT JOIN usuarios u ON u.id = l.responsavel_id
                LEFT JOIN departamentos d ON d.id = u.departamento_id LEFT JOIN usuarios s ON s.id = u.superior_id
           WHERE l.competencia = ? AND l.status <> 'cancelado'
           GROUP BY l.responsavel_id`, competencia.competencia)
      .map((c) => ({ ...c, dias: diasDesde(c.pendente_desde) }))
    : [];
  // Quem segura o fechamento: primeiro quem espera há mais tempo, depois quem tem mais pendências.
  const pendentes = carteiras.filter((c) => c.pendentes > 0)
    .sort((a, b) => (b.dias - a.dias) || (b.pendentes - a.pendentes) || a.nome.localeCompare(b.nome, 'pt-BR'));
  const prontos = carteiras.filter((c) => !c.pendentes).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  res.render('painel', {
    comps, competencia, pendentes, prontos, empresa: EMPRESA,
    semAcesso: pendentes.filter((c) => c.id && !c.tem_acesso).length,
    maisAntigo: pendentes.length ? pendentes[0].dias : null,
  });
});

module.exports = r;
