<script>
  let { host = $bindable(''), disabled = false, error = '', busy = false, notice = '', onconnect } = $props();
  let mode = $state('token');
  let token = $state('');

  function submit(event) {
    event.preventDefault();
    const payload = { host: host.trim(), pair: mode === 'pair' };
    if (mode === 'token') payload.token = token;
    token = '';
    onconnect(payload);
  }
</script>

<section class="mx-auto max-w-xl" aria-labelledby="connection-heading">
  <div class="card bg-base-100 border border-base-300">
    <div class="card-body gap-5">
      <div>
        <h2 id="connection-heading" class="card-title text-2xl">Connect to your gateway</h2>
        <p class="text-sm text-base-content/70 mt-1">Control Wiser lights and blinds over your local network.</p>
      </div>

      <form onsubmit={submit} class="space-y-4">
        <fieldset {disabled} class="space-y-4">
          <label class="fieldset">
            <span class="fieldset-legend">Gateway IP or hostname</span>
            <input class="input w-full" bind:value={host} required autocomplete="off" placeholder="192.168.1.123" />
            <span class="label">Address only — no http://, port or path.</span>
          </label>

          <div class="join w-full" role="radiogroup" aria-label="Sign-in method">
            <input class="join-item btn min-h-11 flex-1" type="radio" name="auth-mode" value="token" bind:group={mode} aria-label="Use existing token" />
            <input class="join-item btn min-h-11 flex-1" type="radio" name="auth-mode" value="pair" bind:group={mode} onchange={() => (token = '')} aria-label="Pair new client" />
          </div>

          {#if mode === 'token'}
            <label class="fieldset">
              <span class="fieldset-legend">Gateway token</span>
              <input class="input w-full" type="password" bind:value={token} required autocomplete="off" />
            </label>
            <button class="btn btn-primary min-h-11 w-full" type="submit">Connect</button>
          {:else}
            <p class="text-sm">Stand next to the gateway. After you start, press a flashing gateway button within about 30 seconds. A unique client account will be created.</p>
            <button class="btn btn-primary min-h-11 w-full" type="submit">Start pairing</button>
          {/if}
        </fieldset>
      </form>

      {#if busy}
        <p class="flex items-center gap-2 text-sm" role="status"><span class="loading loading-spinner loading-sm" aria-hidden="true"></span>{notice}</p>
      {/if}
      {#if error}<div class="alert alert-error alert-soft text-sm" role="alert">{error}</div>{/if}

      <p class="text-xs text-base-content/70">Tokens stay in this server's memory only and are never stored in the browser. All tabs share one connection; the gateway uses unencrypted HTTP, so use a trusted network and never expose this app's port.</p>
    </div>
  </div>
</section>
