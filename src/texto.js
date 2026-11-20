// Padrão dos cadastros de pessoas: nome sempre em MAIÚSCULAS e e-mail sempre em minúsculas.
const nomeMaiusculo = (v) => String(v || '').replace(/\s+/g, ' ').trim().toLocaleUpperCase('pt-BR');
const emailMinusculo = (v) => String(v || '').replace(/\s+/g, '').toLocaleLowerCase('pt-BR');
const emailValido = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) && v.length <= 160;
// Enquanto o nome for só o login (como chega do PaperCut) ou faltar o e-mail, a pessoa precisa completar os dados.
const perfilIncompleto = (u) => !u.email || nomeMaiusculo(u.nome) === nomeMaiusculo(u.login);

// Descrição de lançamento: MAIÚSCULAS, sem espaço sobrando e sem pontuação solta no fim.
const descricaoPadrao = (v) => String(v || '').replace(/\s+/g, ' ').trim().replace(/[\s.,;:\-–]+$/, '').toLocaleUpperCase('pt-BR').slice(0, 300);
// Pelo menos 3 letras: "." ou "1" não dizem o que foi impresso.
const descricaoValida = (v) => (String(v || '').match(/\p{L}/gu) || []).length >= 3;

// Data AAAA-MM-DD que existe no calendário. Date.parse aceita 31/02 e o converte em 03/03; aqui, não.
const dataValida = (v) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

/**
 * Valor em reais digitado no formato brasileiro ("12,50", "1.234,56", "0,38") → centavos.
 * Aceita também ponto decimal ("12.50") vindo de versões antigas. Devolve null se não for um valor ou passar de "max" centavos.
 */
const centavosDeReais = (v, max = 99999999) => {
  let s = String(v ?? '').trim().replace(/^R\$\s*/, '');
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) s = s.replace(/\./g, '');
  else if (/^\d+\.\d{1,2}$/.test(s)) s = s.replace('.', ',');
  const m = /^(\d+)(?:,(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const c = parseInt(m[1], 10) * 100 + parseInt((m[2] || '0').padEnd(2, '0'), 10);
  return c <= max ? c : null;
};

module.exports = { centavosDeReais, dataValida, nomeMaiusculo, emailMinusculo, emailValido, perfilIncompleto, descricaoPadrao, descricaoValida };
