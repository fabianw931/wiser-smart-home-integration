<script>
  import { onMount, onDestroy } from 'svelte';
  import { Dashboard, RESOURCE_NAMES } from './dashboard.svelte.js';
  import { kindOf, loadName, reading, groupByRoom } from './loads.js';
  import TopBar from './components/TopBar.svelte';
  import ConnectionForm from './components/ConnectionForm.svelte';
  import LoadCard from './components/LoadCard.svelte';
  import ResourcePanel from './components/ResourcePanel.svelte';

  const dash = new Dashboard();
  let filter = $state('all');
  let query = $state('');

  const rooms = $derived(dash.resources.rooms?.data);
  const devices = $derived(dash.resources.devices?.data);
  const withKind = $derived(dash.loads.map(load => ({ load, kind: kindOf(load) })));
  const lights = $derived(withKind.filter(item => item.kind === 'light').map(item => item.load));
  const blinds = $derived(withKind.filter(item => item.kind === 'blind').map(item => item.load));
  const lightsOn = $derived(lights.filter(load => reading(load, dash.states[load.id]) > 0).length);
  const blindsOpen = $derived(blinds.filter(load => reading(load, dash.states[load.id]) === 0).length);

  const needle = $derived(query.trim().toLowerCase());
  const visible = $derived(withKind.filter(({ load, kind }) => {
    if (filter === 'lights' && kind !== 'light') return false;
    if (filter === 'blinds' && kind !== 'blind') return false;
    return !needle || loadName(load).toLowerCase().includes(needle);
  }));
  const controllable = $derived(visible.filter(item => ['light', 'blind'].includes(item.kind)).map(item => item.load));
  const readOnly = $derived(filter === 'all' ? visible.filter(item => !['light', 'blind'].includes(item.kind)).map(item => item.load) : []);
  const groups = $derived(groupByRoom(controllable, rooms, devices));
  const info = $derived(dash.resources.info?.data);
  const infoRows = $derived(info && typeof info === 'object' && !Array.isArray(info)
    ? Object.entries(info).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value)) : []);

  onMount(() => dash.start());
  onDestroy(() => dash.stop());
</script>

<TopBar connected={dash.connected} host={dash.host} updated={dash.updated} stale={dash.stale} busy={dash.busy}
  disconnecting={dash.disconnecting} onrefresh={dash.refresh} ondisconnect={dash.disconnect} />

<main class="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-8">
  {#if !dash.connected}
    {#key dash.epoch}
      <ConnectionForm bind:host={dash.host} disabled={dash.busy} busy={dash.busy} error={dash.error} notice={dash.notice} onconnect={dash.connect} />
    {/key}
    {#if !dash.busy}<p class="text-center text-sm text-base-content/70" role="status">{dash.notice}</p>{/if}
  {:else}
    <p class="sr-only" role="status">{dash.notice}</p>

    {#if dash.stale}
      <p class="alert alert-warning alert-soft text-sm">Readings are stale or unavailable. Controls are disabled until a refresh succeeds.</p>
    {/if}

    <p class="text-sm tabular-nums text-base-content/70" aria-label="Overview">
      <span class="font-semibold text-base-content">{lightsOn} of {lights.length}</span> lights on
      · <span class="font-semibold text-base-content">{blindsOpen} of {blinds.length}</span> blinds open{#if Array.isArray(rooms)}
      {' '}· {rooms.length} {rooms.length === 1 ? 'room' : 'rooms'}{/if}
    </p>

    <div class="flex flex-wrap items-center gap-3">
      <div role="group" class="join" aria-label="Show">
        {#each [['all', 'All', withKind.length], ['lights', 'Lights', lights.length], ['blinds', 'Blinds', blinds.length]] as [key, label, count]}
          <button class="btn join-item min-h-11" class:btn-primary={filter === key} aria-pressed={filter === key} onclick={() => (filter = key)}>{label} <span class="tabular-nums opacity-70">{count}</span></button>
        {/each}
      </div>
      <input class="input min-h-11 w-full sm:ml-auto sm:w-64" type="search" placeholder="Search by name" aria-label="Search loads" bind:value={query} />
    </div>
    {#if filter !== 'lights'}
      <p class="text-xs text-base-content/70">Blinds: 0% = open, 100% = closed (the API's convention — verify against your installation). Keep the travel path clear; there is no stop button.</p>
    {/if}

    {#if !dash.loads.length}
      <p class="rounded-box border border-dashed border-base-300 p-8 text-center">No loads reported by this gateway.</p>
    {:else if !groups.length && !readOnly.length}
      <p class="rounded-box border border-dashed border-base-300 p-8 text-center">No loads match your filter.</p>
    {/if}

    {#each groups as group, index (group.name)}
      <section class="space-y-3" aria-labelledby={`room-${index}`}>
        <h2 id={`room-${index}`} class="text-lg font-semibold">{group.name} <span class="text-sm font-normal tabular-nums text-base-content/70">{group.items.length}</span></h2>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {#each group.items as load (load.id)}
            <LoadCard {load} state={dash.states[load.id]} disabled={dash.busy} stale={dash.stale} onwrite={dash.write} />
          {/each}
        </div>
      </section>
    {/each}

    {#if readOnly.length}
      <details class="space-y-3">
        <summary class="cursor-pointer py-2.5 text-lg font-semibold">Unused &amp; unsupported <span class="text-sm font-normal text-base-content/70">{readOnly.length}</span></summary>
        <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {#each readOnly as load (load.id)}
            <LoadCard {load} state={dash.states[load.id]} disabled={dash.busy} stale={dash.stale} onwrite={dash.write} />
          {/each}
        </div>
      </details>
    {/if}

    <details class="rounded-box border border-base-300 bg-base-100">
      <summary class="cursor-pointer px-4 py-2.5 text-lg font-semibold">Gateway &amp; diagnostics</summary>
      <div class="space-y-3 border-t border-base-300 p-4">
        {#if infoRows.length}
          <dl class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
            {#each infoRows as [key, value]}<dt class="text-base-content/70">{key}</dt><dd class="break-all">{String(value)}</dd>{/each}
          </dl>
        {/if}
        <p class="text-sm text-base-content/70">Read-only raw resources. Availability depends on firmware and installation. Refreshes every 30 seconds.</p>
        {#each RESOURCE_NAMES as name}<ResourcePanel {name} result={dash.resources[name]} />{/each}
      </div>
    </details>
  {/if}
</main>

{#if dash.connected && (dash.error || dash.commandNotice)}
  <div class="toast toast-end toast-bottom z-30 max-w-sm">
    {#if dash.error}<div class="alert alert-error text-sm" role="alert">{dash.error}</div>{/if}
    {#if dash.commandNotice}
      <div class="alert alert-info text-sm" role="status">
        <span>{dash.commandNotice}</span>
        <button class="btn btn-ghost btn-square min-h-11 min-w-11" onclick={dash.dismissCommandNotice} aria-label="Dismiss">
          <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
    {/if}
  </div>
{/if}
