<script>
  import { onMount, onDestroy } from 'svelte';
  import { createApi } from './api.js';
  import ConnectionForm from './components/ConnectionForm.svelte';
  import LoadCard from './components/LoadCard.svelte';
  import ResourcePanel from './components/ResourcePanel.svelte';

  const api = createApi();
  const resourceNames = ['info', 'rooms', 'devices', 'sensors', 'hvacgroups', 'hvacgroups/state'];
  let host = '';
  let connected = false;
  let busy = true;
  let disconnecting = false;
  let stale = true;
  let error = '';
  let notice = 'Checking local session…';
  let commandNotice = '';
  let updated = '';
  let loads = [];
  let states = {};
  let resources = {};
  let diagnosticsBusy = false;
  let epoch = 0;
  let timer;

  function schedule() {
    clearTimeout(timer);
    if (connected) timer = setTimeout(refresh, 30000);
  }
  async function operation(action) {
    if (busy) return;
    clearTimeout(timer);
    busy = true;
    error = '';
    const current = epoch;
    try { await action(current); }
    catch (failure) {
      if (current === epoch) {
        stale = true;
        error = failure.message;
        notice = connected ? 'Refresh failed — readings may be stale.' : 'Connection failed.';
      }
    } finally {
      if (current === epoch) { busy = false; schedule(); }
    }
  }
  const read = async resource => (await api.request(`/api/read/${resource}`)).data;
  async function loadAll(current, diagnostics = true) {
    const discovered = await read('loads');
    if (current !== epoch) return;
    loads = discovered;
    try {
      const snapshot = await read('loads/state');
      if (!Array.isArray(snapshot) || snapshot.some(item => !item || !Number.isSafeInteger(item.id))) throw new Error('Invalid load state response.');
      if (current !== epoch) return;
      states = Object.fromEntries(snapshot.map(item => [item.id, item.state]));
      updated = new Date().toLocaleTimeString();
      stale = false;
      notice = 'Connected — reported states refreshed.';
    } catch (failure) {
      if (current !== epoch) return;
      stale = true;
      error = failure.message;
      notice = 'Connected — state unavailable; old readings are stale.';
    }
    if (diagnostics && current === epoch) void refreshDiagnostics(current);
  }
  async function refreshDiagnostics(current) {
    if (diagnosticsBusy) return;
    diagnosticsBusy = true;
    try {
      for (const name of resourceNames) {
        let result;
        try { result = { data: await read(name) }; }
        catch (failure) { result = { error: failure.message, unsupported: [404, 405, 501].includes(failure.status) }; }
        if (current !== epoch) return;
        resources = { ...resources, [name]: result };
      }
    } finally {
      if (current === epoch) diagnosticsBusy = false;
    }
  }
  function refresh() { return operation(current => loadAll(current)); }
  async function connect(payload) {
    try {
      await operation(async current => {
        notice = payload.pair ? 'Pairing — press a flashing gateway button within 30 seconds…' : 'Connecting…';
        commandNotice = '';
        const result = await api.request('/api/connect', 'POST', payload);
        if (current !== epoch) return;
        connected = result.connected;
        host = result.host.replace(/^\[|\]$/g, '');
        await loadAll(current);
      });
    } finally { delete payload.token; }
  }
  function write(load, target) {
    return operation(async current => {
      commandNotice = '';
      await api.request(`/api/loads/${load.id}/target_state`, 'PUT', target);
      if (current !== epoch) return;
      commandNotice = `Target accepted for ${load.name || `Load ${load.id}`}. Check the reported state and physical device; acceptance is not confirmation of movement.`;
      await loadAll(current, false);
    });
  }
  async function disconnect() {
    if (disconnecting) return;
    disconnecting = true;
    epoch++;
    clearTimeout(timer);
    api.cancel();
    connected = false;
    busy = true;
    stale = true;
    loads = [];
    states = {};
    resources = {};
    diagnosticsBusy = false;
    updated = '';
    commandNotice = '';
    error = '';
    try {
      await api.request('/api/disconnect', 'POST');
      notice = 'Disconnected — server credentials forgotten.';
    } catch {
      notice = 'Polling stopped.';
      error = 'Could not confirm disconnect. Stop the Node server to ensure credentials are forgotten.';
    } finally { busy = false; disconnecting = false; }
  }
  onMount(() => {
    busy = false;
    operation(async current => {
      const session = await api.request('/api/session');
      if (current !== epoch) return;
      connected = session.connected;
      if (connected) {
        host = session.host.replace(/^\[|\]$/g, '');
        await loadAll(current);
      } else notice = session.connecting ? 'A connection is pending in another tab; disconnect to cancel it.' : 'Not connected.';
    });
  });
  onDestroy(() => { epoch++; clearTimeout(timer); api.cancel(); });
