<script>
  let { name, result } = $props();
  const count = $derived(Array.isArray(result?.data) ? result.data.length : null);
</script>

<details class="rounded-box border border-base-300 bg-base-100 px-4 py-3">
  <summary class="flex cursor-pointer items-center gap-2 font-medium">
    <span>{name}</span>
    {#if result?.error}
      <span class="badge badge-outline badge-sm">{result.unsupported ? 'Unsupported' : 'Unavailable'}</span>
    {:else if count !== null}
      <span class="badge badge-ghost badge-sm">{count} {count === 1 ? 'item' : 'items'}</span>
    {/if}
  </summary>
  {#if result?.error}
    <p class="mt-3 text-sm">{result.error}</p>
  {:else}
    <pre class="mt-3 text-xs">{result ? JSON.stringify(result.data ?? null, null, 2) : 'Not loaded.'}</pre>
  {/if}
</details>
