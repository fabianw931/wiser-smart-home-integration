<script>
  let { connected, host, updated, stale, busy, disconnecting, onrefresh, ondisconnect } = $props();
  const time = $derived(updated ? updated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null);
</script>

<header class="sticky top-0 z-20 border-b border-base-300 bg-base-100">
  <div class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-8">
    <h1 class="text-lg font-bold">Wiser <span class="font-normal text-base-content/70">by Feller</span></h1>
    {#if connected}
      <span class="badge badge-success badge-soft gap-1"><span class="size-2 rounded-full bg-success" aria-hidden="true"></span>{host}</span>
      <p class="text-sm tabular-nums" class:text-warning={stale} class:text-base-content={!stale}>
        {#if stale}Readings stale{#if time}&nbsp;· last update {time}{/if}{:else}Updated {time}{/if}
      </p>
      <div class="ml-auto flex items-center gap-2">
        {#if busy}<span class="loading loading-spinner loading-sm" aria-hidden="true"></span>{/if}
        <button class="btn btn-outline min-h-11" disabled={busy} onclick={onrefresh}>Refresh</button>
        <button class="btn btn-ghost min-h-11" disabled={disconnecting} onclick={ondisconnect}
          title="Forgets the token held by the local server; does not delete the gateway account">Disconnect</button>
      </div>
    {:else}
      <span class="badge badge-ghost">Disconnected</span>
    {/if}
  </div>
</header>