</script>

<main class="max-w-6xl mx-auto p-4 sm:p-8 space-y-6">
  <header class="space-y-2">
    <p class="text-sm uppercase tracking-wide text-primary font-semibold">Local control · Proof of concept</p>
    <h1 class="text-3xl font-bold">Wiser by Feller</h1>
    <p class="text-base-content/70">Discover your installation, inspect reported states, and control lights and blinds.</p>
  </header>
  <div class="alert alert-warning text-sm" role="note">Real equipment, local access only. Use a trusted LAN; gateway HTTP is unencrypted. Do not expose this app's port.</div>
  {#key epoch}
    <ConnectionForm bind:host disabled={busy || connected} onconnect={connect} />
  {/key}
  <section class="card bg-base-100 border border-base-300 shadow-sm" aria-label="Connection status">
    <div class="card-body gap-3">
      <div class="flex flex-wrap items-center gap-3">
        <span class={`badge ${connected ? 'badge-success' : 'badge-neutral'}`}>{connected ? `Connected to ${host}` : 'Disconnected'}</span>
        {#if busy}<span class="loading loading-spinner loading-sm" aria-hidden="true"></span>{/if}
        <p role="status">{notice}</p>
      </div>
      {#if error}<p class="text-error" role="alert">{error}</p>{/if}
      {#if commandNotice}<p class="text-sm" role="status">{commandNotice}</p>{/if}
      <p class="text-sm">{updated ? `Last successful state update: ${updated}` : 'No reported state snapshot yet.'} {stale && connected ? 'Readings are stale or unavailable.' : ''}</p>
      <div class="flex flex-wrap gap-2">
        <button class="btn btn-sm btn-outline" disabled={busy || !connected} onclick={refresh}>Refresh now</button>
        <button class="btn btn-sm btn-ghost" disabled={disconnecting} onclick={disconnect}>Disconnect & forget credentials</button>
      </div>
      <p class="text-xs text-base-content/65">Refreshes every 30 seconds after requests finish. Disconnect forgets the local token, not the gateway account.</p>
    </div>
  </section>
  <section aria-labelledby="loads-heading" class="space-y-3">
    <h2 id="loads-heading" class="text-xl font-semibold">Loads {connected ? `(${loads.length})` : ''}</h2>
    {#if !connected}<p>Connect to discover your lights and blinds.</p>
    {:else if !loads.length}<p>No loads reported by this gateway.</p>{/if}
    <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {#each loads as load (load.id)}
        <LoadCard {load} state={states[load.id]} disabled={busy || !connected} {stale} onwrite={write} />
      {/each}
    </div>
  </section>
  <section aria-labelledby="resources-heading" class="space-y-3">
    <h2 id="resources-heading" class="text-xl font-semibold">Resource inspector</h2>
    <p class="text-sm text-base-content/70">Read-only diagnostics. Availability depends on your firmware and installation.</p>
    {#if diagnosticsBusy}<p class="text-sm">Updating diagnostics in the background…</p>{/if}
    {#each resourceNames as name}<ResourcePanel {name} result={resources[name]} />{/each}
  </section>
</main>
