(() => {
  // Filtros: enviar ao trocar a opção.
  document.querySelectorAll('[data-enviar]').forEach((el) => {
    el.addEventListener('change', () => {
      if (!el.form) return;
      // Escolher um mês descarta o intervalo de datas digitado antes.
      (el.getAttribute('data-limpa') || '').split(',').filter(Boolean).forEach((n) => { const c = el.form.elements[n]; if (c) c.value = ''; });
      el.form.submit();
    });
  });

  // Confirmação antes de ações que não têm volta simples.
  document.querySelectorAll('[data-confirmar]').forEach((el) => {
    el.addEventListener('click', (ev) => {
      if (!window.confirm(el.getAttribute('data-confirmar'))) ev.preventDefault();
    });
  });

  // No celular o menu é uma faixa que rola de lado: deixa a página atual à vista.
  const ativoMenu = document.querySelector('.lateral nav a.ativo');
  if (ativoMenu && ativoMenu.parentElement.scrollWidth > ativoMenu.parentElement.clientWidth) {
    const nav = ativoMenu.parentElement;
    nav.scrollLeft = ativoMenu.offsetLeft - nav.offsetLeft - (nav.clientWidth - ativoMenu.offsetWidth) / 2;
  }

  document.querySelectorAll('[data-imprimir]').forEach((el) => el.addEventListener('click', () => window.print()));

  // Descrições padrão: lista suspensa própria no campo, no lugar da sugestão nativa do navegador
  // (que mistura textos digitados antes e não parece uma lista). O campo continua aceitando texto livre.
  const campos = [...document.querySelectorAll('input[list]')].filter((i) => document.getElementById(i.getAttribute('list')));
  if (campos.length) {
    const tirarAcento = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const lista = document.createElement('ul');
    lista.className = 'combo-lista';
    lista.id = 'combo-lista';
    lista.setAttribute('role', 'listbox');
    lista.hidden = true;
    document.body.appendChild(lista);
    let atual = null;
    let ativo = -1;
    let opcoesAtuais = [];

    const posicionar = () => {
      if (!atual) return;
      const r = atual.getBoundingClientRect();
      const abaixo = window.innerHeight - r.bottom;
      lista.style.left = `${r.left}px`;
      lista.style.width = `${Math.max(r.width, 240)}px`;
      if (abaixo < 220 && r.top > abaixo) { lista.style.top = ''; lista.style.bottom = `${window.innerHeight - r.top + 4}px`; lista.style.maxHeight = `${Math.min(288, r.top - 12)}px`; }
      else { lista.style.bottom = ''; lista.style.top = `${r.bottom + 4}px`; lista.style.maxHeight = `${Math.min(288, abaixo - 12)}px`; }
    };
    const marcar = (i) => {
      ativo = i;
      [...lista.children].forEach((li, n) => li.classList.toggle('ativo', n === i));
      const li = lista.children[i];
      if (li && li.getAttribute('role') === 'option') { atual.setAttribute('aria-activedescendant', li.id); li.scrollIntoView({ block: 'nearest' }); }
      else if (atual) atual.removeAttribute('aria-activedescendant');
    };
    const fechar = () => {
      lista.hidden = true;
      if (atual) { atual.setAttribute('aria-expanded', 'false'); atual.removeAttribute('aria-activedescendant'); atual.closest('.combo').classList.remove('aberto'); }
      ativo = -1;
    };
    const abrir = (input, filtrar) => {
      atual = input;
      const termo = filtrar ? tirarAcento(input.value.trim()) : '';
      opcoesAtuais = input._opcoes.filter((t) => !termo || tirarAcento(t).includes(termo));
      lista.textContent = '';
      if (!opcoesAtuais.length) { fechar(); return; }
      const titulo = document.createElement('li');
      titulo.className = 'combo-titulo';
      titulo.setAttribute('role', 'presentation');
      titulo.textContent = termo ? 'Descrições padrão parecidas' : 'Descrições padrão';
      lista.appendChild(titulo);
      opcoesAtuais.forEach((t, n) => {
        const li = document.createElement('li');
        li.id = `combo-op-${n}`;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(t === input.value.trim()));
        li.textContent = t;
        li.addEventListener('mousedown', (ev) => { ev.preventDefault(); escolher(t); });
        lista.appendChild(li);
      });
      lista.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      input.closest('.combo').classList.add('aberto');
      posicionar();
      const sel = opcoesAtuais.indexOf(input.value.trim());
      marcar(sel >= 0 ? sel + 1 : -1);
    };
    const escolher = (texto) => {
      atual.value = texto;
      atual.dispatchEvent(new Event('input', { bubbles: true }));
      atual.dispatchEvent(new Event('change', { bubbles: true }));
      fechar();
      atual.focus();
    };

    campos.forEach((input) => {
      input._opcoes = [...document.getElementById(input.getAttribute('list')).options].map((o) => o.value).filter(Boolean);
      input.removeAttribute('list');
      input.setAttribute('autocomplete', 'off');
      input.setAttribute('role', 'combobox');
      input.setAttribute('aria-autocomplete', 'list');
      input.setAttribute('aria-expanded', 'false');
      input.setAttribute('aria-controls', 'combo-lista');
      const caixa = document.createElement('span');
      caixa.className = 'combo';
      input.parentNode.insertBefore(caixa, input);
      caixa.appendChild(input);
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'combo-botao';
      botao.tabIndex = -1;
      botao.setAttribute('aria-label', 'Mostrar descrições padrão');
      caixa.appendChild(botao);
      botao.addEventListener('mousedown', (ev) => ev.preventDefault());
      botao.addEventListener('click', (ev) => {
        ev.preventDefault();
        if (!lista.hidden && atual === input) fechar(); else { input.focus(); abrir(input, false); }
      });
      input.addEventListener('click', () => { if (lista.hidden || atual !== input) abrir(input, false); });
      input.addEventListener('input', (ev) => { if (ev.isTrusted) abrir(input, true); });
      input.addEventListener('blur', () => { if (atual === input) fechar(); });
      input.addEventListener('keydown', (ev) => {
        const aberto = !lista.hidden && atual === input;
        const total = opcoesAtuais.length;
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
          ev.preventDefault();
          if (!aberto) { abrir(input, false); return; }
          const pos = ativo < 1 ? (ev.key === 'ArrowDown' ? 1 : total) : ((ativo - 1 + (ev.key === 'ArrowDown' ? 1 : total - 1)) % total) + 1;
          marcar(pos);
        } else if (ev.key === 'Enter' && aberto && ativo >= 1) {
          ev.preventDefault();
          escolher(opcoesAtuais[ativo - 1]);
        } else if (ev.key === 'Escape' && aberto) {
          ev.preventDefault();
          fechar();
        } else if (ev.key === 'Tab') fechar();
      });
    });
    window.addEventListener('resize', posicionar);
    document.addEventListener('scroll', () => { if (!lista.hidden) posicionar(); }, true);
  }

  // Liberação em lote.
  const lote = document.querySelector('[data-lote]');
  // Só quem confere (Contabilidade) tem o botão de liberar; para os demais, o formulário só salva correções.
  if (lote && lote.querySelector('[data-botao-lote]')) {
    const caixas = () => [...lote.querySelectorAll('input[name="ids"]')].filter((c) => !c.closest('tr').hidden);
    const todos = lote.querySelector('[data-marcar-todos]');
    const botao = lote.querySelector('[data-botao-lote]');
    const contagem = lote.querySelector('[data-contagem]');
    const atualizar = () => {
      const lista = caixas();
      const n = lista.filter((c) => c.checked).length;
      botao.disabled = n === 0;
      (botao.querySelector('[data-rotulo]') || botao).textContent = n ? `Salvar e liberar ${n} marcado${n > 1 ? 's' : ''}` : 'Salvar e liberar marcados';
      contagem.textContent = lista.length ? (n ? `${n} de ${lista.length} pendentes marcados` : `${lista.length} pendentes nesta lista`) : 'Nada pendente nesta lista';
      if (todos) { todos.checked = n > 0 && n === lista.length; todos.indeterminate = n > 0 && n < lista.length; todos.disabled = lista.length === 0; }
    };
    if (todos) todos.addEventListener('change', () => { caixas().forEach((c) => { c.checked = todos.checked; }); atualizar(); });
    lote.addEventListener('change', (ev) => { if (ev.target.name === 'ids') atualizar(); });
    lote.addEventListener('submit', (ev) => {
      if (!ev.submitter || ev.submitter.value !== 'liberar') return;
      const n = caixas().filter((c) => c.checked).length;
      if (!window.confirm(`Liberar ${n} lançamento(s)? Depois de liberados eles deixam de ser editáveis.`)) ev.preventDefault();
    });
    atualizar();
  }
})();

