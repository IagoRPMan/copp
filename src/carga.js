const { parse } = require('csv-parse/sync');
const { get, run, tx } = require('./db');
const { auditar } = require('./dominio');
const { nomeMaiusculo } = require('./texto');

const COLUNAS = ['codigo', 'nome', 'conta_papercut', 'login_responsavel', 'nome_responsavel', 'matricula_responsavel', 'departamento', 'login_superior', 'nome_superior'];
const LOGIN = /^[A-Za-z0-9._@-]{2,60}$/;

function lerPlanilha(buffer) {
  let texto = buffer.toString('utf8');
  if (texto.includes('�')) texto = buffer.toString('latin1');
  texto = texto.replace(/^﻿/, '');
  const primeira = texto.split(/\r?\n/)[0] || '';
  const linhas = parse(texto, { delimiter: primeira.includes(';') ? ';' : ',', columns: (h) => h.map((c) => c.trim().toLowerCase()), skip_empty_lines: true, trim: true, relax_column_count: true });
  if (!linhas.length || !('codigo' in linhas[0]) || !('nome' in linhas[0])) throw new Error('A planilha precisa das colunas codigo e nome. Baixe o modelo para conferir.');
  return linhas;
}

/**
 * Cadastra ou atualiza condomínios e monta as carteiras.
 * O responsável de cada condomínio é o gerente; "login_superior" liga o gerente ao supervisor.
 * Pode ser repetida à vontade: casa condomínio pelo código e pessoa pelo login.
 */
function carregarCondominios(buffer, usuarioId) {
  const linhas = lerPlanilha(buffer);
  const r = { criados: 0, atualizados: 0, usuariosNovos: 0, problemas: [] };

  const pessoa = (login, nome, extras = {}) => {
    nome = nomeMaiusculo(nome);
    const u = get('SELECT id FROM usuarios WHERE login = ?', login);
    let id;
    if (u) id = u.id;
    else { id = Number(run("INSERT INTO usuarios (login, nome, papel) VALUES (?,?,'responsavel')", login, nome || nomeMaiusculo(login)).lastInsertRowid); r.usuariosNovos++; }
    if (nome) run('UPDATE usuarios SET nome = ? WHERE id = ? AND (upper(nome) = upper(login) OR ? = 1)', nome, id, u ? 0 : 1);
    if (extras.matricula) run('UPDATE usuarios SET matricula = ? WHERE id = ?', extras.matricula, id);
    if (extras.departamentoId) run('UPDATE usuarios SET departamento_id = COALESCE(departamento_id, ?) WHERE id = ?', extras.departamentoId, id);
    if (extras.superiorId && extras.superiorId !== id) run('UPDATE usuarios SET superior_id = ? WHERE id = ?', extras.superiorId, id);
    return id;
  };

  tx(() => {
    linhas.forEach((l, i) => {
      const n = i + 2;
      const codigo = String(l.codigo || '').trim().slice(0, 40);
      const nome = String(l.nome || '').trim().slice(0, 120);
      const conta = String(l.conta_papercut || '').trim().slice(0, 160) || null;
      const login = String(l.login_responsavel || '').trim().slice(0, 60);
      const loginSup = String(l.login_superior || '').trim().slice(0, 60);
      if (!codigo || !nome) { r.problemas.push(`linha ${n}: sem código ou nome`); return; }
      if ((login && !LOGIN.test(login)) || (loginSup && !LOGIN.test(loginSup))) { r.problemas.push(`linha ${n}: login inválido`); return; }
      // Casa pelo código; se não achar, pela conta do PaperCut (condomínio criado pela importação).
      const atual = get('SELECT id, responsavel_id FROM condominios WHERE codigo = ?', codigo) || (conta ? get('SELECT id, responsavel_id FROM condominios WHERE conta_papercut = ?', conta) : null);
      const dono = conta ? get('SELECT id FROM condominios WHERE conta_papercut = ?', conta) : null;
      if (dono && (!atual || dono.id !== atual.id)) { r.problemas.push(`linha ${n}: a conta "${conta}" já pertence a outro condomínio`); return; }
      if (atual && get('SELECT 1 AS x FROM condominios WHERE codigo = ? AND id <> ?', codigo, atual.id)) { r.problemas.push(`linha ${n}: código ${codigo} repetido`); return; }

      let respId = null;
      if (login) {
        const depto = String(l.departamento || '').trim();
        const d = depto ? get('SELECT id FROM departamentos WHERE nome = ?', depto) : null;
        if (depto && !d) { r.problemas.push(`linha ${n}: departamento "${depto}" não existe`); return; }
        const superiorId = loginSup ? pessoa(loginSup, String(l.nome_superior || '').trim().slice(0, 120), { departamentoId: d && d.id }) : null;
        respId = pessoa(login, String(l.nome_responsavel || '').trim().slice(0, 120), { matricula: String(l.matricula_responsavel || '').trim().slice(0, 20), departamentoId: d && d.id, superiorId });
      }
      if (atual) {
        run('UPDATE condominios SET codigo = ?, nome = ?, conta_papercut = COALESCE(?, conta_papercut), responsavel_id = COALESCE(?, responsavel_id) WHERE id = ?', codigo, nome, conta, respId, atual.id);
        // O novo gerente assume o que estava pendente com o gerente anterior; o que é de quem imprimiu fica com quem imprimiu.
        if (respId && atual.responsavel_id !== respId) {
          run("UPDATE lancamentos SET responsavel_id = ? WHERE condominio_id = ? AND status = 'pendente' AND (responsavel_id IS NULL OR responsavel_id = ?)", respId, atual.id, atual.responsavel_id || 0);
        }
        r.atualizados++;
      } else {
        run('INSERT INTO condominios (codigo, nome, conta_papercut, responsavel_id) VALUES (?,?,?,?)', codigo, nome, conta, respId);
        r.criados++;
      }
    });
    auditar(usuarioId, 'carga de condomínios', null, `${r.criados} criados, ${r.atualizados} atualizados, ${r.usuariosNovos} usuários novos, ${r.problemas.length} linhas com problema`);
  });
  return r;
}

module.exports = { carregarCondominios, COLUNAS };
