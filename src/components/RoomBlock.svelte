<script>
  import Icon from './Icon.svelte';
  import LevelStrip from './LevelStrip.svelte';
  import DeviceRow from './DeviceRow.svelte';
  import QuickActions from './QuickActions.svelte';
  import { summarize, glyphs as toGlyphs } from '../home.js';

  let { room, dash, protection, expanded = false, ontoggle, onedit } = $props();

  const states = $derived(dash.states);
  const sum = $derived(summarize(room.loads, states));
  const glyphs = $derived(toGlyphs(room.loads, states));
  const favorite = $derived(room.key !== '' && dash.layout.favorites.rooms.includes(room.key));
  const text = $derived.by(() => {
    const parts = [];
    if (sum.lights) parts.push(sum.lightsUnknown === sum.lights ? 'lights unknown' : `${sum.lightsOn} of ${sum.lights} ${sum.lights === 1 ? 'light' : 'lights'} on`);
    if (sum.blinds) parts.push(sum.blindsUnknown === sum.blinds ? 'blinds unknown' : sum.blindsClosed === sum.blinds ? `${sum.blinds === 1 ? 'blind' : 'blinds'} closed` : sum.blindsOpen === sum.blinds ? `${sum.blinds === 1 ? 'blind' : 'blinds'} open` : `${sum.blindsClosed} of ${sum.blinds} blinds closed`);
    return parts.join(' · ') || `${room.loads.length} read-only`;
  });
  const slug = $derived(room.key.replace(/\W+/g, '-') || 'unassigned');
</script>

<section class="room" class:open={expanded} aria-labelledby={`room-${slug}`}>
  <div class="room-head">
    <button class="room-toggle" type="button" aria-expanded={expanded} aria-controls={`devices-${slug}`} onclick={ontoggle}>
      <span class="chev" aria-hidden="true"><Icon name="chevron" size={18} /></span>
      <span class="room-name"><span id={`room-${slug}`} class="room-title">{room.name}</span><span class="room-sum tabular">{text}</span></span>
      <LevelStrip {glyphs} />
    </button>
    {#if room.key !== ''}
      <button class="icon-btn" type="button" aria-pressed={favorite} aria-label={favorite ? `Unpin room ${room.name}` : `Pin room ${room.name}`} onclick={() => dash.toggleFavoriteRoom(room.key)}><span class:pinned={favorite}><Icon name="star" size={18} /></span></button>
    {/if}
  </div>
  <div class="room-actions"><QuickActions loads={room.loads} {states} scope={room.name} {dash} disabled={!dash.active || dash.stale} /></div>
  {#if expanded}
    <div class="devices" id={`devices-${slug}`}>
      {#each room.loads as load (load.id)}
        <DeviceRow {load} snapshot={states[load.id]} protection={protection.get(load.id) ?? null} favorite={dash.layout.favorites.loads.includes(load.id)}
          disabled={!dash.active} stale={dash.stale} onwrite={dash.write} onfavorite={dash.toggleFavoriteLoad} {onedit} />
      {/each}
    </div>
  {/if}
</section>
