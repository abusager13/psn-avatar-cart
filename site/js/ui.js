// Rendering only. Everything here takes data and returns DOM; no network.

import { closureFor } from './catalog.js';

const DAY = 86400000;

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

const code = (text) =>
  `<code class="rounded bg-base-300 px-1.5 py-0.5 font-mono text-[0.85em]">${esc(text)}</code>`;

export function renderChips(container, regions, current, onPick) {
  container.innerHTML = '';
  for (const { code: region, name } of regions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `btn btn-xs ${region === current ? 'btn-primary' : 'btn-ghost'}`;
    button.textContent = region;
    button.title = name;
    button.setAttribute('aria-pressed', String(region === current));
    button.addEventListener('click', () => onPick(region));
    container.appendChild(button);
  }
}

export function renderMessage(node, text, kind = 'info') {
  if (!text) {
    node.className = 'hidden';
    node.textContent = '';
    return;
  }
  node.className = `alert ${kind === 'error' ? 'alert-error' : 'alert-info'} py-2.5 text-sm whitespace-pre-line`;
  node.textContent = text;
}

export function renderEmpty(card) {
  card.className = 'rounded-box border border-dashed border-white/10 bg-base-300/30';
  card.innerHTML = `
    <div class="flex flex-col gap-1 p-6">
      <strong class="text-sm">Nothing resolved yet</strong>
      <span class="text-sm text-base-content/60">
        Pick your store region, then paste a PSNA hash or SKU — or open a ${code('.edat')} file.
        Try <button class="link link-primary link-hover" id="example" type="button">an example</button>.
      </span>
    </div>`;
  card.querySelector('#example')?.addEventListener('click', () => {
    document.getElementById('input').value = 'UP1004-BLUS30418_00-AVARDRSHADOWWOLF';
    document.getElementById('go').click();
  });
}

export function renderCard(card, data, note, handlers) {
  card.className = 'card border border-white/5 bg-base-300/40';
  const source = data.twinOf
    ? `Same avatar as “${data.twinOf}” (${data.twinHome} listing)`
    : [data.game, data.source].filter(Boolean).join(' · ');

  card.innerHTML = `
    <div class="card-body gap-4">
      ${note ? `<div class="alert alert-info py-2 text-xs">${esc(note)}</div>` : ''}
      <div class="flex flex-col gap-4 sm:flex-row">
        ${data.image
          ? `<img class="h-28 w-28 shrink-0 rounded-box border border-white/5 object-cover" src="${esc(data.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
          : '<div class="h-28 w-28 shrink-0 rounded-box border border-white/5 bg-base-300"></div>'}
        <div class="flex min-w-0 flex-col gap-1">
          <h3 class="truncate text-lg font-semibold leading-tight">${esc(data.name)}</h3>
          <p class="text-xs text-base-content/55">${esc(data.platform)} · ${esc(data.region)}</p>
          <p class="text-2xl font-semibold ${data.price === 'Free' ? 'text-success' : 'text-primary'}">${esc(data.price)}</p>
          <p class="truncate font-mono text-[11px] text-base-content/45">${esc(data.baseSku)}</p>
          <p class="text-xs text-base-content/45">${esc(source)}</p>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <a class="btn btn-primary btn-sm" href="${esc(data.link)}" target="_blank" rel="noopener noreferrer">Add to cart ↗</a>
        <button class="btn btn-ghost btn-sm" type="button" data-act="copy">Copy cart link</button>
        <button class="btn btn-ghost btn-sm" type="button" data-act="share">Copy page link</button>
        <span class="text-[11px] text-base-content/40">Opens Sony's checkout — be signed in to your PlayStation account.</span>
      </div>
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
    if (row.status === 'checking') status = '<span class="badge badge-ghost badge-sm">checking…</span>';
    else if (row.status === 'yes') status = '<span class="badge badge-success badge-sm">sold</span>';
    else if (row.status === 'twin') status = '<span class="badge badge-warning badge-sm">same avatar</span>';
    else status = '<span class="badge badge-sm border-white/10 bg-base-300 text-base-content/40">not sold</span>';

    const price = row.price ? esc(row.price) : '—';
    const action = row.link && row.status !== 'checking'
      ? `<a class="link link-primary text-xs" href="${esc(row.link)}" target="_blank" rel="noopener noreferrer">open ↗</a>`
      : '';

    const info = closureFor(row.region);
    const daysLeft = Math.floor((Date.parse(info.target) - now) / DAY);
    const closes = daysLeft > 0 ? `${info.label} · ${daysLeft}d` : 'closed';

    tr.innerHTML = `<td>
        <span class="font-medium">${esc(label)}</span>
        <span class="ml-1 font-mono text-[11px] text-base-content/40">${esc(row.region)}</span>
        <span class="block text-[11px] text-base-content/35" title="${esc(info.note)}">closes ${esc(closes)}</span>
      </td>
      <td>${status}</td>
      <td class="font-mono text-xs">${price}</td>
      <td class="text-right">${action}</td>`;
    tbody.appendChild(tr);
  }
}

export function renderRecent(container, items, onPick, onClear) {
  container.innerHTML = '';
  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'flex items-center gap-3 rounded-box border border-white/5 bg-base-200 p-2 text-left transition hover:border-white/15 hover:bg-base-300/60';
    button.innerHTML = `
      ${item.image
        ? `<img class="h-10 w-10 shrink-0 rounded object-cover" src="${esc(item.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
        : '<span class="h-10 w-10 shrink-0 rounded bg-base-300"></span>'}
      <span class="min-w-0">
        <strong class="block truncate text-sm font-medium">${esc(item.name)}</strong>
        <small class="block truncate text-[11px] text-base-content/45">${esc(item.region)} · ${esc(item.price || '')}</small>
      </span>`;
    button.addEventListener('click', () => onPick(item));
    container.appendChild(button);
  }
  const clear = document.getElementById('recent-clear');
  if (clear) clear.onclick = onClear;
}

export function setRecentVisible(section, visible) {
  section.classList.toggle('hidden', !visible);
  section.classList.toggle('flex', visible);
}
