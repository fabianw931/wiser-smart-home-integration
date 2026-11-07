<script>
  import Icon from './Icon.svelte';
  let { dash } = $props();
</script>

{#if dash.active && dash.stale && !dash.demo}
  <p class="banner warn" role="status">Readings are stale or unavailable. Controls are disabled until a refresh succeeds.</p>
{/if}
{#if dash.storageNotice}<p class="banner warn" role="alert">{dash.storageNotice}</p>{/if}

<div class="toasts" aria-live="off">
  {#if dash.error}<p class="message err" role="alert">{dash.error}</p>{/if}
  {#if dash.commandNotice}
    <p class="message" role="status"><span>{dash.commandNotice}</span>
      <button class="icon-btn" type="button" aria-label="Dismiss message" onclick={dash.dismissCommandNotice}><Icon name="close" size={18} /></button></p>
  {/if}
</div>
