'use strict';

// A Deezer fornece JSONP para consultas públicas. A origem e os endpoints
// são fixos; termos digitados são codificados por URLSearchParams.
const API = 'https://api.deezer.com';
let callbackSequence = 0;
function requestDeezer(path, params = {}) {
  return new Promise((resolve, reject) => {
    const callback = `deezerCallback${++callbackSequence}`;
    const script = document.createElement('script');
    const url = new URL(path, API);
    url.search = new URLSearchParams({ ...params, output: 'jsonp', callback });
    let timer;
    function cleanup() {
      clearTimeout(timer);
      script.remove();
      // Uma resposta atrasada não deve provocar um erro global.
      window[callback] = () => {};
      setTimeout(() => delete window[callback], 60000);
    }
    window[callback] = (result) => {
      cleanup();
      if (!result || result.error) {
        reject(new Error('A Deezer não conseguiu retornar os dados. Tente novamente.'));
      } else resolve(result);
    };
    script.onerror = () => {
      cleanup();
      reject(new Error('Não foi possível conectar à Deezer. Verifique sua conexão e tente novamente.'));
    };
    timer = setTimeout(() => {
      cleanup();
      reject(new Error('A Deezer demorou para responder. Tente novamente em instantes.'));
    }, 15000);
    script.src = url.href;
    document.head.append(script);
  });
}

