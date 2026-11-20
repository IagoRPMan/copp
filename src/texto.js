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

module.exports = { nomeMaiusculo, emailMinusculo, emailValido, perfilIncompleto, descricaoPadrao, descricaoValida };
