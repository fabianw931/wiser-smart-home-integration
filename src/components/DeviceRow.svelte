<script>
  import Icon from './Icon.svelte';
  import { kindOf, levelOf, loadName, percent } from '../home.js';

  let { load, snapshot, protection = null, favorite = false, idPrefix = '', disabled = false, stale = true, roomLabel = '', onwrite, onfavorite, onedit } = $props();

  const name = $derived(loadName(load));
  const kind = $derived(kindOf(load));
  const dali = $derived(load.type === 'dali');
  const subtype = $derived(load.sub_type ?? '');
  const dimmable = $derived(load.type === 'dim' || dali);
  const raw = $derived(levelOf(load, snapshot));
  const field = $derived(kind === 'blind' ? 'level' : 'bri');
  const locked = $derived(disabled || stale || raw === null);
  const on = $derived(raw !== null && raw > 0);
  const moving = $derived(['up', 'down'].includes(snapshot?.moving) ? snapshot.moving : null);

  // A drag is a local draft until the user settles; null means "show the reported value".
  let draft = $state(null);
  let timer;
  const shown = $derived(draft ?? (raw === null ? 0 : raw / 100));

  const status = $derived.by(() => {
    if (raw === null) return 'No reading';
    if (kind === 'blind') return raw === 0 ? 'Open' : raw >= 10000 ? 'Closed' : `${percent(raw)} closed`;
    if (load.type === 'onoff') return on ? 'On' : 'Off';
    return on ? percent(raw) : 'Off';
  });

  const send = (target) => onwrite(load, target);
  function settle(value) {
    draft = value;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const target = Math.round(draft * 100);
      try { await send({ [field]: target }); } finally { draft = null; }
    }, 300);
  }
  function toggle(event) {
    event.preventDefault(); // the reported state, not the click, decides what is shown
    send({ bri: on ? 0 : 10000 });
  }

  // Exact entry and colour channels sit under "More" so the row stays one line tall.
  let exact = $state('');
  const channels = $derived(!dali ? [] : subtype === 'tw'
    ? [{ key: 'ct', label: 'Color temperature', min: 1000, max: 20000, step: 100, unit: 'K' }]
    : subtype === 'rgb' ? ['red', 'green', 'blue', 'white'].map(key => ({ key, label: key[0].toUpperCase() + key.slice(1), min: 0, max: 255, step: 1, unit: '' })) : []);
  const channelValue = (key, min, max) => Number.isInteger(snapshot?.[key]) && snapshot[key] >= min && snapshot[key] <= max ? snapshot[key] : null;
  const rgb = $derived(subtype === 'rgb' && ['red', 'green', 'blue'].every(key => channelValue(key, 0, 255) !== null) ? `rgb(${snapshot.red}, ${snapshot.green}, ${snapshot.blue})` : null);
  let channelDraft = $state({});
  const channelTimers = {};
  function settleChannel(channel, value) {
    channelDraft = { ...channelDraft, [channel.key]: value };
    clearTimeout(channelTimers[channel.key]);
    channelTimers[channel.key] = setTimeout(async () => {
      try { await send({ [channel.key]: channelDraft[channel.key] }); }
      finally { channelDraft = { ...channelDraft, [channel.key]: undefined }; }
    }, 300);
  }
  function setExact(event) {
    event.preventDefault();
    const value = Number(exact);
    if (locked || !Number.isFinite(value) || value < 0 || value > 100) return;
    send({ [field]: Math.round(value * 100) });
    exact = '';
  }
</script>

