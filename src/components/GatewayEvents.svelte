<script>
  import { createApi } from '../api.js';

  let { demo = false } = $props();
  const api = createApi();
  const route = '/api/diagnostics/gateway-events';
  let entries = $state(null); // null until the first Refresh; there is deliberately no automatic polling
  let busy = $state(false);
  let error = $state('');

  async function run(method) {
    busy = true; error = '';
    try { entries = (await api.request(route, method)).data; }
    catch (failure) { error = failure.message; }
    finally { busy = false; }
  }

  $effect(() => () => api.cancel());
</script>

<section class="panel" aria-labelledby="gateway-events-heading">
  <h3 id="gateway-events-heading">Gateway events (raw)</h3>
  <p class="muted small">Press a registered wall button and refresh to see its message. This shows what the gateway pushes over the live connection this app already has open: other messages (up to 200) and the most recent load state changes (up to 50, marked “load”). Everything is kept in memory only, with secrets removed, and are gone when the app restarts. Nothing is requested from the gateway and no button is simulated.</p>
  <div class="actions">
    <button class="btn btn-outline" type="button" disabled={busy || demo} onclick={() => run('GET')}>Refresh</button>
    <button class="btn btn-outline" type="button" disabled={busy || demo} onclick={() => run('DELETE')}>Clear</button>
  </div>
  {#if demo}<p class="muted small">Not available in the sample home.</p>{/if}
  {#if error}<p class="text-error" role="alert">{error}</p>{/if}
  {#if entries}
    {#if entries.length}
      <pre class="small" aria-label="Captured gateway messages" style="overflow:auto;max-height:24rem">{entries.map(entry => `${entry.at}  ${entry.kind === 'load' ? '[load] ' : ''}${JSON.stringify(entry.message)}`).join('\n')}</pre>
    {:else}
      <p class="muted small" role="status">No messages captured yet.</p>
    {/if}
  {/if}
</section>
