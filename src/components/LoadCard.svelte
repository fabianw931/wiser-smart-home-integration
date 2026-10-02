<script>
  export let load;
  export let state;
  export let disabled = false;
  export let stale = true;
  export let onwrite;
  let target = '';
  $: name = load.name || `Load ${load.id}`;
  $: motor = load.type === 'motor';
  $: field = motor ? 'level' : 'bri';
  $: writable = !load.unused && ['onoff', 'dim', 'motor'].includes(load.type);
  $: value = state?.[field];
  $: reported = !Number.isFinite(value) ? 'Not reported'
    : load.type === 'onoff' ? (value > 0 ? 'On' : 'Off')
    : `${value / 100}% ${motor ? 'closed' : 'brightness'}`;
  function setTarget(event) {
    event.preventDefault();
    onwrite(load, { [field]: Number(target) });
  }
</script>

<article class="card bg-base-100 border border-base-300 shadow-sm" aria-labelledby={`load-${load.id}`}>
  <div class="card-body">
    <div class="flex justify-between items-start gap-2">
      <h3 id={`load-${load.id}`} class="card-title break-words">{name}</h3>
      <span class="badge badge-outline shrink-0">{load.type}</span>
    </div>
    <p class="text-xs text-base-content/65 break-words">ID {load.id} · device {load.device ?? 'unknown'} · channel {load.channel ?? 'unknown'}</p>
    <p class="text-xl font-semibold" data-testid="reported-state">Reported: {reported}</p>
    {#if stale}<p class="text-warning text-sm">Stale or unavailable — refresh before controlling.</p>{/if}
    {#if writable}
      <fieldset disabled={disabled || stale} aria-label={`${name} controls`} class="space-y-3">
        <div class="flex flex-wrap gap-2">
          <button class="btn btn-sm btn-outline" type="button" onclick={() => onwrite(load, { [field]: 0 })}>{motor ? 'Open' : 'Off'}</button>
          <button class="btn btn-sm btn-primary" type="button" onclick={() => onwrite(load, { [field]: 10000 })}>{motor ? 'Close' : 'On'}</button>
        </div>
        {#if load.type !== 'onoff'}
          <form onsubmit={setTarget} class="space-y-2">
            <label class="fieldset">
              <span class="fieldset-legend">{motor ? 'Blind level' : 'Brightness target'} (0–10000)</span>
              <input class="input w-full" type="number" min="0" max="10000" step="1" required bind:value={target} placeholder={Number.isFinite(value) ? String(value) : 'Enter target'} />
            </label>
            <button class="btn btn-sm btn-outline" type="submit">Set target</button>
          </form>
        {/if}
      </fieldset>
      {#if motor}
        <p class="text-sm text-base-content/70">0 = open; 10000 = closed. Keep the travel path clear and verify orientation. No stop, tilt, or calibration controls.</p>
      {/if}
    {:else}
      <p class="text-sm">Read-only — {load.unused ? 'unused channel' : 'unsupported load type'}.</p>
    {/if}
    <details class="mt-2">
      <summary class="cursor-pointer text-sm">Raw reported state</summary>
      <pre class="text-xs mt-2">{JSON.stringify(state ?? null, null, 2)}</pre>
    </details>
  </div>
</article>
