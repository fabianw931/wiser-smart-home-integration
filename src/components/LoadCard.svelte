<script>
  export let load;
  export let state;
  export let disabled = false;
  export let stale = true;
  export let onwrite;
  let target = '';
  let colorTargets = { ct: '', red: '', green: '', blue: '', white: '' };
  function validInteger(value, min, max) {
    return Number.isInteger(value) && value >= min && value <= max;
  }
  $: name = load.name || `Load ${load.id}`;
  $: motor = load.type === 'motor';
  $: dali = load.type === 'dali';
  $: subtype = load.sub_type === undefined ? '' : load.sub_type;
  $: supportedDali = dali && ['', 'tw', 'rgb'].includes(subtype);
  $: field = motor ? 'level' : 'bri';
  $: writable = !load.unused && (['onoff', 'dim', 'motor'].includes(load.type) || supportedDali);
  $: value = state?.[field];
  $: validPrimary = validInteger(value, 0, 10000);
  $: controlsDisabled = disabled || stale || !validPrimary;
  $: colorFields = supportedDali && subtype === 'tw'
    ? [{ key: 'ct', label: 'Color temperature (ct)', min: 1000, max: 20000 }]
    : supportedDali && subtype === 'rgb'
      ? ['red', 'green', 'blue', 'white'].map(key => ({ key, label: key[0].toUpperCase() + key.slice(1), min: 0, max: 255 }))
      : [];
  $: reported = !validPrimary ? 'Not reported or invalid'
    : load.type === 'onoff' ? (value > 0 ? 'On' : 'Off')
    : `${value / 100}% ${motor ? 'closed' : 'brightness'}`;
  function setTarget(event) {
    event.preventDefault();
    if (controlsDisabled || !validInteger(target, 0, 10000)) return;
    onwrite(load, { [field]: Number(target) });
  }
  function setColorTarget(event, channel) {
    event.preventDefault();
    const value = colorTargets[channel.key];
    if (controlsDisabled || !validInteger(value, channel.min, channel.max)) return;
    onwrite(load, { [channel.key]: value });
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
    {#each colorFields as channel}
      <p class="text-sm">Reported {channel.label}: {validInteger(state?.[channel.key], channel.min, channel.max) ? state[channel.key] : 'Unavailable'}</p>
    {/each}
    {#if stale}<p class="text-warning text-sm">Stale or unavailable — refresh before controlling.</p>{/if}
    {#if writable && !validPrimary}<p class="text-warning text-sm">Controls unavailable — reported {field} must be an integer from 0 to 10000. Refresh to obtain a valid state.</p>{/if}
    {#if writable}
      <fieldset disabled={controlsDisabled} aria-label={`${name} controls`} class="space-y-3 min-w-0">
        <div class="flex flex-wrap gap-2">
          <button class="btn btn-sm btn-outline" type="button" onclick={() => onwrite(load, { [field]: 0 })}>{motor ? 'Open' : 'Off'}</button>
          <button class="btn btn-sm btn-primary" type="button" onclick={() => onwrite(load, { [field]: 10000 })}>{motor ? 'Close' : 'On'}</button>
        </div>
        {#if load.type !== 'onoff'}
          <form onsubmit={setTarget} class="space-y-2">
            <label class="fieldset">
              <span class="fieldset-legend">{motor ? 'Blind level' : 'Brightness target'} (0–10000)</span>
              <input class="input w-full" type="number" min="0" max="10000" step="1" required bind:value={target} placeholder={validPrimary ? String(value) : 'Enter target'} />
            </label>
            <button class="btn btn-sm btn-outline" type="submit">Set target</button>
          </form>
        {/if}
        {#each colorFields as channel}
          <form onsubmit={(event) => setColorTarget(event, channel)} class="space-y-2">
            <label class="fieldset">
              <span class="fieldset-legend">{channel.label} target ({channel.min}–{channel.max})</span>
              <input class="input w-full" type="number" min={channel.min} max={channel.max} step="1" required bind:value={colorTargets[channel.key]} placeholder={validInteger(state?.[channel.key], channel.min, channel.max) ? String(state[channel.key]) : 'Enter target'} />
            </label>
            <button class="btn btn-sm btn-outline" type="submit">Set {channel.label.toLowerCase()}</button>
          </form>
        {/each}
      </fieldset>
      {#if colorFields.length}<p class="text-sm text-base-content/70">Each form sets only its own target. Other channels remain unchanged. Values use the API scale.</p>{/if}
      {#if motor}
        <p class="text-sm text-base-content/70">0 = open; 10000 = closed. Keep the travel path clear and verify orientation. No stop, tilt, or calibration controls.</p>
      {/if}
    {:else}
      <p class="text-sm">Read-only — {load.unused ? 'unused channel' : dali ? 'unsupported DALI subtype' : 'unsupported load type'}.</p>
    {/if}
    <details class="mt-2">
      <summary class="cursor-pointer text-sm">Raw reported state</summary>
      <pre class="text-xs mt-2">{JSON.stringify(state ?? null, null, 2)}</pre>
    </details>
  </div>
</article>