// Nome sempre em MAIÚSCULAS e e-mail sempre em minúsculas, já enquanto a pessoa digita.
(() => {
  const ajustar = (el) => {
    const novo = el.dataset.caixa === 'alta' ? el.value.toLocaleUpperCase('pt-BR') : el.value.toLocaleLowerCase('pt-BR');
    if (novo === el.value) return;
    const pos = el.selectionStart;
    el.value = novo;
    try { el.setSelectionRange(pos, pos); } catch { /* campos de e-mail não aceitam cursor */ }
  };
  document.querySelectorAll('input[data-caixa]').forEach((el) => {
    el.addEventListener('input', () => ajustar(el));
    ajustar(el);
  });
})();

// Valor do lançamento recalculado na hora em que a quantidade muda (o servidor confirma ao salvar).
(() => {
  const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  document.querySelectorAll('input.qtd[data-preco]').forEach((campo) => {
    const celula = campo.closest('tr').querySelector('[data-valor]');
    if (!celula) return;
    campo.addEventListener('input', () => {
      const q = /^\d{1,7}$/.test(campo.value.trim()) ? parseInt(campo.value, 10) : null;
      const antes = Number(celula.dataset.valor);
      const novo = q === null ? antes : q * Number(campo.dataset.preco);
      celula.textContent = q === null ? '—' : brl(novo);
      celula.classList.toggle('alterado', novo !== Number(celula.dataset.original ?? (celula.dataset.original = antes)));
      celula.dataset.valor = novo;
      const total = campo.closest('tbody').querySelector('[data-total-grupo]');
      if (total) { total.dataset.totalGrupo = Number(total.dataset.totalGrupo) - antes + novo; total.textContent = brl(Number(total.dataset.totalGrupo)); }
    });
  });
})();

