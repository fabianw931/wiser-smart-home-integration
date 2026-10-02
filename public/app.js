const $ = id => document.getElementById(id);
let connected = false;
let busy = false;
let disconnecting = false;
let timer;
let epoch = 0;
let controller;
const resources = ['info', 'rooms', 'devices', 'sensors', 'hvacgroups', 'hvacgroups/state'];
const panels = new Map();

function text(tag, content, className) {
  const node = document.createElement(tag);
  node.textContent = content;
  if (className) node.className = className;
  return node;
}
for (const resource of resources) {
  const details = document.createElement('details');
  details.append(text('summary', resource));
  const content = text('pre', 'Not loaded.');
  details.append(content);
  $('resources').append(details);
  panels.set(resource, content);
}
function controls() {
  $('disconnect').disabled = disconnecting;
  $('connect').querySelectorAll('button, input').forEach(el => { el.disabled = busy || connected; });
  $('refresh').disabled = busy || !connected;
  $('loads').querySelectorAll('button, input').forEach(el => { el.disabled = busy || !connected; });
}
async function api(path, method = 'GET', payload) {
  controller = new AbortController();
  const current = controller;
  const timeout = setTimeout(() => current.abort(), path === '/api/connect' ? 60000 : 15000);
  try {
    const response = await fetch(path, {
      method, signal: current.signal, cache: 'no-store',
      headers: { 'X-Wiser-Client': 'local-poc', ...(payload ? { 'Content-Type': 'application/json' } : {}) },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(result.error || 'Request failed.');
      error.status = response.status;
      throw error;
    }
    return result;
  } finally {
    clearTimeout(timeout);
    if (controller === current) controller = null;
  }
}
function schedule() {
  clearTimeout(timer);
  if (connected) timer = setTimeout(refresh, 30000);
}
async function operation(action) {
  if (busy) return;
  clearTimeout(timer);
  busy = true;
  controls();
  $('error').textContent = '';
  const current = epoch;
  try { await action(current); } catch (error) {
    if (current === epoch) {
      $('error').textContent = error.name === 'AbortError' ? 'Request timed out or was cancelled.' : error.message;
      $('status').textContent = connected ? 'Gateway connection error — retry refresh or reconnect.' : 'Disconnected — connection failed.';
    }
  } finally {
    if (current === epoch) { busy = false; controls(); schedule(); }
  }
}
function button(label, action) {
  const el = text('button', label);
  el.type = 'button';
  el.addEventListener('click', action);
  return el;
}
function renderLoads(loads, states, stateError) {
  $('loads').replaceChildren();
  if (!loads.length) $('loads').append(text('p', 'No loads reported by this gateway.'));
  const byId = new Map(Array.isArray(states) ? states.map(item => [String(item.id), item.state]) : []);
  for (const load of loads) {
    const article = document.createElement('article');
    article.append(text('h3', load.name || `Load ${load.id}`),
      text('p', `ID ${load.id} · ${load.type} · device ${load.device ?? 'unknown'} · channel ${load.channel ?? 'unknown'}${load.unused ? ' · unused' : ''}`, 'muted'),
      text('pre', stateError ? `State unavailable: ${stateError}` : JSON.stringify(byId.get(String(load.id)) ?? 'State not reported', null, 2)));
    if (!load.unused && ['onoff', 'dim', 'motor'].includes(load.type)) {
      const actions = document.createElement('div');
      actions.className = 'actions';
      const motor = load.type === 'motor';
      const field = motor ? 'level' : 'bri';
      const write = value => operation(async current => {
        await api(`/api/loads/${load.id}/target_state`, 'PUT', { [field]: value });
        if (current !== epoch) return;
        $('status').textContent = 'Target accepted; refreshing reported state…';
        await loadAll(current, false);
      });
      actions.append(button(motor ? 'Open (0)' : 'Off', () => write(0)),
        button(motor ? 'Close (10000)' : 'On', () => write(10000)));
      if (load.type !== 'onoff') {
        const label = text('label', motor ? 'Blind level: 0 open → 10000 closed' : 'Brightness: 0 off → 10000 full');
        const input = document.createElement('input');
        input.type = 'number'; input.min = '0'; input.max = '10000'; input.step = '1';
        const reported = byId.get(String(load.id))?.[field];
        if (Number.isInteger(reported)) input.value = reported;
        input.required = true;
        label.append(input);
        actions.append(label, button('Set target', () => {
          if (input.reportValidity()) write(Number(input.value));
        }));
      }
      article.append(actions);
      if (motor) article.append(text('p', 'Position only. Tilt, stop and calibration are intentionally not exposed. Verify installation orientation and keep the blind path clear.', 'muted'));
    }
    $('loads').append(article);
  }
}
async function read(resource) { return (await api(`/api/read/${resource}`)).data; }
async function loadAll(current, includeMetadata) {
  $('status').textContent = 'Refreshing gateway…';
  const loads = await read('loads');
  if (current !== epoch) return;
  let states, stateError;
  try {
    states = await read('loads/state');
    if (!Array.isArray(states) || states.some(item => !item || typeof item !== 'object' || !Number.isSafeInteger(item.id))) {
      throw new Error('Unexpected state response; expected load state records.');
    }
  } catch (error) { states = undefined; stateError = error.message; }
  if (current !== epoch) return;
  renderLoads(loads, states, stateError);
  controls();
  $('updated').textContent = stateError ? 'State unavailable' : `Updated ${new Date().toLocaleTimeString()}`;
  for (const resource of resources) {
    if (!includeMetadata && !['sensors', 'hvacgroups/state'].includes(resource)) continue;
    panels.get(resource).textContent = 'Loading…';
    try {
      const data = await read(resource);
      if (current !== epoch) return;
      panels.get(resource).textContent = JSON.stringify(data ?? null, null, 2);
    } catch (error) {
      if (current !== epoch) return;
      panels.get(resource).textContent = `Unavailable: ${error.message}`;
    }
  }
  $('status').textContent = stateError ? 'Connected — load state refresh failed.' : 'Connected — reported states refreshed.';
}
function refresh() { return operation(current => loadAll(current, true)); }
function connect(pair) {
  if (!$('host').reportValidity()) return;
  const payload = { host: $('host').value, pair };
  if (!pair) payload.token = $('token').value;
  $('token').value = '';
  operation(async current => {
    $('status').textContent = pair ? 'Pairing — press a flashing gateway button within 30 seconds…' : 'Connecting…';
    const result = await api('/api/connect', 'POST', payload);
    delete payload.token;
    if (current !== epoch) return;
    connected = result.connected;
    await loadAll(current, true);
  }).finally(() => { delete payload.token; });
}
$('connect').addEventListener('submit', event => { event.preventDefault(); connect(false); });
$('pair').addEventListener('click', () => connect(true));
$('refresh').addEventListener('click', refresh);
$('disconnect').addEventListener('click', async () => {
  if (disconnecting) return;
  disconnecting = true;
  epoch++;
  connected = false;
  busy = true;
  clearTimeout(timer);
  controller?.abort();
  $('token').value = '';
  $('loads').textContent = 'Disconnected.';
  $('updated').textContent = '';
  panels.forEach(panel => { panel.textContent = 'Not loaded.'; });
  $('error').textContent = '';
  controls();
  try {
    await api('/api/disconnect', 'POST');
    $('status').textContent = 'Disconnected — server credentials forgotten.';
  } catch {
    $('status').textContent = 'Polling stopped.';
    $('error').textContent = 'Could not confirm server disconnect. Stop the Node server to ensure credentials are forgotten.';
  } finally { disconnecting = false; busy = false; controls(); }
});
operation(async current => {
  const session = await api('/api/session');
  if (current !== epoch) return;
  connected = session.connected;
  if (connected) { $('host').value = session.host.replace(/^\[|\]$/g, ''); await loadAll(current, true); }
});
