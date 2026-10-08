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
  $: rgbValid = subtype === 'rgb' && ['red', 'green', 'blue'].every(key => validInteger(state?.[key], 0, 255));
  $: rgbColor = rgbValid ? `rgb(${state.red}, ${state.green}, ${state.blue})` : 'transparent';
  function setTarget(event) {
    event.preventDefault();
    if (controlsDisabled || typeof target !== 'number' || !Number.isFinite(target) || target < 0 || target > 100) return;
    onwrite(load, { [field]: Math.round(target * 100) });
  }
  function setColorTarget(event, channel) {
    event.preventDefault();
    const value = colorTargets[channel.key];
    if (controlsDisabled || !validInteger(value, channel.min, channel.max)) return;
    onwrite(load, { [channel.key]: value });
  }
</script>

<article class="card control-card bg-base-100 border border-base-300 shadow-sm" aria-labelledby={`load-${load.id}`}>
  <div class="card-body">
    <div class="control-card-header flex justify-between items-start gap-2">
      <h3 id={`load-${load.id}`} class="card-title break-words">{name}</h3>
      <span class="badge badge-outline shrink-0">{load.type}</span>
    </div>
    <p class="text-xs text-base-content/65">{motor ? 'Blind position' : subtype === 'tw' ? 'Tunable white lighting' : subtype === 'rgb' ? 'Color & white lighting' : load.type === 'onoff' ? 'Switched light' : 'Dimmable lighting'}</p>
    <p class="reported-value text-xl font-semibold" data-testid="reported-state">Reported: {reported}</p>
    {#if rgbValid}<div class="color-sample" style:background={rgbColor} role="img" aria-label={`Reported color: red ${state.red}, green ${state.green}, blue ${state.blue}`}></div>{/if}
    {#each colorFields as channel}
      <p class="text-sm">Reported {channel.label}: {validInteger(state?.[channel.key], channel.min, channel.max) ? state[channel.key] : 'Unavailable'}</p>
    {/each}
    {#if stale}<p class="text-warning text-sm">Stale or unavailable — refresh before controlling.</p>{/if}
    {#if writable && !validPrimary}<p class="text-warning text-sm">Controls unavailable — reported {field} must be an integer from 0 to 10000. Refresh to obtain a valid state.</p>{/if}
    {#if writable}
      <fieldset disabled={controlsDisabled} aria-label={`${name} controls`} class="device-controls space-y-3 min-w-0">
        <div class="flex flex-wrap gap-2">
          <button class="btn btn-sm btn-outline" type="button" onclick={() => onwrite(load, { [field]: 0 })}>{motor ? 'Open' : 'Off'}</button>
          <button class="btn btn-sm btn-primary" type="button" onclick={() => onwrite(load, { [field]: 10000 })}>{motor ? 'Close' : 'On'}</button>
        </div>
        {#if load.type !== 'onoff'}
          <form onsubmit={setTarget} class="space-y-2">
            <input class="target-range" type="range" min="0" max="100" step="1" value={typeof target !== 'number' ? (validPrimary ? value / 100 : 0) : target} oninput={(event) => target = Number(event.currentTarget.value)} aria-label={`${motor ? 'Blind level' : 'Brightness'} slider`} />
            <label class="fieldset">
              <span class="fieldset-legend">{motor ? 'Blind level' : 'Brightness target'} (0–100%)</span>
              <input class="input w-full" type="number" min="0" max="100" step="0.01" required bind:value={target} placeholder={validPrimary ? String(value / 100) : 'Enter target'} />
            </label>
            <button class="btn btn-sm btn-outline" type="submit">Set target</button>
          </form>
        {/if}
        <div class="color-controls">
        {#each colorFields as channel}
          <form onsubmit={(event) => setColorTarget(event, channel)} class="space-y-2">
            <label class="fieldset">
              <span class="fieldset-legend">{channel.label} target ({channel.min}–{channel.max})</span>
              <input class="input w-full" type="number" min={channel.min} max={channel.max} step="1" required bind:value={colorTargets[channel.key]} placeholder={validInteger(state?.[channel.key], channel.min, channel.max) ? String(state[channel.key]) : 'Enter target'} />
            </label>
            <button class="btn btn-sm btn-outline" type="submit">Set {channel.label.toLowerCase()}</button>
          </form>
        {/each}
        </div>
      </fieldset>
      {#if colorFields.length}<p class="text-sm text-base-content/70">Brightness and color can be adjusted separately.</p>{/if}
      {#if motor}
        <p class="text-sm text-base-content/70">0% = open; 100% = closed. Keep the travel path clear. No stop or tilt controls.</p>
      {/if}
    {:else}
      <p class="text-sm">Read-only — {load.unused ? 'unused channel' : dali ? 'unsupported DALI subtype' : 'unsupported load type'}.</p>
    {/if}
    <details class="raw-details mt-2">
      <summary class="cursor-pointer text-sm">Raw reported state</summary>
      <p class="text-xs mt-2">ID {load.id} · device {load.device ?? 'unknown'} · channel {load.channel ?? 'unknown'}</p>
      <pre class="text-xs mt-2">{JSON.stringify(state ?? null, null, 2)}</pre>
    </details>
  </div>
</article>
