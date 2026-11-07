<script>
  let { name, result } = $props();
  const count = $derived(Array.isArray(result?.data) ? result.data.length : null);
</script>

<details class="rounded-box border border-base-300 bg-base-100 px-4">
  <summary class="cursor-pointer py-3 font-medium">
    <span>{name}</span>
    {#if result?.error}
      <span class="badge badge-outline badge-sm ml-2">{result.unsupported ? 'Unsupported' : 'Unavailable'}</span>
    {:else if count !== null}
      <span class="badge badge-ghost badge-sm ml-2">{count} {count === 1 ? 'item' : 'items'}</span>
    {/if}
  </summary>
  {#if result?.error}
    <p class="pb-3 text-sm">{result.error}</p>
  {:else}
    <pre class="pb-3 text-xs">{result ? JSON.stringify(result.data ?? null, null, 2) : 'Not loaded.'}</pre>
  {/if}
</details>
