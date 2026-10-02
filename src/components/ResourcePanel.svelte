<script>
  export let name;
  export let result;
</script>

<details class="border border-base-300 rounded-box bg-base-100 p-4">
  <summary class="cursor-pointer font-medium">{name}
    {#if result?.error}<span class="badge badge-outline ml-2">{result.unsupported ? 'Unsupported' : 'Unavailable'}</span>{/if}
  </summary>
  {#if result?.error}
    <p class="text-sm mt-3">{result.error}</p>
  {:else}
    <pre class="text-xs mt-3">{result ? JSON.stringify(result.data ?? null, null, 2) : 'Not loaded.'}</pre>
  {/if}
</details>
