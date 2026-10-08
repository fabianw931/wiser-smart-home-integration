<script>
  export let host = '';
  export let disabled = false;
  export let onconnect;
  let mode = 'token';
  let token = '';

  function submit(event) {
    event.preventDefault();
    const payload = { host: host.trim(), pair: mode === 'pair' };
    if (mode === 'token') payload.token = token;
    token = '';
    onconnect(payload);
  }
</script>

<section class="card gateway-card bg-base-100 shadow-sm border border-base-300" aria-labelledby="connection-heading">
  <div class="card-body">
    <h2 id="connection-heading" class="card-title">Gateway connection</h2>
    <p class="connection-intro">Connect to your Wiser gateway to read your home’s rooms and reported device states.</p>
    <form onsubmit={submit}>
      <fieldset disabled={disabled} class="space-y-4">
        <label class="fieldset">
          <span class="fieldset-legend">Gateway IP or hostname</span>
          <input class="input w-full" bind:value={host} required autocomplete="off" placeholder="192.168.1.123" />
          <span class="text-sm">Address only, without http://, a port, or a path.</span>
        </label>
        <div class="flex flex-wrap gap-4">
          <label class="flex items-center gap-2">
            <input class="radio radio-sm" type="radio" name="auth-mode" value="token" bind:group={mode} />
            Use existing token
          </label>
          <label class="flex items-center gap-2">
            <input class="radio radio-sm" type="radio" name="auth-mode" value="pair" bind:group={mode} onchange={() => token = ''} />
            Pair new client
          </label>
        </div>
        {#if mode === 'token'}
          <label class="fieldset">
            <span class="fieldset-legend">Gateway token</span>
            <input class="input w-full" type="password" bind:value={token} required autocomplete="off" />
          </label>
          <button class="btn btn-primary" type="submit">Connect</button>
        {:else}
          <p class="pairing-note text-sm">Have physical access to the gateway. After starting, press a flashing gateway button within approximately 30 seconds. Pairing creates a real gateway account.</p>
          <button class="btn btn-primary" type="submit">Start pairing</button>
        {/if}
      </fieldset>
    </form>
    <p class="text-sm text-base-content/70">Tokens stay in server memory only. All tabs share one connection. Closing this page does not forget an established token; disconnect when finished.</p>
  </div>
</section>