<article class="device" class:lit={kind === 'light' && on} aria-labelledby={`${idPrefix}load-${load.id}`}>
  <div class="device-head">
    <span class="device-icon" aria-hidden="true"><Icon name={kind === 'blind' ? 'blind' : 'bulb'} /></span>
    <div class="device-title">
      <h4 id={`${idPrefix}load-${load.id}`}>{name}</h4>
      <p class="device-status tabular" data-testid="reported-state" class:warn={raw === null}>{status}{#if moving}<span class="moving"> · moving {moving}</span>{/if}{#if roomLabel}<span class="muted"> · {roomLabel}</span>{/if}</p>
    </div>
    {#if onfavorite}
      <button class="icon-btn" type="button" aria-pressed={favorite} aria-label={favorite ? `Unpin ${name}` : `Pin ${name}`} onclick={() => onfavorite(load.id)}><span class:pinned={favorite}><Icon name="star" size={18} /></span></button>
    {/if}
    {#if kind === 'light'}
      <label class="switch-hit">
        <input type="checkbox" class="toggle toggle-primary" checked={on} disabled={locked} aria-label={`${name} power`} onclick={toggle} />
      </label>
    {/if}
  </div>

  {#if kind === 'light' && dimmable}
    <input type="range" class="range level-range" min="0" max="100" step="1" value={shown} disabled={locked}
      aria-label={`${name} brightness`} aria-valuetext={`${shown}%`}
      oninput={event => (draft = Number(event.currentTarget.value))} onchange={event => settle(Number(event.currentTarget.value))} />
  {:else if kind === 'blind'}
    <input type="range" class="range level-range blind-range" min="0" max="100" step="1" value={shown} disabled={locked}
      aria-label={`${name} closed position`} aria-valuetext={`${shown}% closed`}
      oninput={event => (draft = Number(event.currentTarget.value))} onchange={event => settle(Number(event.currentTarget.value))} />
    <div class="pair">
      <button class="btn btn-outline" type="button" disabled={locked} onclick={() => send({ level: 0 })}>Open</button>
      <button class="btn btn-outline" type="button" disabled={locked} onclick={() => send({ level: 10000 })}>Close</button>
    </div>
  {:else if kind === 'unused'}
    <p class="muted small">Read-only — unused channel.</p>
  {:else if kind === 'other'}
    <p class="muted small">Read-only — {dali ? 'unsupported DALI subtype' : 'unsupported load type'}.</p>
  {/if}

  {#if raw === null && (kind === 'light' || kind === 'blind') && !stale}
    <p class="warn small">Controls unavailable — the gateway reported no valid value. Refresh to try again.</p>
  {/if}
  {#if protection}
    <p class="muted small">Weather protection configured ({protection.group}). Rules as reported{protection.rules.length ? ': ' + protection.rules.join('; ') : ': none active'}. This is configuration, not a live alarm.</p>
  {/if}

  <details class="more">
    <summary>More</summary>
    <div class="more-body">
      {#if kind === 'blind'}<p class="muted small">0% = open, 100% = closed. Keep the travel path clear. No stop or tilt controls.</p>{/if}
      {#if kind === 'light' && dimmable || kind === 'blind'}
        <form class="inline-form" onsubmit={setExact}>
          <label><span class="label-text">Exact {kind === 'blind' ? 'closed position' : 'brightness'} (0–100%)</span>
            <input class="input" type="number" min="0" max="100" step="0.01" bind:value={exact} disabled={locked} placeholder={raw === null ? '' : String(raw / 100)} /></label>
          <button class="btn btn-outline" type="submit" disabled={locked}>Set</button>
        </form>
      {/if}
      {#each channels as channel (channel.key)}
        {@const reported = channelValue(channel.key, channel.min, channel.max)}
        <label class="channel"><span class="label-text">{channel.label}: <span class="tabular">{channelDraft[channel.key] ?? reported ?? 'unavailable'}{channel.unit && (channelDraft[channel.key] ?? reported) !== null ? ' ' + channel.unit : ''}</span></span>
          <input type="range" class="range level-range" min={channel.min} max={channel.max} step={channel.step} disabled={locked}
            value={channelDraft[channel.key] ?? reported ?? channel.min} aria-label={`${name} ${channel.label.toLowerCase()}`}
            oninput={event => (channelDraft = { ...channelDraft, [channel.key]: Number(event.currentTarget.value) })}
            onchange={event => settleChannel(channel, Number(event.currentTarget.value))} /></label>
      {/each}
      {#if rgb}<span class="swatch" style:background={rgb} role="img" aria-label={`Reported color: red ${snapshot.red}, green ${snapshot.green}, blue ${snapshot.blue}`}></span>{/if}
      {#if onedit}<button class="btn btn-ghost" type="button" onclick={() => onedit(load)}>Rename or change room</button>{/if}
      <p class="muted small">Load {load.id} · {load.type}{subtype ? ` / ${subtype}` : ''} · device {load.device ?? 'unknown'} · channel {load.channel ?? 'unknown'}</p>
      {#if load.notes}<p class="notes small">{load.notes}</p>{/if}
      <pre class="small">{JSON.stringify(snapshot ?? null, null, 2)}</pre>
    </div>
  </details>
</article>
