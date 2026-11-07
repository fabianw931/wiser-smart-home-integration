<script>
  import { kindOf, loadName, reading, formatPercent } from '../loads.js';

  let { load, state: snapshot, disabled = false, stale = true, onwrite } = $props();

  const name = $derived(loadName(load));
  const kind = $derived(kindOf(load));
  const dimmable = $derived(load.type === 'dim');
  const raw = $derived(reading(load, snapshot));
  const locked = $derived(disabled || stale);
  const moving = $derived(['up', 'down'].includes(snapshot?.moving) ? snapshot.moving : null);

  // A slider drag is a local draft until released; null means "show the reported value".
  let draft = $state(null);
  const reportedPercent = $derived(raw === null ? 0 : raw / 100);
  const shown = $derived(draft ?? reportedPercent);

  const summary = $derived.by(() => {
    if (raw === null) return 'Not reported';
    if (kind === 'blind') return raw === 0 ? 'Open' : raw >= 10000 ? 'Closed' : `${formatPercent(raw)} closed`;
    if (load.type === 'onoff') return raw > 0 ? 'On' : 'Off';
    return raw > 0 ? formatPercent(raw) : 'Off';
  });
  const on = $derived(raw !== null && raw > 0);
  const field = $derived(kind === 'blind' ? 'level' : 'bri');

  const send = value => onwrite(load, { [field]: value });
  async function commit() {
    if (draft === null) return;
    const value = Math.round(draft * 100);
    try { await send(value); } finally { draft = null; }
  }
  function toggle(event) {
    // Controlled switch: the reported state, not the click, decides what is shown.
    event.preventDefault();
    send(on ? 0 : 10000);
  }
</script>

<article class="card bg-base-100 border border-base-300 shadow-sm" aria-labelledby={`load-${load.id}`}>
  <div class="card-body gap-3 p-4">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h3 id={`load-${load.id}`} class="font-semibold leading-tight break-words">{name}</h3>
        <p class="text-lg font-medium mt-1" class:text-primary={on || (kind === 'blind' && raw !== null && raw < 10000)} class:text-base-content={!on} data-testid="reported-state">{summary}</p>
        {#if moving}<p class="text-xs text-info">Moving {moving}</p>{/if}
      </div>
      {#if kind === 'light'}
        <input type="checkbox" class="toggle toggle-primary toggle-lg shrink-0" checked={on} disabled={locked || raw === null}
          aria-label={`${name} power`} onclick={toggle} />
      {:else if kind === 'blind'}
        <div class="relative h-14 w-12 shrink-0 overflow-hidden rounded border border-base-300 bg-base-200" aria-hidden="true">
          <div class="absolute inset-x-0 top-0 bg-primary/40 border-b border-primary" style:height={`${shown}%`}></div>
        </div>
      {/if}
    </div>

    {#if kind === 'light' && dimmable}
      <input type="range" class="range range-primary range-sm w-full" min="0" max="100" step="1" value={shown}
        disabled={locked || raw === null} aria-label={`${name} brightness`} aria-valuetext={`${shown}%`}
        oninput={event => (draft = Number(event.currentTarget.value))} onchange={commit} />
    {:else if kind === 'blind'}
      <input type="range" class="range range-primary range-sm w-full" min="0" max="100" step="1" value={shown}
        disabled={locked || raw === null} aria-label={`${name} closed position`} aria-valuetext={`${shown}% closed`}
        oninput={event => (draft = Number(event.currentTarget.value))} onchange={commit} />
      <div class="grid grid-cols-2 gap-2">
        <button class="btn btn-sm btn-outline" type="button" disabled={locked} onclick={() => send(0)}>Open</button>
        <button class="btn btn-sm btn-outline" type="button" disabled={locked} onclick={() => send(10000)}>Close</button>
      </div>
    {:else if kind === 'unused'}
      <p class="text-sm text-base-content/70">Read-only — unused channel.</p>
    {:else if kind === 'other'}
      <p class="text-sm text-base-content/70">Read-only — unsupported load type “{load.type}”.</p>
    {/if}

    {#if stale && kind !== 'unused'}<p class="text-warning text-xs">Stale or unavailable — refresh before controlling.</p>{/if}

    <details class="text-xs text-base-content/70">
      <summary class="cursor-pointer select-none">Details</summary>
      <p class="mt-2 break-words">ID {load.id} · {load.type} · device {load.device ?? 'unknown'} · channel {load.channel ?? 'unknown'}</p>
      <pre class="mt-2">{JSON.stringify(snapshot ?? null, null, 2)}</pre>
    </details>
  </div>
</article>