const $ = (selector) => document.querySelector(selector);
const grid = $('#tracks');
const status = $('#status');
const actions = $('#actions');
let catalogVersion = 0;
let albumVersion = 0;
let previousFocus;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function safeURL(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return url.href;
  } catch { /* Dados ausentes não devem criar URLs inválidas. */ }
  return '';
}
function image(url, alt) {
  const img = element('img');
  const fallback = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><rect width="300" height="300" fill="#251d30"/><circle cx="150" cy="150" r="90" fill="#1d1728" stroke="#574267"/><circle cx="150" cy="150" r="35" fill="#ba93ff"/><circle cx="150" cy="150" r="6" fill="#1d1728"/></svg>');
  const source = safeURL(url);
  img.src = source || fallback;
  img.alt = alt;
  img.loading = 'lazy';
  img.addEventListener('error', () => { img.src = fallback; }, { once: true });
  return img;
}
function trackCard(track, index) {
  const card = element('article', 'track-card col');
  const cover = element('button', 'cover-button');
  cover.type = 'button';
  cover.setAttribute('aria-label', `Ver álbum ${track.album?.title || 'da faixa'}`);
  cover.append(image(track.album?.cover_medium, `Capa de ${track.album?.title || 'álbum'}`), element('span', 'cover-label', 'Explorar álbum ↗'));
  cover.disabled = !track.album?.id;
  cover.addEventListener('click', () => openAlbum(track.album.id));
  const heading = element('div', 'track-heading d-flex align-items-start gap-2');
  heading.append(element('span', 'rank', String(index + 1).padStart(2, '0')));
  const text = element('div', 'track-text');
  const title = element('h3', '', track.title || 'Sem título');
  title.title = track.title || '';
  text.append(title, element('p', '', track.artist?.name || 'Artista desconhecido'));
  heading.append(text);
  card.append(cover, heading);
  return card;
}
function retryButton(action) {
  const button = element('button', 'btn btn-outline-secondary secondary', 'Tentar novamente');
  button.type = 'button';
  button.addEventListener('click', action);
  return button;
}
async function loadCatalog(term = '') {
  const version = ++catalogVersion;
  grid.replaceChildren();
  actions.replaceChildren();
  $('#catalog-title').textContent = term ? `Resultados para “${term}”` : 'Em alta na Deezer';
  $('#section-kicker').textContent = term ? 'SUA BUSCA' : 'NO RADAR';
  $('#catalog-description').textContent = term
    ? 'Até 20 resultados. Clique em uma capa para ver o álbum.'
    : 'Ranking geral da Deezer, sem filtro de país ou gênero.';
  $('#show-chart').hidden = !term;
  status.textContent = 'Carregando músicas…';
  grid.setAttribute('aria-busy', 'true');
  try {
    const result = term
      ? await requestDeezer('/search', { q: term, limit: 20 })
      : await requestDeezer('/chart');
    if (version !== catalogVersion) return;
    const tracks = term ? result.data : result.tracks?.data;
    if (!Array.isArray(tracks)) throw new Error('A Deezer retornou um formato inesperado. Tente novamente.');
    grid.append(...tracks.map(trackCard));
    status.textContent = tracks.length
      ? `${tracks.length} músicas ${term ? 'encontradas' : 'em destaque'}.`
      : 'Nenhuma música encontrada. Experimente outro nome de música ou artista.';
  } catch (error) {
    if (version !== catalogVersion) return;
    status.textContent = error.message;
    actions.append(retryButton(() => loadCatalog(term)));
  } finally {
    if (version === catalogVersion) grid.setAttribute('aria-busy', 'false');
  }
}
function duration(seconds) {
  const value = Number.isFinite(Number(seconds)) ? Math.max(0, Number(seconds)) : 0;
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
}
async function openAlbum(id) {
  const version = ++albumVersion;
  const dialog = $('#album-dialog');
  const content = $('#album-content');
  if (!dialog.open) {
    previousFocus = document.activeElement;
    dialog.showModal();
  }
  content.replaceChildren(element('h2', '', 'Carregando álbum…'));
  content.firstChild.id = 'album-title';
  try {
    const album = await requestDeezer(`/album/${encodeURIComponent(id)}`);
    if (version !== albumVersion || !dialog.open) return;
    const header = element('div', 'album-header');
    const info = element('div');
    const title = element('h2', '', album.title || 'Álbum');
    title.id = 'album-title';
    const date = album.release_date ? String(album.release_date).split('-').reverse().join('/') : 'Data não informada';
    info.append(element('p', 'eyebrow', 'POR DENTRO DO ÁLBUM'), title, element('p', '', `${album.artist?.name || 'Artista desconhecido'} · ${date}`), element('p', '', `${album.nb_tracks ?? album.tracks?.data?.length ?? 0} faixas · ${duration(album.duration)}`));
    const link = safeURL(album.link);
    if (link) {
      const external = element('a', 'btn btn-outline-secondary secondary', 'Abrir na Deezer ↗');
      external.href = link;
      external.target = '_blank';
      external.rel = 'noopener noreferrer';
      info.append(external);
    }
    header.append(image(album.cover_medium, `Capa de ${album.title || 'álbum'}`), info);
    const list = element('ol', 'album-list');
    const tracks = album.tracks?.data || [];
    tracks.forEach((track, index) => {
      const row = element('li');
      row.append(element('span', 'rank', String(index + 1).padStart(2, '0')), element('span', 'song-name', track.title || 'Sem título'), element('span', 'song-duration', duration(track.duration)));
      list.append(row);
    });
    content.replaceChildren(header, element('h3', '', 'Faixas do álbum'), list);
    if (!tracks.length) content.append(element('p', '', 'Não há faixas disponíveis para este álbum.'));
    if (album.tracks?.next) content.append(element('p', '', 'Esta é uma seleção das faixas. Veja o álbum completo na Deezer.'));
  } catch (error) {
    if (version !== albumVersion || !dialog.open) return;
    const title = element('h2', '', 'Não foi possível carregar o álbum');
    title.id = 'album-title';
    content.replaceChildren(title, element('p', '', error.message), retryButton(() => openAlbum(id)));
  }
}
$('#search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const term = $('#query').value.trim();
  if (term) loadCatalog(term);
});
$('#show-chart').addEventListener('click', () => {
  $('#query').value = '';
  loadCatalog();
});
$('#close-dialog').addEventListener('click', () => $('#album-dialog').close());
$('#album-dialog').addEventListener('close', () => {
  albumVersion++;
  previousFocus?.focus();
});
loadCatalog();
