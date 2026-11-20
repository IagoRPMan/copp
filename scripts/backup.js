// Cópia de segurança do banco. Pode rodar com o sistema no ar.
// Uso: node scripts/backup.js   (guarda os 30 arquivos mais recentes em data/backups)
const fs = require('fs');
const path = require('path');
const { db, DATA_DIR } = require('../src/db');

const pasta = path.join(DATA_DIR, 'backups');
fs.mkdirSync(pasta, { recursive: true });
const d = new Date();
const p = (n) => String(n).padStart(2, '0');
const nome = `copp-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.db`;
const destino = path.join(pasta, nome);
db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);

const antigos = fs.readdirSync(pasta).filter((f) => /^copp-\d{8}-\d{6}\.db$/.test(f)).sort().reverse().slice(30);
antigos.forEach((f) => fs.unlinkSync(path.join(pasta, f)));
console.log(`Backup gravado em ${destino}` + (antigos.length ? ` (${antigos.length} antigo(s) removido(s))` : ''));
