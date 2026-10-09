<script>
  import ThemePicker from './components/ThemePicker.svelte';
  import QuickEditor from './components/QuickEditor.svelte';
  import { onMount, onDestroy } from 'svelte';
  import { createApi } from './api.js';
  import ConnectionForm from './components/ConnectionForm.svelte';
  import LoadCard from './components/LoadCard.svelte';
  import ResourcePanel from './components/ResourcePanel.svelte';
  import ConfigurationPanel from './components/ConfigurationPanel.svelte';
  import { sampleHome } from './demo.js';
  import { makeMapping, mappingMatches, readMappings, saveMappings, exportMappings, importMappings } from './mappings.js';

  const api = createApi();
  const resourceNames = ['info', 'rooms', 'devices', 'sensors', 'hvacgroups', 'hvacgroups/state'];
  let host = '';
  let connected = false;
  let busy = true;
  let disconnecting = false;
  let remembered = false;
  let liveStatus = 'polling';
  let stopLive;
  let liveEpoch = -1;
  let stateRevision = 0;
  let livePatches = [];
  let resyncTimer;
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
  let page = 'Home';
  let demo = false;
  let search = '';
  let roomFilter = '';
  let grouping = 'room';
  let editingLoad = null;
  let mappings = {};
  let gatewayKey = '';
  let storageNotice = '';
  let mappingBusy = false;
  let reviewDialog;
  let reviewId = '';
  let reviewChange = null;
  $: rooms = demo ? resources.rooms?.data || [] : Array.isArray(resources.rooms?.data) ? resources.rooms.data : [];
  $: displayedLoads = loads.map(load => {
    const local = mappingMatches(load, mappings[load.id]) ? mappings[load.id] : null;
    return { ...load, name: local?.name ?? load.name, personalRoom: local?.room ?? rooms.find(room => room.id === load.room)?.name ?? '', personalNotes: local?.notes ?? '' };
  });
  $: roomLabels = [...new Set(displayedLoads.map(load => load.personalRoom).filter(Boolean))].sort();
  $: filteredLoads = displayedLoads.filter(load => (roomFilter === '' || (roomFilter === 'unassigned' ? !load.personalRoom : load.personalRoom === roomFilter)) && (load.name || '').toLowerCase().includes(search.toLowerCase()));
  $: groups = Array.from(Map.groupBy(filteredLoads, load => grouping === 'room' ? load.personalRoom : grouping === 'type' ? load.type : 'All devices'), ([label, items]) => ({ label, items }))
    .sort((a, b) => a.label === '' ? 1 : b.label === '' ? -1 : a.label.localeCompare(b.label));
  $: reviewLoad = loads.find(load => String(load.id) === reviewId);
  $: reviewConflict = reviewChange && (!reviewLoad || Object.entries(reviewChange.expected).some(([field, value]) => (reviewLoad[field] ?? null) !== value));
  const mappingUrl = (suffix = '', key = gatewayKey) => '/api/local/mappings' + suffix + '?gateway=' + encodeURIComponent(key);
  async function restoreLocal(key) {
    gatewayKey = key.toLowerCase();
    const current = epoch, scope = gatewayKey;
    storageNotice = ''; mappings = {};
    try {
      const result = await api.request(mappingUrl('', scope));
      if (current !== epoch) return;
      mappings = result.data;
      // Migrate only this gateway's legacy browser data after SQLite is available.
      let legacy;
      try { legacy = readMappings(localStorage, scope); }
      catch { storageNotice = 'Existing browser mappings could not be read. Database mappings are available.'; return; }
      if (Object.keys(legacy).length) {
        const migrated = await api.request(mappingUrl('/import', scope), 'POST', { mappings: legacy });
        if (current !== epoch) return;
        mappings = migrated.data;
        try { saveMappings(localStorage, scope, {}); }
        catch { storageNotice = 'Mappings migrated, but the old browser copy could not be cleared.'; }
        commandNotice = 'Existing browser mappings migrated to SQLite. Existing database entries were kept.';
      }
    } catch {
      if (current === epoch) storageNotice = 'Could not load or migrate saved mappings. Existing browser data has been kept. Retry by reconnecting.';
    }
  }
  async function changeMappings(suffix, method, payload) {
    if (mappingBusy || !gatewayKey) throw new Error('A mapping save is already in progress.');
    const current = epoch;
    mappingBusy = true; storageNotice = '';
    try {
      const result = await api.request(mappingUrl(suffix), method, payload);
      if (current !== epoch) return false;
      mappings = result.data;
      return true;
    } catch (failure) {
      if (current !== epoch) return false;
      throw failure;
    } finally { if (current === epoch) mappingBusy = false; }
  }
  async function saveLocal(load, fields) {
    try {
      if (await changeMappings('/' + load.id, 'PUT', makeMapping(load, fields))) {
        commandNotice = 'Personal mapping saved in SQLite. Gateway configuration is unchanged.';
        return true;
      }
    } catch (failure) { storageNotice = 'Mapping was not saved: ' + failure.message; }
    return false;
  }
  async function removeLocal(id) {
    try {
      if (await changeMappings('/' + id, 'DELETE')) commandNotice = 'Mapping removed from SQLite. Gateway configuration is unchanged.';
    } catch (failure) { storageNotice = 'Mapping was not removed: ' + failure.message; }
  }
  function exportLocal() {
    const url = URL.createObjectURL(new Blob([exportMappings(gatewayKey, mappings)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'wiser-personal-mappings.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importLocal(text) {
    const imported = importMappings(text, gatewayKey);
    if (await changeMappings('/import', 'POST', { mappings: imported })) commandNotice = 'Mappings imported into SQLite. Existing entries were kept; nothing was sent to the gateway.';
  }
  function review(load, change) {
    if (demo || busy || !connected) return;
    reviewId = String(load.id); reviewChange = change; reviewDialog.showModal();
  }
  async function explore() {
    clearTimeout(timer); api.cancel(); epoch++;
    const sample = sampleHome();
    demo = true; connected = false; busy = true; stale = false; diagnosticsBusy = false;
    loads = sample.loads; states = sample.states; resources = { rooms: { data: sample.rooms } };
    const current = epoch;
    await restoreLocal('sample-home');
    if (current !== epoch) return;
    busy = false;
    error = ''; notice = 'Sample home — simulated equipment. No gateway connected.'; updated = ''; page = 'Home';
  }
  function applyConfiguration() {
    if (demo || !connected || !reviewChange || reviewConflict) return;
    const id = reviewId, change = reviewChange;
    reviewDialog.close();
    return operation(async current => {
      await api.request('/api/loads/' + id + '/config', 'PATCH', change, true);
      if (current !== epoch) return;
      commandNotice = 'Gateway metadata change accepted. Your personal mapping is kept separately.';
      reviewChange = null;
      await loadAll(current, false);
    });
  }

  function schedule() {
    clearTimeout(timer);
    if (connected && !demo) timer = setTimeout(refresh, 30000);
  }
  function ensureLive(current) {
    if (liveEpoch === current || !connected || demo) return;
    stopLive?.(); liveEpoch = current;
    stopLive = api.events(event => {
      if (current !== epoch || !connected || demo) return;
      if (event.type === 'status') liveStatus = event.status === 'live' ? 'live' : 'polling';
      if (event.type === 'load' && loads.some(load => load.id === event.id) && event.state && typeof event.state === 'object') {
        stateRevision++;
        livePatches.push({ revision: stateRevision, id: event.id, state: event.state });
        if (livePatches.length > 1000) livePatches.shift();
        states = { ...states, [event.id]: { ...states[event.id], ...event.state } };
        updated = new Date().toLocaleTimeString();
      }
      if (event.type === 'resync') {
        const retryRefresh = () => {
          if (current !== epoch || !connected || demo) return;
          if (busy) resyncTimer = setTimeout(retryRefresh, 250);
          else void refresh();
        };
        clearTimeout(resyncTimer); resyncTimer = setTimeout(retryRefresh, 100);
      }
    }, changed => {
      if (current !== epoch) return;
      liveStatus = 'polling';
      if (changed) { stale = true; error = 'Gateway session changed. Reconnect this page before controlling devices.'; }
    });
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
      const revision = stateRevision;
      const snapshot = await read('loads/state');
      if (!Array.isArray(snapshot) || snapshot.some(item => !item || !Number.isSafeInteger(item.id))) throw new Error('Invalid load state response.');
      if (current !== epoch) return;
      states = Object.fromEntries(snapshot.map(item => [item.id, item.state]));
      for (const patch of livePatches.filter(item => item.revision > revision)) states[patch.id] = { ...states[patch.id], ...patch.state };
      livePatches = [];
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
    ensureLive(current);
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
    demo = false;
    stopLive?.(); liveEpoch = -1; liveStatus = 'polling'; livePatches = [];
    try {
      await operation(async current => {
        notice = payload.pair ? 'Pairing — press a flashing gateway button within 30 seconds…' : 'Connecting…';
        commandNotice = '';
        const result = await api.request('/api/connect', 'POST', payload);
        if (current !== epoch) return;
        connected = result.connected;
        remembered = result.remembered;
        host = result.host.replace(/^\[|\]$/g, '');
        await restoreLocal(host);
        if (current !== epoch) return;
        await loadAll(current);
      });
    } finally { delete payload.token; }
  }
  function write(load, target) {
    if (demo) {
      states = { ...states, [load.id]: { ...states[load.id], ...target } };
      commandNotice = 'Sample control updated. No gateway connected.';
      return;
    }
    return operation(async current => {
      commandNotice = '';
      await api.request(`/api/loads/${load.id}/target_state`, 'PUT', target, true);
      if (current !== epoch) return;
      commandNotice = `Target accepted for ${load.name || `Load ${load.id}`}. Check the reported state and physical device; acceptance is not confirmation of movement.`;
      await loadAll(current, false);
    });
  }
  async function reconnect() {
    stopLive?.(); liveEpoch = -1; liveStatus = 'polling'; livePatches = [];
    await operation(async current => {
      const result = await api.request('/api/reconnect', 'POST');
      if (current !== epoch) return;
      connected = true; demo = false; remembered = true;
      host = result.host.replace(/^\[|\]$/g, '');
      await restoreLocal(host);
      if (current === epoch) await loadAll(current);
    });
  }
  async function disconnect(forget = true) {
    stopLive?.(); clearTimeout(resyncTimer); liveEpoch = -1; liveStatus = 'polling'; livePatches = [];
    editingLoad = null;
    if (disconnecting) return;
    disconnecting = true;
    demo = false; mappings = {}; gatewayKey = ''; storageNotice = ''; mappingBusy = false; search = ''; roomFilter = '';
    reviewDialog?.close();
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
      await api.request(forget ? '/api/disconnect' : '/api/disconnect-session', 'POST');
      if (forget) remembered = false;
      notice = forget ? 'Disconnected — server credentials forgotten.' : 'Disconnected for now. Saved credentials kept; reconnect manually or restart the server.';
    } catch {
      notice = 'Polling stopped.';
      error = 'Could not confirm disconnect or credential removal. Saved credentials may remain on disk; check server permissions before restarting.';
    } finally { busy = false; disconnecting = false; }
  }
  onMount(() => {
    busy = false;
    operation(async current => {
      let session = await api.request('/api/session');
      while (session.connecting && current === epoch) {
        notice = 'Connecting — waiting for gateway…';
        await new Promise(resolve => setTimeout(resolve, 300));
        if (current !== epoch) return;
        session = await api.request('/api/session');
      }
      if (current !== epoch) return;
      connected = session.connected;
      remembered = session.remembered;
      if (session.host) host = session.host.replace(/^\[|\]$/g, '');
      if (session.credentialError) error = session.credentialError;
      if (connected) {
        host = session.host.replace(/^\[|\]$/g, '');
        await restoreLocal(host);
        if (current !== epoch) return;
        await loadAll(current);
      } else notice = session.connecting ? 'A connection is pending in another tab; disconnect to cancel it.' : 'Not connected.';
    });
  });
  onDestroy(() => { epoch++; clearTimeout(timer); clearTimeout(resyncTimer); stopLive?.(); api.cancel(); });
</script>

<div class="app-shell">
  <aside class="sidebar">
    <div><div class="brand">wiser<span class="brand-accent">.</span></div><p class="brand-caption">Your home, connected</p></div>
    <nav aria-label="Main navigation">{#each ['Home', 'Configuration', 'Diagnostics'] as item}<button class:active={page === item} aria-current={page === item ? 'page' : undefined} onclick={() => page = item}>{item}</button>{/each}</nav>
    <ThemePicker />
    <div class="sidebar-footer">Wiser by Feller<br>Local control workspace<br>{demo ? 'Sample home' : connected ? host : 'No gateway connected'}</div>
  </aside>
  <main class="main-content">
    <header class="topbar"><div><p class="eyebrow">{demo ? 'Sample home' : 'Your home workspace'}</p><h1>{page === 'Home' ? 'Make yourself at home.' : page === 'Configuration' ? 'A home that feels like yours.' : 'Understand your installation.'}</h1><p>{page === 'Home' ? 'Lights, blinds, and the details that make a room.' : page === 'Configuration' ? 'Plan names and room assignments in your browser first.' : 'Reported resources from your gateway, read only.'}</p></div><span class="badge">{demo ? 'Sample home' : connected ? 'Gateway connected' : 'Local workspace'}</span></header>
    <div class="mode-banner" role="note"><div><strong>{demo ? 'Sample home · no gateway connected' : 'Personal configuration · local database'}</strong><p>{demo ? 'Explore the workspace using simulated lights and blinds.' : 'Names, rooms, and notes are saved in SQLite on this computer. Light and blind controls operate your devices normally.'}</p></div></div>
    {#if remembered}<div class="command-notice">Gateway remembered securely on this computer. {#if connected}<button class="btn btn-sm btn-ghost" disabled={disconnecting} onclick={() => disconnect(false)}>Disconnect for now</button>{:else}<button class="btn btn-sm btn-outline" disabled={busy} onclick={reconnect}>Reconnect saved gateway</button>{/if}</div>{/if}
    {#if connected && !demo}<p class="muted text-xs" aria-live="polite">Updates: {liveStatus === 'live' ? 'Live · gateway push connected' : 'Polling · refreshes every 30 seconds'}</p>{/if}
    <section class="status-strip" aria-label="Connection status"><div><p role="status">{notice}</p><p class="muted text-xs">{updated ? `Last successful state update: ${updated}` : demo ? 'Sample values — not gateway readings.' : 'No reported state snapshot yet.'} {stale && connected ? 'Readings are stale or unavailable.' : ''}</p></div><div class="flex flex-wrap gap-2"><button class="btn btn-sm btn-outline" disabled={busy || !connected || demo} onclick={refresh}>Refresh now</button><button class="btn btn-sm btn-ghost" disabled={disconnecting} onclick={() => disconnect(true)}>Disconnect & forget credentials</button></div></section>
    {#if error}<p class="alert alert-error" role="alert">{error}</p>{/if}
    {#if commandNotice}<p class="command-notice" role="status">{commandNotice}</p>{/if}
    {#if storageNotice}<p class="alert alert-warning" role="alert">{storageNotice}</p>{/if}
    {#if !connected && !demo}
      <div class="welcome-grid">{#key epoch}<ConnectionForm bind:host disabled={busy} onconnect={connect} />{/key}<section class="card welcome-card"><div class="card-body"><p class="eyebrow">Start with a preview</p><h2 class="section-title">Get to know your home workspace.</h2><p class="muted">Try a sample home without connecting to a gateway. Explore lights, blinds, and personal configuration.</p><button class="btn btn-primary" disabled={busy} onclick={explore}>Explore sample home</button><p class="muted text-xs">Sample values are fictional. No real devices are connected.</p></div></section></div>
    {/if}
    {#if connected || demo}
      <div class="home-stats"><div><strong>{loads.length}</strong><span>Loads</span></div><div><strong>{rooms.length}</strong><span>Rooms</span></div><div><strong>{Object.keys(mappings).length}</strong><span>Personal mappings</span></div></div>
    {/if}
    {#if page === 'Home'}
      <section aria-labelledby="loads-heading"><div class="section-heading"><h2 id="loads-heading" class="section-title">Your lights & blinds</h2><span class="muted text-sm">{demo ? 'Sample installation' : 'Reported installation'}</span></div>
      {#if connected || demo}<div class="toolbar"><label class="search-label"><span class="sr-only">Search loads</span><input class="input w-full" bind:value={search} placeholder="Search lights or blinds…" /></label><label><span class="sr-only">Filter by room</span><select class="select" bind:value={roomFilter}><option value="">All rooms</option>{#each roomLabels as room}<option value={room}>{room}</option>{/each}<option value="unassigned">Unassigned</option></select></label><label><span class="sr-only">Group devices by</span><select class="select" bind:value={grouping}><option value="room">Group by room</option><option value="type">Group by type</option><option value="none">No grouping</option></select></label><span class="result-count" aria-live="polite">{filteredLoads.length} of {loads.length} loads</span>{#if search || roomFilter}<button class="btn btn-sm btn-ghost" onclick={() => { search = ''; roomFilter = ''; }}>Clear filters</button>{/if}</div>{/if}
      {#if !connected && !demo}<p class="muted">Connect to discover your lights and blinds, or explore the sample home.</p>{:else if !filteredLoads.length}<p class="empty-state">{loads.length ? 'No loads match your filters.' : 'No loads reported by this gateway.'}</p>{/if}
      {#each groups as group (group.label)}
        <section class="device-group" aria-label={group.label || 'Unassigned'}>
          <div class="group-heading"><h3>{group.label || 'Unassigned'}</h3><span class="badge">{group.items.length} {group.items.length === 1 ? 'device' : 'devices'}</span></div>
          <div class="load-grid">{#each group.items as load (load.id)}
            <div class="load-room">
              {#if grouping !== 'room'}<p class="room-caption">{load.personalRoom || 'Unassigned'}</p>{/if}
              <LoadCard {load} state={states[load.id]} disabled={busy || (!connected && !demo)} {stale} onwrite={write} />
              <div class="device-details-bar"><span class="muted text-xs">{mappingMatches(load, mappings[load.id]) ? 'Personal mapping' : 'Gateway labels'}</span><button class="btn btn-sm btn-ghost" disabled={mappingBusy} aria-label={'Edit details for ' + (load.name || 'Load ' + load.id)} onclick={() => editingLoad = { ...load }}>Edit details</button></div>
              {#if load.personalNotes}<p class="personal-notes">{load.personalNotes}</p>{/if}
            </div>
          {/each}</div>
        </section>
      {/each}</section>
    {:else if page === 'Configuration'}
      <ConfigurationPanel {loads} {rooms} {mappings} busy={busy || mappingBusy} {demo} onsave={saveLocal} onremove={removeLocal} onreview={review} onexport={exportLocal} onimport={importLocal} />
    {:else}
      <section aria-labelledby="resources-heading" class="space-y-3"><h2 id="resources-heading" class="section-title">Resource inspector</h2><p class="muted">Read-only diagnostics. Availability depends on your firmware and installation.</p>{#if diagnosticsBusy}<p class="text-sm">Updating diagnostics in the background…</p>{/if}{#each resourceNames as name}<ResourcePanel {name} result={resources[name]} />{/each}</section>
    {/if}
    <footer class="workspace-footer">Local access only · Use a trusted LAN. Gateway HTTP is unencrypted; do not expose this app's port. Refreshes every 30 seconds after requests finish. Disconnect forgets the local token, not the gateway account.</footer>
  </main>
</div>
<dialog bind:this={reviewDialog} class="confirmation-dialog" aria-labelledby="review-dialog-heading">
  <h2 id="review-dialog-heading" tabindex="-1" autofocus>Change gateway metadata?</h2>
  {#if reviewChange}
    <p>{reviewLoad?.name || 'Load ' + reviewId} · gateway {host}</p>
    <dl class="draft-diff">{#each Object.entries(reviewChange.changes) as [field, value]}<div><dt>{field === 'room' ? 'Room' : 'Name'}</dt><dd>{field === 'room' ? rooms.find(room => room.id === reviewChange.expected[field])?.name || 'Unassigned' : String(reviewChange.expected[field] ?? 'Unnamed')} → <strong>{field === 'room' ? rooms.find(room => room.id === value)?.name || 'Room ' + value : String(value)}</strong></dd></div>{/each}</dl>
    <p>This is a real gateway configuration change, separate from your personal mapping. Values are checked again first. Device commissioning and installer settings are not changed.</p>
    {#if reviewConflict}<p class="text-warning">Gateway values changed. Refresh and review a new change.</p>{/if}
    <div class="flex flex-wrap gap-2"><button class="btn btn-outline" onclick={() => reviewDialog.close()}>Cancel</button><button class="btn btn-primary" disabled={busy || demo || !connected || reviewConflict} onclick={applyConfiguration}>Apply this change to gateway</button></div>
  {/if}
</dialog>

{#if editingLoad}<QuickEditor load={editingLoad} rooms={roomLabels} onsave={saveLocal} onclose={() => editingLoad = null} />{/if}
