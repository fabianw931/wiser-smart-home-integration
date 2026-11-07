<script>
  import Icon from './Icon.svelte';
  import RoomBlock from './RoomBlock.svelte';
  import DeviceRow from './DeviceRow.svelte';
  import QuickActions from './QuickActions.svelte';
  import WeatherStrip from './WeatherStrip.svelte';
  import { buildHome, summarize, loadName, protectionFor, kindOf } from '../home.js';

  let { dash, onedit, onnavigate } = $props();

  let floorTab = $state('all');
  let query = $state('');
  let opened = $state({}); // explicit user choices; absent keys follow the default

  const needle = $derived(query.trim().toLowerCase());
  const visibleLoads = $derived(dash.displayed.filter(load => !needle || loadName(load).toLowerCase().includes(needle)));
  const model = $derived(buildHome(visibleLoads, dash.layout));
  const protection = $derived(protectionFor(dash.resources.westgroups));
  const controllable = $derived(dash.displayed.filter(load => ['light', 'blind'].includes(kindOf(load))));
  const sum = $derived(summarize(controllable, dash.states));

  const pinnedRoomKeys = $derived(new Set(dash.layout.favorites.rooms));
  const pinnedRooms = $derived(model.floors.flatMap(floor => floor.rooms).filter(room => pinnedRoomKeys.has(room.key)));
  const pinnedLoads = $derived(visibleLoads.filter(load => dash.layout.favorites.loads.includes(load.id)));
  const floors = $derived(model.floors.map(floor => ({ ...floor, rooms: floor.rooms.filter(room => !pinnedRoomKeys.has(room.key)) })).filter(floor => floor.rooms.length));
  const tabs = $derived(model.hasFloors ? [{ id: 'all', label: 'All' }, ...model.floors.map(floor => ({ id: floor.name, label: floor.name }))] : []);
  const shownFloors = $derived(floorTab === 'all' || !model.hasFloors ? floors : floors.filter(floor => floor.name === floorTab));
  const activeTab = $derived(tabs.some(tab => tab.id === floorTab) ? floorTab : 'all');
  const deviceCount = $derived(controllable.length);
  const defaultOpen = $derived(!!needle || deviceCount <= 8);
  const isOpen = key => opened[key] ?? defaultOpen;
  const toggle = key => { opened = { ...opened, [key]: !isOpen(key) }; };
  const allRooms = $derived(model.floors.flatMap(floor => floor.rooms));
  const everythingOpen = $derived(allRooms.length > 0 && allRooms.every(room => isOpen(room.key)));
  const setAll = open => { opened = Object.fromEntries(allRooms.map(room => [room.key, open])); };

  const parts = $derived.by(() => {
    const list = [];
    if (sum.lights) list.push(sum.lightsUnknown === sum.lights ? 'Lights: no readings' : `${sum.lightsOn} of ${sum.lights} lights on`);
    if (sum.blinds) list.push(sum.blindsUnknown === sum.blinds ? 'Blinds: no readings' : `${sum.blindsClosed} of ${sum.blinds} blinds closed`);
    return list;
  });
  const roomLabel = load => load.room || '';
</script>

<div class="home">
  <section class="overview" aria-label="Home overview">
    <p class="overview-line tabular" data-testid="overview">{#if parts.length}{#each parts as part, index}<strong>{part}</strong>{#if index < parts.length - 1}<span class="sep">&nbsp;·&nbsp;</span>{/if}{/each}{:else}No lights or blinds reported{/if}</p>
    <QuickActions loads={controllable} states={dash.states} scope="home" {dash} disabled={dash.stale || !dash.active} />
  </section>

  <WeatherStrip sensors={dash.resources.sensors} onmore={() => onnavigate('sensors')} />

  <div class="home-tools">
    {#if tabs.length}
      <div class="segments" role="group" aria-label="Floor">
        {#each tabs as tab (tab.id)}
          <button type="button" class="seg" class:active={activeTab === tab.id} aria-pressed={activeTab === tab.id} onclick={() => (floorTab = tab.id)}>{tab.label}</button>
        {/each}
      </div>
    {/if}
    <input class="input search" type="search" placeholder="Search devices" aria-label="Search devices" bind:value={query} />
    {#if allRooms.length > 1}<button class="btn btn-ghost" type="button" onclick={() => setAll(!everythingOpen)}>{everythingOpen ? 'Collapse all' : 'Expand all'}</button>{/if}
  </div>

  {#if !dash.loads.length}
    <p class="empty">No lights or blinds reported by this gateway.</p>
  {:else if !visibleLoads.length}
    <p class="empty">No devices match “{query}”.</p>
  {/if}

  {#if pinnedRooms.length || pinnedLoads.length}
    <section class="pinned" aria-labelledby="pinned-heading">
      <h2 id="pinned-heading"><Icon name="star" size={16} /> Pinned</h2>
      {#each pinnedRooms as room (room.key)}
        <RoomBlock {room} {dash} {protection} expanded={isOpen(room.key)} ontoggle={() => toggle(room.key)} {onedit} />
      {/each}
      {#if pinnedLoads.length}
        <div class="devices pinned-devices">
          {#each pinnedLoads as load (load.id)}
            <DeviceRow {load} snapshot={dash.states[load.id]} protection={protection.get(load.id) ?? null} favorite={true} idPrefix="pinned-" roomLabel={roomLabel(load)}
              disabled={!dash.active} stale={dash.stale} onwrite={dash.write} onfavorite={dash.toggleFavoriteLoad} {onedit} />
          {/each}
        </div>
      {/if}
    </section>
  {/if}

  {#each shownFloors as floor (floor.name)}
    <section class="floor" aria-label={floor.name || 'Rooms'}>
      {#if floor.name}<h2 class="floor-title">{floor.name}</h2>{/if}
      {#each floor.rooms as room (room.key)}
        <RoomBlock {room} {dash} {protection} expanded={isOpen(room.key)} ontoggle={() => toggle(room.key)} {onedit} />
      {/each}
    </section>
  {/each}

  {#if dash.loads.length && !model.hasFloors}
    <p class="hint">Group rooms into floors to browse a larger home faster. <button class="link" type="button" onclick={() => onnavigate('settings', 'floors')}>Set up floors</button></p>
  {/if}
</div>
