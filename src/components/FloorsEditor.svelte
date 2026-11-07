<script>
  import Icon from './Icon.svelte';
  let { dash } = $props();

  const layout = $derived(dash.layout);
  const placed = $derived(new Set(layout.floors.flatMap(floor => floor.rooms)));
  const unplaced = $derived(dash.roomNames.filter(name => !placed.has(name)));
  const known = $derived(new Set(dash.roomNames));
  let newFloor = $state('');
  let busy = $state(false);

  async function save(floors) {
    if (busy) return;
    busy = true;
    try { return await dash.saveLayout({ ...layout, floors }); } finally { busy = false; }
  }
  const swap = (list, index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= list.length) return list;
    const next = [...list];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  };
  async function addFloor(event) {
    event.preventDefault();
    const name = newFloor.trim();
    if (!name) return;
    if (await save([...layout.floors, { name, rooms: [] }])) newFloor = '';
  }
  const rename = (index, name) => save(layout.floors.map((floor, i) => i === index ? { ...floor, name } : floor));
  const removeFloor = index => save(layout.floors.filter((_, i) => i !== index));
  const assign = (room, index) => save(layout.floors.map((floor, i) => i === index ? { ...floor, rooms: [...floor.rooms, room] } : floor));
  const unassign = (index, room) => save(layout.floors.map((floor, i) => i === index ? { ...floor, rooms: floor.rooms.filter(name => name !== room) } : floor));
  const moveRoom = (index, roomIndex, delta) => save(layout.floors.map((floor, i) => i === index ? { ...floor, rooms: swap(floor.rooms, roomIndex, delta) } : floor));
</script>

<section class="settings-section" aria-labelledby="floors-heading">
  <h2 id="floors-heading">Rooms &amp; floors</h2>
  <p class="muted">Floors group rooms on the Home page. This arrangement is saved on this computer only and is never sent to the gateway. Rooms come from your personal room labels or, if you have none, the gateway.</p>

  <form class="inline-form" onsubmit={addFloor}>
    <label><span class="label-text">New floor</span>
      <input class="input" bind:value={newFloor} maxlength="100" placeholder="e.g. Ground floor" disabled={busy} /></label>
    <button class="btn btn-primary" type="submit" disabled={busy || !newFloor.trim()}>Add floor</button>
  </form>

  {#if !layout.floors.length}
    <p class="empty">No floors yet. Add one, then assign rooms to it. Until then Home lists all rooms alphabetically.</p>
  {/if}

  {#each layout.floors as floor, index (floor.name)}
    <section class="panel floor-edit" aria-label={`Floor ${floor.name}`}>
      <div class="floor-edit-head">
        <label><span class="label-text">Floor name</span>
          <input class="input" value={floor.name} maxlength="100" disabled={busy} onchange={event => { const value = event.currentTarget.value.trim(); if (value && value !== floor.name) rename(index, value); else event.currentTarget.value = floor.name; }} /></label>
        <div class="row-buttons">
          <button class="icon-btn" type="button" aria-label={`Move floor ${floor.name} up`} disabled={busy || index === 0} onclick={() => save(swap(layout.floors, index, -1))}><Icon name="up" size={18} /></button>
          <button class="icon-btn" type="button" aria-label={`Move floor ${floor.name} down`} disabled={busy || index === layout.floors.length - 1} onclick={() => save(swap(layout.floors, index, 1))}><Icon name="down" size={18} /></button>
          <button class="btn btn-ghost" type="button" disabled={busy} onclick={() => removeFloor(index)}>Remove floor</button>
        </div>
      </div>
      {#if !floor.rooms.length}<p class="muted small">No rooms on this floor yet.</p>{/if}
      <ul class="room-list">
        {#each floor.rooms as room, roomIndex (room)}
          <li>
            <span class="room-label">{room}{#if !known.has(room)}<span class="muted small"> · no devices now</span>{/if}</span>
            <span class="row-buttons">
              <button class="icon-btn" type="button" aria-label={`Move ${room} up`} disabled={busy || roomIndex === 0} onclick={() => moveRoom(index, roomIndex, -1)}><Icon name="up" size={18} /></button>
              <button class="icon-btn" type="button" aria-label={`Move ${room} down`} disabled={busy || roomIndex === floor.rooms.length - 1} onclick={() => moveRoom(index, roomIndex, 1)}><Icon name="down" size={18} /></button>
              <button class="btn btn-ghost" type="button" disabled={busy} aria-label={`Remove ${room} from ${floor.name}`} onclick={() => unassign(index, room)}>Remove</button>
            </span>
          </li>
        {/each}
      </ul>
    </section>
  {/each}

  {#if unplaced.length}
    <section class="panel" aria-label="Rooms without a floor">
      <h3>{layout.floors.length ? 'Rooms without a floor' : 'Rooms'}</h3>
      <ul class="room-list">
        {#each unplaced as room (room)}
          <li>
            <span class="room-label">{room}</span>
            {#if layout.floors.length}
              <select class="select" aria-label={`Assign ${room} to a floor`} disabled={busy} value="" onchange={event => { const value = event.currentTarget.value; event.currentTarget.value = ''; if (value !== '') assign(room, Number(value)); }}>
                <option value="" disabled>Move to floor…</option>
                {#each layout.floors as floor, index (floor.name)}<option value={String(index)}>{floor.name}</option>{/each}
              </select>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</section>
