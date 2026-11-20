const express = require('express');
const { all, get } = require('../db');

// Área "Novo lançamento": o ponto de entrada de todo mundo para lançar cópias e conduções à mão.
// Mostra as duas opções e os últimos lançamentos manuais da própria pessoa, com a situação de cada um.
const r = express.Router();

r.get('/', (req, res) => {
  const meus = all(`SELECT l.id, l.data, l.descricao, l.quantidade, l.valor_centavos, l.status, l.cancelado_motivo,
                           c.codigo AS cond_codigo, c.nome AS cond_nome, i.descricao AS item_desc, i.conta
                    FROM lancamentos l JOIN condominios c ON c.id = l.condominio_id JOIN itens i ON i.id = l.item_id
                    WHERE l.criado_por = ? AND l.origem = 'manual'
                    ORDER BY l.id DESC LIMIT 25`, req.user.id);
  const contagem = get(`SELECT SUM(status = 'pendente') AS pendentes, SUM(status = 'liberado') AS liberados
                        FROM lancamentos WHERE criado_por = ? AND origem = 'manual'`, req.user.id) || {};
  res.render('lancar', { meus, pendentes: contagem.pendentes || 0, liberados: contagem.liberados || 0 });
});

module.exports = r;
