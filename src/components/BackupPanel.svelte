<script>
  import { MAX_CONFIGURATION_BYTES, describePlan } from '../configuration.js';

  let { dash } = $props();
  let picker;
  let preview = $state(null); // { fileName, gateway, imported, plan } between choosing a file and Apply or Cancel
  let error = $state('');
  let applying = $state(false);

  async function choose(event) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    preview = null; error = '';
    if (!file) return;
    if (file.size > MAX_CONFIGURATION_BYTES) { error = 'Configuration file is too large (maximum 1 MB).'; return; }
    try { preview = { fileName: file.name, ...dash.previewImport(await file.text()) }; }
    catch (failure) { error = failure.message; }
  }

  async function apply() {
    applying = true; error = '';
    try { await dash.applyImport(preview); }
    catch (failure) { error = failure.message + ' Choose the file again to retry what is missing.'; }
    finally { preview = null; applying = false; }
  }

  function cancel() { preview = null; error = ''; }
</script>

<section class="settings-section" aria-labelledby="backup-heading">
  <h2 id="backup-heading">Backup</h2>
  <p class="muted">Keep one file with everything you have set up for this gateway, and restore it later or on another computer.</p>

  <div class="panel backup-facts">
    <h3>What is in the file</h3>
    <p class="small"><strong>Included:</strong> your personal names, room labels and notes, your floors and room order, and your pinned devices and rooms. For reference, the file also lists every device with the name the gateway itself uses, next to your personal name; that list is not restored.</p>
    <p class="small"><strong>Not included:</strong> the gateway's own configuration, device states, and any credentials or tokens.</p>
    <p class="small">Restoring only fills in what is missing here: existing names, floors and pins are kept. It never writes to the gateway. The file contains your household labels and notes, so keep it private.</p>
    {#if dash.demo}<p class="small">In the sample home, export and import use the sample home's own saved data.</p>{/if}
  </div>

  <div class="actions">
    <button class="btn btn-outline" type="button" onclick={dash.downloadConfiguration}>Export configuration</button>
    <button class="btn btn-outline" type="button" disabled={applying || dash.mappingBusy} onclick={() => picker.click()}>Import configuration</button>
    <input class="sr-only" tabindex="-1" type="file" accept=".json,application/json" aria-label="Import configuration file" bind:this={picker} onchange={choose} />
  </div>

  {#if error}<p class="text-error" role="alert">{error}</p>{/if}

  {#if preview}
    <section class="panel backup-preview" aria-label="Import preview">
      <h3>Review before importing</h3>
      <p class="muted small">{preview.fileName} · {preview.imported.version === 1 ? 'version 1 (personal names only)' : 'version 2'}</p>
      <p>{describePlan(preview.plan)}</p>
      <p class="muted small">Nothing has been saved yet. Existing entries win; anything that is already here stays as it is.</p>
      <div class="actions">
        <button class="btn btn-primary" type="button" disabled={applying || preview.plan.empty} onclick={apply}>Apply</button>
        <button class="btn btn-outline" type="button" disabled={applying} onclick={cancel}>Cancel</button>
      </div>
    </section>
  {/if}
</section>
