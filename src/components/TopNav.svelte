<script>
  import Icon from './Icon.svelte';
  let { dash, page, onnavigate } = $props();
  const items = [['home', 'Home', 'home'], ['sensors', 'Sensors & buttons', 'sensors'], ['settings', 'Settings', 'settings']];
  const time = $derived(dash.updated ? dash.updated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null);
  const where = $derived(dash.demo ? 'Sample home' : dash.connected ? dash.host : '');
</script>

<header class="topbar">
  <div class="topbar-inner">
    <p class="brand">wiser<span aria-hidden="true">.</span><span class="sr-only"> by Feller</span></p>
    {#if dash.active}
      <nav aria-label="Main navigation" class="nav">
        {#each items as [id, label, icon] (id)}
          <button type="button" aria-current={page === id ? 'page' : undefined} onclick={() => onnavigate(id)}><Icon name={icon} size={20} /><span>{label}</span></button>
        {/each}
      </nav>
      <p class="nav-status" aria-live="polite">
        <span class="where">{where}</span>
        {#if dash.demo}<span class="pill">Simulated</span>
        {:else if dash.stale}<span class="pill warn">Stale{#if time}<span class="tabular"> · {time}</span>{/if}</span>
        {:else}<span class="pill ok" class:live={dash.liveStatus === 'live'}><span class="dot" aria-hidden="true"></span>{dash.liveStatus === 'live' ? 'Live' : 'Polling'}{#if time}<span class="tabular"> · {time}</span>{/if}</span>{/if}
      </p>
      {#if !dash.demo}<button class="btn btn-ghost refresh" type="button" disabled={dash.busy} onclick={dash.refresh}>Refresh</button>{/if}
    {/if}
  </div>
</header>
