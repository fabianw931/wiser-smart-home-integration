<script>
  import { untrack } from 'svelte';
  // Personal name, room and notes for one device, edited in place. Saved locally; never sent to the gateway.
  let { load, rooms = [], idPrefix = '', onsave } = $props();

  // Drafts start from the saved values; later gateway refreshes must not overwrite typing.
  let name = $state(untrack(() => load.name || `Load ${load.id}`));
  let room = $state(untrack(() => load.room));
  let notes = $state(untrack(() => load.notes));
  let saving = $state(false);
  let failed = $state(false);
  let saved = $state(false);
  const dirty = $derived(name.trim() !== (load.name || `Load ${load.id}`) || room.trim() !== load.room || notes !== load.notes);
  const listId = $derived(`${idPrefix}rooms-${load.id}`);

  async function save(event) {
    event.preventDefault();
    if (saving || !name.trim()) return;
    saving = true; failed = false; saved = false;
    const ok = await onsave(load, { name: name.trim(), room: room.trim(), notes });
    saving = false;
    failed = !ok;
    saved = ok;
  }
</script>

<form class="config" onsubmit={save} aria-label={`Name and room for ${load.name || 'Load ' + load.id}`}>
  <p class="label-text">Name &amp; room</p>
  <label class="field"><span class="hint-text">Name</span>
    <input class="input" bind:value={name} required maxlength="100" disabled={saving} oninput={() => (saved = false)} /></label>
  <label class="field"><span class="hint-text">Room</span>
    <input class="input" bind:value={room} list={listId} maxlength="100" placeholder="Choose or create a room" disabled={saving} oninput={() => (saved = false)} /></label>
  <datalist id={listId}>{#each rooms as item (item)}<option value={item}></option>{/each}</datalist>
  <label class="field"><span class="hint-text">Notes</span>
    <textarea class="textarea" bind:value={notes} maxlength="1000" rows="2" disabled={saving} oninput={() => (saved = false)}></textarea></label>
  <div class="actions">
    <button class="btn btn-primary" type="submit" disabled={saving || !dirty || !name.trim()}>{saving ? 'Saving…' : 'Save'}</button>
    {#if saved}<span class="small" role="status">Saved on this computer.</span>{/if}
  </div>
  {#if failed}<p class="warn small" role="alert">Could not save. Your edits are kept here; try again.</p>{/if}
  <p class="hint-text">Personal labels only; nothing is sent to the gateway.</p>
</form>
