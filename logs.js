'use strict';

// Matrícula do autor do projeto (não é uma senha).
const STUDENT_ID = '461405';
const LOG_API = 'https://www.piway.com.br/unoesc/api';
const pendingLogs = new Set();
let logListVersion = 0;

function studentId() {
  if (!/^\d+$/.test(STUDENT_ID)) throw new Error('A matrícula do autor ainda não foi configurada.');
  return STUDENT_ID;
}

// A documentação fornece rotas GET inclusive para inserir e excluir.
async function requestLogApi(parts) {
  const url = `${LOG_API}/${parts.map((part) => encodeURIComponent(String(part))).join('/')}`;
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`A API de logs retornou HTTP ${response.status}.`);
  const text = (await response.text()).trim();
  let result;
  try { result = JSON.parse(text); } catch { result = text; }
  if (typeof result === 'string' && /inválida|invalida|erro/i.test(result)) throw new Error(result);
  return result;
}

// A mensagem pode vir como texto, objeto ou array JSON. Não considerar
// somente HTTP 200 como sucesso: a API também o usa para mensagens de erro.
function mutationMessages(result) {
  if (typeof result === 'string') return [result];
  if (Array.isArray(result)) return result.flatMap(mutationMessages);
  if (result && typeof result === 'object') return Object.values(result).flatMap(mutationMessages);
  return [];
}

function confirmLogMutation(result, action) {
  const messages = mutationMessages(result);
  const normalize = (text) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ').trim().toLowerCase().replace(/[.!]+$/, '').trim();
  const expected = `1 log foi ${action}`;
  if (messages.some((message) => normalize(message) === expected)) return;
  const detail = (messages.join(' · ') || JSON.stringify(result) || 'resposta vazia').slice(0, 400);
  throw new Error(`Resposta da API: ${detail}`);
}

function registerDeezerLog(path, result) {
  const task = (async () => {
    const enrollment = studentId();
    let method;
    let summary;
    if (path === '/chart') {
      method = 'Listar destaques';
      summary = `${result.tracks?.data?.length ?? 0} músicas retornadas`;
    } else if (path === '/search') {
      method = 'Buscar músicas';
      summary = `${result.data?.length ?? 0} músicas retornadas`;
    } else {
      method = 'Consultar álbum';
      summary = `Álbum: ${String(result.title || 'Sem título').slice(0, 120)}; ${result.nb_tracks ?? result.tracks?.data?.length ?? 0} faixas`;
    }
    const response = await requestLogApi(['inserir', 'log', enrollment, 'Deezer', method, summary]);
    confirmLogMutation(response, 'inserido');
  })();
  pendingLogs.add(task);
  task.catch((error) => {
    document.querySelector('#log-warning').textContent = `Os dados da Deezer foram recebidos, mas não foi possível confirmar o registro do log: ${error.message}`;
    document.querySelector('#log-warning').hidden = false;
  }).finally(() => pendingLogs.delete(task));
}

function logId(log) {
  const key = Object.keys(log).find((name) => ['id', 'idlog', 'id_log'].includes(name.toLowerCase()));
  return key === undefined ? null : log[key];
}

function renderLogs(logs) {
  const list = document.querySelector('#log-list');
  list.replaceChildren();
  logs.forEach((log) => {
    if (!log || typeof log !== 'object' || Array.isArray(log)) throw new Error('Formato de registro de log inválido.');
    const card = element('article', 'log-entry border rounded p-3 mb-3');
    // A documentação não fixa os nomes dos campos: mostramos todos os retornados.
    const details = element('dl', 'row mb-2');
    Object.entries(log).forEach(([key, value]) => {
      details.append(element('dt', 'col-sm-3', key), element('dd', 'col-sm-9', typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')));
    });
    card.append(details);
    const id = logId(log);
    if (id !== null && id !== undefined && String(id) !== '') {
      const remove = element('button', 'btn btn-outline-danger btn-sm', 'Excluir log');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Excluir log ${id}`);
      remove.addEventListener('click', () => deleteLog(id, remove));
      card.append(remove);
    } else {
      card.append(element('p', 'text-warning mb-0', 'A API não retornou um identificador reconhecido para excluir este registro.'));
    }
    list.append(card);
  });
}

async function loadLogs(message = '') {
  const version = ++logListVersion;
  const status = document.querySelector('#log-status');
  const refresh = document.querySelector('#refresh-logs');
  refresh.disabled = true;
  status.textContent = 'Carregando histórico…';
  document.querySelector('#log-list').replaceChildren();
  try {
    const enrollment = studentId();
    // Ao abrir o histórico, aguarda as inserções já iniciadas.
    await Promise.allSettled([...pendingLogs]);
    const logs = await requestLogApi(['logs', enrollment]);
    if (version !== logListVersion) return;
    if (!Array.isArray(logs)) throw new Error(typeof logs === 'string' ? logs : 'A API não retornou uma lista de logs.');
    renderLogs(logs);
    status.textContent = `${message ? message + ' ' : ''}${logs.length ? `${logs.length} logs registrados.` : 'Nenhum log registrado.'}`;
  } catch (error) {
    if (version === logListVersion) status.textContent = `Não foi possível carregar o histórico: ${error.message}`;
  } finally {
    if (version === logListVersion) refresh.disabled = false;
  }
}

async function deleteLog(id, button) {
  button.disabled = true;
  button.textContent = 'Excluindo…';
  try {
    const result = await requestLogApi(['excluir', 'log', id, 'aluno', studentId()]);
    confirmLogMutation(result, 'excluido');
    await loadLogs('Log excluído.');
  } catch (error) {
    document.querySelector('#log-status').textContent = `Não foi possível excluir: ${error.message}`;
    button.disabled = false;
    button.textContent = 'Excluir log';
  }
}

let logPreviousFocus;
document.querySelector('#show-logs').addEventListener('click', () => {
  logPreviousFocus = document.activeElement;
  document.querySelector('#logs-dialog').showModal();
  loadLogs();
});
document.querySelector('#refresh-logs').addEventListener('click', () => loadLogs());
document.querySelector('#close-logs').addEventListener('click', () => document.querySelector('#logs-dialog').close());
document.querySelector('#logs-dialog').addEventListener('close', () => logPreviousFocus?.focus());
