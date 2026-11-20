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

module.exports = { dataValida, nomeMaiusculo, emailMinusculo, emailValido, perfilIncompleto, descricaoPadrao, descricaoValida };
