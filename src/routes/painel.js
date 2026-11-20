const express = require('express');
const { all } = require('../db');
const { competencias, EMPRESA } = require('../dominio');

const r = express.Router();
const DIA = 24 * 60 * 60 * 1000;
const diasDesde = (texto) => (texto ? Math.max(0, Math.floor((Date.now() - new Date(texto.replace(' ', 'T')).getTime()) / DIA)) : null);

// Toda conferência é da Contabilidade. O painel mostra quanto falta para fechar o mês e onde está o trabalho:
// por condomínio, com o que está pendente há mais tempo primeiro.
r.get('/', (req, res) => {
  const comps = competencias();
  const competencia = comps.find((c) => c.competencia === req.query.competencia) || comps[0] || null;
  const condominios = competencia
    ? all(`SELECT c.id, c.codigo, c.nome,
                  SUM(l.status = 'pendente') AS pendentes, SUM(l.status = 'liberado') AS liberados,
                  SUM(CASE WHEN l.status = 'pendente' THEN l.valor_centavos ELSE 0 END) AS valor_pendente, SUM(l.valor_centavos) AS valor,
                  SUM(l.alerta IS NOT NULL AND l.status = 'pendente') AS alertas,
                  SUM(l.origem = 'manual' AND l.status = 'pendente') AS manuais,
                  MIN(CASE WHEN l.status = 'pendente' THEN l.criado_em END) AS pendente_desde,
                  MAX(l.liberado_em) AS ultima_liberacao
           FROM lancamentos l JOIN condominios c ON c.id = l.condominio_id
           WHERE l.competencia = ? AND l.status <> 'cancelado'
           GROUP BY c.id`, competencia.competencia)
      .map((c) => ({ ...c, dias: diasDesde(c.pendente_desde) }))
    : [];
  const pendentes = condominios.filter((c) => c.pendentes > 0)
    .sort((a, b) => (b.dias - a.dias) || (b.alertas - a.alertas) || (b.pendentes - a.pendentes) || a.codigo.localeCompare(b.codigo, 'pt-BR'));
  const prontos = condominios.filter((c) => !c.pendentes).sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR'));
  const soma = (lista, campo) => lista.reduce((s, c) => s + (c[campo] || 0), 0);
  res.render('painel', {
    comps, competencia, pendentes, prontos, empresa: EMPRESA,
    totais: {
      pendentes: soma(pendentes, 'pendentes'),
      alertas: soma(pendentes, 'alertas'),
      manuais: soma(pendentes, 'manuais'),
      valorPendente: soma(pendentes, 'valor_pendente'),
    },
    maisAntigo: pendentes.length ? pendentes[0].dias : null,
  });
});

module.exports = r;
