<script>
  import FloorsEditor from './FloorsEditor.svelte';
  import ConfigurationPanel from './ConfigurationPanel.svelte';
  import ThemePicker from './ThemePicker.svelte';
  import ResourcePanel from './ResourcePanel.svelte';
  import { RESOURCE_NAMES } from '../dashboard.svelte.js';

  let { dash, section = 'floors', onsection } = $props();
  const sections = [['floors', 'Rooms & floors'], ['names', 'Names & notes'], ['connection', 'Connection'], ['appearance', 'Appearance'], ['diagnostics', 'Diagnostics']];
</script>

<div class="settings">
  <nav class="subnav" aria-label="Settings sections">
    {#each sections as [id, label] (id)}
      <button type="button" aria-current={section === id ? 'true' : undefined} onclick={() => onsection(id)}>{label}</button>
    {/each}
  </nav>

  <div class="settings-body">
    {#if section === 'floors'}
      <FloorsEditor {dash} />
    {:else if section === 'names'}
      <ConfigurationPanel loads={dash.loads} rooms={dash.rooms} mappings={dash.mappings} busy={dash.busy || dash.mappingBusy} demo={dash.demo}
        onsave={dash.saveLocal} onremove={dash.removeLocal} onreview={dash.openReview} onexport={dash.exportLocal} onimport={dash.importLocal} />
    {:else if section === 'connection'}
      <section class="settings-section" aria-labelledby="conn-heading">
        <h2 id="conn-heading">Connection</h2>
        <dl class="facts">
          <div><dt>Gateway</dt><dd>{dash.demo ? 'Sample home (simulated)' : dash.host}</dd></div>
          <div><dt>Updates</dt><dd>{dash.demo ? 'Not applicable' : dash.liveStatus === 'live' ? 'Live · gateway push connected' : 'Polling · refreshes every 30 seconds'}</dd></div>
          <div><dt>Credentials</dt><dd>{dash.remembered ? 'Remembered securely on this computer' : 'Kept in server memory only'}</dd></div>
        </dl>
        <div class="actions">
          {#if dash.remembered && !dash.demo}<button class="btn btn-outline" type="button" disabled={dash.disconnecting} onclick={() => dash.disconnect(false)}>Disconnect for now</button>{/if}
          <button class="btn btn-outline" type="button" disabled={dash.disconnecting} onclick={() => dash.disconnect(true)}>{dash.demo ? 'Leave sample home' : 'Disconnect & forget credentials'}</button>
        </div>
        <p class="muted small">Disconnecting forgets the local token; it does not delete the gateway account or revoke the token. Gateway traffic is unencrypted HTTP: use a trusted network and do not expose this app's port.</p>
      </section>
    {:else if section === 'appearance'}
      <section class="settings-section" aria-labelledby="appearance-heading">
        <h2 id="appearance-heading">Appearance</h2>
        <ThemePicker />
      </section>
    {:else}
      <section class="settings-section" aria-labelledby="diag-heading">
        <h2 id="diag-heading">Diagnostics</h2>
        <p class="muted">Read-only raw resources. Availability depends on your firmware and installation.</p>
        {#if dash.diagnosticsBusy}<p class="small" role="status">Updating diagnostics in the background…</p>{/if}
        {#each RESOURCE_NAMES as name (name)}<ResourcePanel {name} result={dash.resources[name]} />{/each}
      </section>
    {/if}
  </div>
</div>
