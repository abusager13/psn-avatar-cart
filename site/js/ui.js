// Rendering only. Everything here takes data and returns DOM; no network.

import { closureFor } from './catalog.js';

const DAY = 86400000;

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

export function renderChips(container, regions, current, onPick) {
  container.innerHTML = '';
  for (const { code, name } of regions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `chip${code === current ? ' active' : ''}`;
    button.textContent = code;
    button.title = name;
    button.setAttribute('aria-pressed', String(code === current));
    button.addEventListener('click', () => onPick(code));
    container.appendChild(button);
  }
}

export function renderMessage(node, text, kind = 'info') {
  if (!text) {
    node.className = 'message hidden';
    node.textContent = '';
    return;
  }
  node.className = `message ${kind === 'error' ? 'error' : 'info'}`;
  node.textContent = text;
}

export function renderEmpty(card) {
  card.className = 'card empty';
  card.innerHTML = `
    <div class="empty-inner">
      <strong>Nothing resolved yet</strong>
      <span>Pick your store region, then paste a PSNA hash or SKU — or open a <code>.edat</code> file.</span>
    </div>`;
}

export function renderCard(card, data, note, handlers) {
  card.className = 'card';
  const source = data.twinOf
    ? `Same avatar as “${data.twinOf}” (${data.twinHome} listing)`
    : [data.game, data.source].filter(Boolean).join(' · ');

  card.innerHTML = `
    ${note ? `<p class="card-note">${esc(note)}</p>` : ''}
    <div class="top">
      ${data.image
        ? `<img class="thumb" src="${esc(data.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
        : '<div class="thumb"></div>'}
      <div class="meta">
        <h3 class="name">${esc(data.name)}</h3>
        <p class="line">${esc(data.platform)} · ${esc(data.region)}</p>
        <p class="price${data.price === 'Free' ? ' free' : ''}">${esc(data.price)}</p>
        <p class="sku">${esc(data.baseSku)}</p>
        <p class="source">${esc(source)}</p>
      </div>
    </div>
    <div class="actions">
      <a class="btn primary" href="${esc(data.link)}" target="_blank" rel="noopener noreferrer">Add to cart ↗</a>
      <button class="btn ghost" type="button" data-act="copy">Copy cart link</button>
      <button class="btn ghost" type="button" data-act="share">Copy page link</button>
      <span class="hint">Opens PlayStation's checkout in a new tab.</span>
    </div>`;

  card.querySelector('[data-act="copy"]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const ok = await handlers.copy(data.link);
    button.textContent = ok ? 'Copied ✓' : 'Copy failed';
    setTimeout(() => { button.textContent = 'Copy cart link'; }, 1600);
  });
  card.querySelector('[data-act="share"]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const ok = await handlers.copyShare();
    button.textContent = ok ? 'Copied ✓' : 'Copy failed';
    setTimeout(() => { button.textContent = 'Copy page link'; }, 1600);
  });
}

/** Live countdown for the selected store. */
export function renderCountdown(node, code, now = Date.now()) {
  if (!node) return;
  const info = closureFor(code);
  const left = Date.parse(info.target) - now;
  const text = node.querySelector('.cd-text');
  const clock = node.querySelector('.cd-clock');
  const note = node.querySelector('.cd-note');

  text.textContent = `PS3 store ${left > 0 ? 'closes' : 'closed'} ${info.label} · ${code}`;
  node.classList.toggle('closed', left <= 0);

  if (left <= 0) {
    clock.textContent = 'closed';
  } else {
    const days = Math.floor(left / DAY);
    const h = Math.floor((left % DAY) / 3600000);
    const m = Math.floor((left % 3600000) / 60000);
    const sec = Math.floor((left % 60000) / 1000);
    clock.textContent = `${days}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`;
  }
  note.textContent = info.note;
}

export function renderRegionRows(tbody, rows, regionNames, now = Date.now()) {
  tbody.innerHTML = '';
  for (const row of rows) {
    const tr = document.createElement('tr');
    const label = regionNames[row.region] || row.region;
    let status;
    if (row.status === 'checking') status = '<span class="status checking">checking…</span>';
    else if (row.status === 'yes') status = '<span class="status yes">sold</span>';
    else if (row.status === 'twin') status = '<span class="status twin">same avatar</span>';
    else status = '<span class="status no">not sold</span>';

    const price = row.price ? esc(row.price) : '—';
    const action = row.link && row.status !== 'checking'
      ? `<a class="mini" href="${esc(row.link)}" target="_blank" rel="noopener noreferrer">open ↗</a>`
      : '';

    const info = closureFor(row.region);
    const daysLeft = Math.floor((Date.parse(info.target) - now) / DAY);
    const closes = daysLeft > 0 ? `${info.label} · ${daysLeft}d` : 'closed';

    tr.className = `row-${row.status}`;
    tr.innerHTML = `<td class="r">${esc(label)} <span class="code">${esc(row.region)}</span>
        <span class="closes" title="${esc(info.note)}">closes ${esc(closes)}</span></td>
      <td>${status}</td>
      <td class="p">${price}</td>
      <td class="a">${action}</td>`;
    tbody.appendChild(tr);
  }
}

export function renderRecent(container, items, onPick, onClear) {
  container.innerHTML = '';
  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'recent-item';
    button.innerHTML = `
      ${item.image ? `<img src="${esc(item.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="dot"></span>'}
      <span class="rt">
        <strong>${esc(item.name)}</strong>
        <small>${esc(item.region)} · ${esc(item.price || '')}</small>
      </span>`;
    button.addEventListener('click', () => onPick(item));
    container.appendChild(button);
  }
  const clear = document.getElementById('recent-clear');
  if (clear) clear.onclick = onClear;
}

export function setRecentVisible(section, visible) {
  section.classList.toggle('hidden', !visible);
}
