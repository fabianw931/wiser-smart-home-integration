<script>
  import { mappingMatches } from '../mappings.js';
  export let loads = [], rooms = [], mappings = {};
  export let busy = false, demo = false;
  export let onsave, onremove, onreview, onexport, onimport;
  let selected = '', name = '', room = '', notes = '', formError = '', editingKey = '';
  let gatewayName = '', gatewayRoom = '', gatewayBase = null, importInput;
  $: load = loads.find(item => String(item.id) === String(selected));
  $: mapping = load && mappings[load.id];
  $: nextKey = JSON.stringify([selected, load, mapping]);
  $: if (nextKey !== editingKey) {
    editingKey = nextKey;
    const local = mappingMatches(load, mapping) ? mapping : null;
    name = local?.name ?? load?.name ?? '';
    room = local?.room ?? rooms.find(item => item.id === load?.room)?.name ?? '';
    notes = local?.notes ?? '';
    gatewayName = load?.name ?? '';
    gatewayRoom = String(load?.room ?? '');
    gatewayBase = load ? { name: load.name ?? null, room: load.room ?? null } : null;
    formError = '';
  }
  function save(event) {
    event.preventDefault();
    if (!load || !name.trim()) return;
    onsave(load, { name: name.trim(), room: room.trim(), notes });
  }
  function review(event) {
    event.preventDefault();
    if (!load || !gatewayBase) return;
    const changes = {}, expected = {};
    if (gatewayName.trim() !== gatewayBase.name) {
      changes.name = gatewayName.trim(); expected.name = gatewayBase.name;
    }
    if (gatewayRoom !== '' && Number(gatewayRoom) !== gatewayBase.room) {
      changes.room = Number(gatewayRoom); expected.room = gatewayBase.room;
    }
    if (!Object.keys(changes).length) { formError = 'No gateway metadata changes to review.'; return; }
    formError = '';
    onreview(load, { changes, expected });
  }
  async function importFile(event) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (file.size > 1024 * 1024) { formError = 'Mapping file is too large (maximum 1 MB).'; return; }
    try { await onimport(await file.text()); formError = ''; }
    catch (error) { formError = error.message; }
  }
</script>

<section class="configuration-layout" aria-label="Configuration workspace">
  <div class="card configuration-editor"><div class="card-body">
    <p class="eyebrow">Your personal organization</p>
    <h2 class="section-title">Names, rooms & notes</h2>
    <p class="muted">Save your own labels in the local SQLite database. Lights and blinds still work normally; these settings are never sent to the gateway.</p>
    <form onsubmit={save} class="space-y-4">
      <label class="fieldset"><span class="fieldset-legend">Choose a load to configure</span>
        <select class="select w-full" bind:value={selected} disabled={busy}>
          <option value="">Select a light or blind</option>
          {#each loads as item}<option value={String(item.id)}>{mappingMatches(item, mappings[item.id]) ? mappings[item.id].name : item.name || 'Load ' + item.id} · {item.id}</option>{/each}
        </select>
      </label>
      {#if load}
        <label class="fieldset"><span class="fieldset-legend">Personal display name</span><input class="input w-full" bind:value={name} required maxlength="100" /></label>
        <label class="fieldset"><span class="fieldset-legend">Personal room</span><input class="input w-full" bind:value={room} list="personal-rooms" maxlength="100" placeholder="e.g. Reading room" /></label>
        <datalist id="personal-rooms">{#each [...new Set([...rooms.map(item => item.name), ...Object.values(mappings).map(item => item.room)].filter(Boolean))] as label}<option value={label}></option>{/each}</datalist>
        <label class="fieldset"><span class="fieldset-legend">Personal notes</span><textarea class="textarea w-full" bind:value={notes} maxlength="1000" rows="3" placeholder="Location, purpose, or reminders for yourself"></textarea></label>
        <p class="muted text-sm">Gateway name: {load.name || 'Load ' + load.id} · device {load.device ?? 'unknown'} / channel {load.channel ?? 'unknown'}</p>
        <button class="btn btn-primary" type="submit" disabled={busy}>Save local mapping</button>
      {/if}
    </form>
    {#if formError}<p class="text-error" role="alert">{formError}</p>{/if}
    {#if load}
      <details class="gateway-settings">
        <summary>Change gateway metadata…</summary>
        <p class="text-sm muted my-3">Optional and separate from your local mapping. These changes are sent to the installation only after review. Leave this closed while the installer is working.</p>
        <form onsubmit={review} class="space-y-3">
          <label class="fieldset"><span class="fieldset-legend">Gateway display name</span><input class="input w-full" bind:value={gatewayName} required maxlength="100" disabled={busy || demo} /></label>
          <label class="fieldset"><span class="fieldset-legend">Gateway room</span><select class="select w-full" bind:value={gatewayRoom} disabled={busy || demo || !rooms.length}>
            <option value="" disabled>Keep current assignment</option>
            {#each rooms as item}<option value={String(item.id)}>{item.name || 'Room ' + item.id}</option>{/each}
          </select></label>
          <button class="btn btn-outline" type="submit" disabled={busy || demo}>Review gateway change</button>
        </form>
      </details>
    {/if}
  </div></div>

  <div class="card draft-panel"><div class="card-body">
    <div class="section-heading"><h2 class="section-title">Saved in SQLite</h2><span class="badge">{Object.keys(mappings).length}</span></div>
    <p class="muted">Personal mappings are stored on the computer running this app, independently of your browser. Export a JSON file for a portable backup.</p>
    <div class="flex flex-wrap gap-2">
      <button class="btn btn-sm btn-outline" disabled={!Object.keys(mappings).length} onclick={onexport}>Export mappings</button>
      <button class="btn btn-sm btn-outline" disabled={busy} onclick={() => importInput.click()}>Import mappings</button>
      <input class="sr-only" tabindex="-1" type="file" accept=".json,application/json" aria-label="Import mappings file" bind:this={importInput} onchange={importFile} />
    </div>
    <p class="muted text-xs">Imports add missing mappings. Existing local entries are kept.</p>
    {#if !Object.keys(mappings).length}<div class="empty-state"><span class="empty-symbol" aria-hidden="true">✎</span><h3>Make it your own</h3><p>Give a light a useful name or organize it into any room you like.</p></div>{/if}
    {#each Object.entries(mappings) as [id, item]}
      {@const original = loads.find(load => String(load.id) === id)}
      {@const matched = mappingMatches(original, item)}
      <article class="draft-item" aria-label={'Mapping for ' + item.name}>
        <h3 class="font-semibold">{item.name}</h3><p class="muted">{item.room || 'Unassigned'}</p>
        {#if item.notes}<p class="text-sm whitespace-pre-wrap">{item.notes}</p>{/if}
        <p class="text-xs muted">Gateway: {original?.name || 'Load ' + id}</p>
        {#if !matched}<p class="text-warning text-sm">This load is missing or its identity changed. The mapping is retained but not used.</p>{/if}
        <button class="btn btn-sm btn-outline" disabled={busy} onclick={() => onremove(id)}>Remove local mapping</button>
      </article>
    {/each}
  </div></div>
</section>
<aside class="configuration-note"><strong>Personal mappings ≠ installer settings</strong><p>This editor organizes your dashboard. It does not change DALI groups, wiring settings, calibration, or device commissioning. Real metadata changes are available separately under “Change gateway metadata”.</p></aside>