// Ordenação pelos títulos das colunas das tabelas marcadas com data-ordenar.
// Clique ordena do menor para o maior; o segundo clique inverte. Em tabelas agrupadas por condomínio,
// a ordem vale dentro de cada condomínio, e os grupos continuam no lugar.
(() => {
  const textoCelula = (td) => {
    if (!td) return '';
    const campo = td.querySelector('input:not([type=checkbox]), select');
    return (campo ? campo.value : td.textContent).replace(/\s+/g, ' ').trim();
  };
  // Converte o texto da célula em algo comparável: data, número (R$ 1.234,56 · 1.440 · 12) ou texto.
  const chave = (t) => {
    const d = /^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2}))?/.exec(t);
    if (d) return { tipo: 0, v: Number(d[3] + d[2] + d[1] + (d[4] || '00') + (d[5] || '00')) };
    const n = /^-?(?:R\$\s*)?[\d.]+(?:,\d+)?$/.test(t) ? Number(t.replace(/R\$\s*/, '').replace(/\./g, '').replace(',', '.')) : NaN;
    if (!Number.isNaN(n)) return { tipo: 0, v: n };
    return { tipo: 1, v: t };
  };
  const comparar = (a, b) => {
    if (a.v === '' && b.v !== '') return 1;
    if (b.v === '' && a.v !== '') return -1;
    if (a.tipo !== b.tipo) return a.tipo - b.tipo;
    return a.tipo === 0 ? a.v - b.v : a.v.localeCompare(b.v, 'pt-BR', { numeric: true, sensitivity: 'base' });
  };
  document.querySelectorAll('table[data-ordenar]').forEach((tabela) => {
    const titulos = [...tabela.tHead.rows[0].cells];
    titulos.forEach((th, i) => {
      const nome = th.textContent.trim();
      if (!nome || th.hasAttribute('data-sem-ordem')) return;
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'ordenar';
      botao.innerHTML = th.innerHTML;
      botao.title = 'Ordenar por ' + nome.toLowerCase();
      th.textContent = '';
      th.appendChild(botao);
      botao.addEventListener('click', () => {
        const crescente = th.getAttribute('aria-sort') !== 'ascending';
        titulos.forEach((t) => t.removeAttribute('aria-sort'));
        th.setAttribute('aria-sort', crescente ? 'ascending' : 'descending');
        for (const corpo of tabela.tBodies) {
          const linhas = [...corpo.rows].filter((tr) => !tr.classList.contains('grupo') && tr.cells.length === titulos.length);
          linhas
            .map((tr, pos) => ({ tr, pos, k: chave(textoCelula(tr.cells[i])) }))
            // Empate mantém a ordem original, para a ordenação ser previsível.
            .sort((a, b) => (crescente ? comparar(a.k, b.k) : comparar(b.k, a.k)) || a.pos - b.pos)
            .forEach(({ tr }) => corpo.appendChild(tr));
        }
      });
    });
  });
})();
