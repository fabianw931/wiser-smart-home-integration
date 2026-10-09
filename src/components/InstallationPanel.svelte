<script>
  import { onMount } from 'svelte';
  import { resourceItems, resourceStatus, sensorReading, registeredButton, identifiableButton, record } from '../installation.js';
  export let kind;
  export let resources = {};
  export let loads = [];
  export let disabled = true;
  export let demo = false;
  export let refreshing = false;
  export let onidentify;
  let search = '';
  let device = '';
  let now = Date.now();
  onMount(() => { const timer = setInterval(() => now = Date.now(), 5000); return () => clearInterval(timer); });
  $: primary = resources[kind === 'Buttons' ? 'buttons' : 'sensors'];
  $: secondary = resources[kind === 'Buttons' ? 'smartbuttons' : 'westgroups'];
  $: items = resourceItems(primary);
  $: devices = [...new Set(items.map(item => item.device).filter(value => typeof value === 'string'))].sort();
  $: filtered = items.filter(item => (!device || item.device === device) && `${item.name || ''} ${item.device || ''} ${item.type || ''} ${item.id ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  $: status = resourceStatus(primary, now, demo);
  $: secondaryStatus = resourceStatus(secondary, now, demo);
  const loadName = id => loads.find(load => load.id === id)?.name || `Load ${id}`;
</script>

<section aria-label={kind} class="space-y-4">
  <div class="section-heading"><h2 class="section-title">{kind === 'Buttons' ? 'Your switches & buttons' : 'Weather & sensor readings'}</h2><span class="badge badge-outline">{status}</span></div>
  <p class="muted">{kind === 'Buttons' ? 'Explore physical inputs and reported job references. Identifying a button briefly flashes its LED; it does not reassign it.' : 'Use the physical-device filter to explore individual stations. Temperature and brightness may also come from indoor sensors; station membership is not inferred.'}</p>
  <p class="text-sm muted">{demo ? 'Fictional sample readings — no devices connected.' : primary?.observedAt ? `Last fetched: ${new Date(primary.observedAt).toLocaleTimeString()}. Snapshot polling, not a live event feed.` : 'Connect and refresh to discover available resources.'} {refreshing ? 'Refreshing…' : ''}</p>
  {#if primary?.error}<p class="alert alert-warning">{primary.error}</p>{/if}
  {#if status === 'Stale'}<p class="alert alert-warning">These readings are stale. Refresh before relying on them.</p>{/if}
  {#if status === 'Invalid response'}<p class="alert alert-warning">Gateway returned an unexpected resource format. Inspect diagnostics; these values cannot be trusted.</p>{/if}
  <div class="toolbar">
    <label class="search-label"><span class="sr-only">Search {kind.toLowerCase()}</span><input class="input w-full" bind:value={search} placeholder={kind === 'Buttons' ? 'Search buttons…' : 'Search sensors…'} /></label>
    <label><span class="sr-only">Physical device</span><select class="select" bind:value={device}><option value="">All physical devices</option>{#each devices as id}<option value={id}>{id}</option>{/each}</select></label>
    <span class="result-count">{filtered.length} of {items.length}</span>
  </div>
  {#if !filtered.length}<p class="empty-state">{items.length ? 'No matches. Clear the search or device filter.' : status === 'Reported' || demo ? 'No resources reported for this account.' : 'Resources are not available yet.'}</p>{/if}
  <div class="load-grid">
    {#each filtered as item, index}
      <article class="card bg-base-100 border border-base-300" aria-labelledby={`installation-${kind}-${index}`}>
        <div class="card-body">
          <h3 class="card-title" id={`installation-${kind}-${index}`}>{item.name || `${kind === 'Buttons' ? 'Button' : 'Sensor'} ${item.id ?? `${item.device ?? '?'} / ${item.channel ?? '?'}`}`}</h3>
          <p class="muted text-sm">Device {item.device ?? 'not reported'} · channel {item.channel ?? 'not reported'}</p>
          <p>{item.type || 'Unknown type'}{item.sub_type ? ` · ${item.sub_type}` : ''}</p>
          {#if kind === 'Buttons'}
            <span class="badge badge-outline">{registeredButton(item) ? 'Registered' : 'Not registered'}</span>
            <p class="text-sm">{registeredButton(item) ? `Button ID ${item.id}. Registered buttons can emit gateway events.` : 'Discovered input without a registered ID. No registration changes are made by this app.'}</p>
            <p class="text-sm">{Number.isSafeInteger(item.job) ? `Reported job: ${item.job}` : 'Job assignment not reported.'} This is not a complete map of physical switch bindings.</p>
            <button class="btn btn-outline btn-sm" disabled={disabled || demo || status !== 'Reported' || !identifiableButton(item)} onclick={() => onidentify(item)}>Identify · flash LED for 2 seconds</button>
          {:else}
            <p class="reported-value text-xl font-semibold">{sensorReading(item)}</p>
            {#if sensorReading(item) === 'Unavailable'}<p class="text-sm muted">Missing or unrecognized reading. No value or unit has been guessed.</p>{/if}
          {/if}
          <details class="raw-details"><summary>Raw reported data</summary><pre class="text-xs">{JSON.stringify(item, null, 2)}</pre></details>
        </div>
      </article>
    {/each}
  </div>
  <div class="section-heading"><h3 class="section-title">{kind === 'Buttons' ? 'SmartButton job references' : 'Configured weather protection'}</h3><span class="badge badge-outline">{secondaryStatus}</span></div>
  <p class="muted">{kind === 'Buttons' ? 'Reported SmartButton records only. Job execution, registration, reassignment and press-event monitoring are not enabled.' : 'These are configured rules, not live alarms or proof that protection is active. No binding, threshold, calibration or weather-test changes are made.'}</p>
  {#if secondary?.observedAt && !demo}<p class="text-sm muted">Last fetched: {new Date(secondary.observedAt).toLocaleTimeString()}</p>{/if}
  {#if secondary?.error}<p class="alert alert-warning">{secondary.error}</p>{/if}
  {#if !resourceItems(secondary).length}<p class="empty-state">{secondaryStatus === 'Reported' || demo ? 'No records reported for this account.' : 'Records unavailable.'}</p>{/if}
  <div class="load-grid">
    {#each resourceItems(secondary) as group}
      <article class="card bg-base-100 border border-base-300"><div class="card-body">
        <h4 class="card-title">{group.name || `${kind === 'Buttons' ? 'SmartButton' : 'Protection group'} ${group.id ?? '?'}`}</h4>
        {#if kind === 'Buttons'}
          <p>Job: {Number.isSafeInteger(group.job) ? group.job : 'not reported'}</p>
        {:else}
          <p>Loads: {Array.isArray(group.loads) ? group.loads.filter(Number.isSafeInteger).map(loadName).join(', ') || 'None' : 'not reported'}</p>
          {#each ['wind', 'temperature', 'rain', 'hail'] as field}
            {@const rule = record(group[field]) ? group[field] : null}
            <div class="border-t border-base-300 pt-2"><strong class="capitalize">{field}</strong><p>{rule && typeof rule.action === 'string' ? rule.action : 'Not reported'}{rule && Number.isFinite(rule.threshold) ? ` · threshold ${rule.threshold} ${typeof rule.unit === 'string' ? rule.unit : field === 'wind' ? 'm/s' : field === 'temperature' ? '°C' : ''}` : ''}</p></div>
          {/each}
        {/if}
        <details class="raw-details"><summary>Raw reported data</summary><pre class="text-xs">{JSON.stringify(group, null, 2)}</pre></details>
      </div></article>
    {/each}
  </div>
</section>
