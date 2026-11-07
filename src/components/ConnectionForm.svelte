<script>
  let { host = $bindable(''), disabled = false, remembered = false, onconnect, onreconnect, onexplore } = $props();
  let mode = $state('token');
  let token = $state('');
  let remember = $state(false);

  function submit(event) {
    event.preventDefault();
    const payload = { host: host.trim(), pair: mode === 'pair', remember };
    if (mode === 'token') payload.token = token;
    token = '';
    onconnect(payload);
  }
</script>

<section class="connect" aria-labelledby="connection-heading">
  <h1 id="connection-heading">Connect to your gateway</h1>
  <p class="muted">Control lights and blinds on your local network. Nothing leaves this computer.</p>

  {#if remembered}
    <div class="panel remembered">
      <p><strong>A gateway is remembered on this computer.</strong></p>
      <button class="btn btn-primary" type="button" {disabled} onclick={onreconnect}>Reconnect saved gateway</button>
    </div>
  {/if}

  <form class="panel" onsubmit={submit}>
    <fieldset {disabled}>
      <label class="field">
        <span class="label-text">Gateway IP or hostname</span>
        <input class="input" bind:value={host} required autocomplete="off" placeholder="192.168.1.123" />
        <span class="hint-text">Address only, without http://, a port, or a path.</span>
      </label>

      <div class="segments wide" role="radiogroup" aria-label="How to sign in">
        <label class="seg" class:active={mode === 'token'}><input class="sr-only" type="radio" name="auth-mode" value="token" bind:group={mode} />Use existing token</label>
        <label class="seg" class:active={mode === 'pair'}><input class="sr-only" type="radio" name="auth-mode" value="pair" bind:group={mode} onchange={() => (token = '')} />Pair new client</label>
      </div>

      {#if mode === 'token'}
        <label class="field">
          <span class="label-text">Gateway token</span>
          <input class="input" type="password" bind:value={token} required autocomplete="off" />
        </label>
      {:else}
        <p class="note">Stand next to the gateway. After you start, press a flashing gateway button within about 30 seconds. Pairing creates a real gateway account.</p>
      {/if}

      <label class="check"><input class="checkbox" type="checkbox" bind:checked={remember} /><span>Remember this gateway on this computer</span></label>
      <p class="hint-text">Encrypted local storage with an owner-only key; reconnects when the server starts. Without this option any saved connection is replaced by a temporary one.</p>

      <button class="btn btn-primary wide" type="submit">{mode === 'token' ? 'Connect' : 'Start pairing'}</button>
    </fieldset>
  </form>

  <div class="panel alt">
    <p><strong>No gateway at hand?</strong> Explore a fictional home with simulated lights and blinds.</p>
    <button class="btn btn-outline" type="button" {disabled} onclick={onexplore}>Explore sample home</button>
  </div>

  <p class="hint-text">Tokens never enter browser storage or SQLite. All browser tabs share one connection. The gateway uses unencrypted HTTP: use a trusted network and never expose this app's port.</p>
</section>
