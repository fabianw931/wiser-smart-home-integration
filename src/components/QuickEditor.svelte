<script>
  import { onMount } from 'svelte';
  export let load, rooms = [], onsave, onclose;
  let dialog;
  let name = load.name || `Load ${load.id}`;
  let room = load.personalRoom;
  let notes = load.personalNotes;
  let saving = false;
  let failed = false;
  onMount(() => dialog.showModal());
  async function save(event) {
    event.preventDefault();
    if (saving) return;
    saving = true; failed = false;
    const saved = await onsave(load, { name, room, notes });
    saving = false;
    if (saved) dialog.close();
    else failed = true;
  }
</script>

<dialog bind:this={dialog} class="confirmation-dialog quick-editor" aria-labelledby="quick-editor-heading" onclose={onclose} oncancel={event => { if (saving) event.preventDefault(); }}>
  <h2 id="quick-editor-heading">Edit device details</h2>
  <p>Personal labels only, saved in SQLite. Nothing is sent to the gateway. Device ID: {load.id}.</p>
  <form onsubmit={save} class="space-y-4">
    <label class="fieldset"><span class="fieldset-legend">Personal display name</span><input class="input w-full" bind:value={name} required maxlength="100" disabled={saving} /></label>
    <label class="fieldset"><span class="fieldset-legend">Personal room</span><input class="input w-full" bind:value={room} list="quick-rooms" maxlength="100" placeholder="Choose or create a room" disabled={saving} /></label>
    <datalist id="quick-rooms">{#each rooms as item}<option value={item}></option>{/each}</datalist>
    <label class="fieldset"><span class="fieldset-legend">Personal notes</span><textarea class="textarea w-full" bind:value={notes} maxlength="1000" rows="3" disabled={saving}></textarea></label>
    {#if failed}<p class="text-error" role="alert">Could not save details. Your edits are kept here; retry or cancel.</p>{/if}
    <div class="flex flex-wrap gap-2"><button class="btn btn-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save details'}</button><button class="btn btn-outline" type="button" disabled={saving} onclick={() => dialog.close()}>Cancel</button></div>
  </form>
</dialog>
