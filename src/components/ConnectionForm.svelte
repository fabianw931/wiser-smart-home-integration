<script>
  export let host = '';
  export let disabled = false;
  export let onconnect;
  let mode = 'token';
  let token = '';
  let remember = false;

  function submit(event) {
    event.preventDefault();
    const payload = { host: host.trim(), pair: mode === 'pair', remember };
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
        <label class="flex items-center gap-2"><input class="checkbox checkbox-sm" type="checkbox" bind:checked={remember} />Remember this gateway on this computer</label>
        <p class="muted text-xs">Opt in to encrypted local storage and reconnect on server startup. Connecting without this option replaces any saved connection with a temporary one.</p>
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
    <p class="text-sm text-base-content/70">Tokens never go into browser storage or SQLite. Remembered credentials use encrypted files with an owner-only key. Software running as your user can still access them. All tabs share one connection.</p>
  </div>
</section>
