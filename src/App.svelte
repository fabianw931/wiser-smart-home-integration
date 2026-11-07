<script>
  import { onMount, onDestroy } from 'svelte';
  import { Dashboard } from './dashboard.svelte.js';
  import { watchTheme } from './theme.js';
  import TopNav from './components/TopNav.svelte';
  import Notices from './components/Notices.svelte';
  import ConnectionForm from './components/ConnectionForm.svelte';
  import HomeView from './components/HomeView.svelte';
  import SettingsView from './components/SettingsView.svelte';
  import InstallationPanel from './components/InstallationPanel.svelte';
  import QuickEditor from './components/QuickEditor.svelte';
  import ReviewDialog from './components/ReviewDialog.svelte';

  const dash = new Dashboard();
  const PAGES = ['home', 'sensors', 'settings'];
  const SECTIONS = ['floors', 'names', 'connection', 'appearance', 'diagnostics'];

  function parse() {
    const [page, section] = location.hash.replace(/^#\/?/, '').split('/');
    return { page: PAGES.includes(page) ? page : 'home', section: SECTIONS.includes(section) ? section : 'floors' };
  }
  let route = $state(parse());
  let sensorKind = $state('Weather');
  let editingLoad = $state(null);

  function go(page, section) {
    const next = { page, section: section ?? (page === 'settings' ? route.section : 'floors') };
    location.hash = `/${next.page}${next.page === 'settings' ? '/' + next.section : ''}`;
    route = next;
    window.scrollTo({ top: 0 });
  }

  onMount(() => {
    dash.start();
    const stopTheme = watchTheme();
    const sync = () => { route = parse(); };
    window.addEventListener('hashchange', sync);
    return () => { stopTheme(); window.removeEventListener('hashchange', sync); };
  });
  onDestroy(() => dash.stop());

  // The whole app is one place; Home is always reachable even before connecting.
  const view = $derived(dash.active ? route.page : 'connect');
</script>

<TopNav {dash} page={route.page} onnavigate={go} />

<main class="page" id="main">
  <Notices {dash} />

  {#if view === 'connect'}
    {#key dash.epoch}
      <ConnectionForm bind:host={dash.host} disabled={dash.busy} remembered={dash.remembered} onconnect={dash.connect} onreconnect={dash.reconnect} onexplore={dash.explore} />
    {/key}
    {#if !dash.busy}<p class="center muted small" role="status">{dash.notice}</p>{/if}
  {:else if view === 'home'}
    <h1 class="sr-only">Home</h1>
    <HomeView {dash} onedit={load => (editingLoad = { ...load })} onnavigate={go} />
  {:else if view === 'sensors'}
    <div class="page-head">
      <h1>Sensors &amp; buttons</h1>
      <div class="segments" role="group" aria-label="Show">
        {#each [['Weather', 'Weather & sensors'], ['Buttons', 'Buttons']] as [id, label] (id)}
          <button type="button" class="seg" class:active={sensorKind === id} aria-pressed={sensorKind === id} onclick={() => (sensorKind = id)}>{label}</button>
        {/each}
      </div>
    </div>
    {#key sensorKind}<InstallationPanel kind={sensorKind} resources={dash.resources} loads={dash.displayed} disabled={dash.busy || !dash.connected} demo={dash.demo} refreshing={dash.diagnosticsBusy} onidentify={dash.identifyButton} />{/key}
  {:else}
    <h1 class="sr-only">Settings</h1>
    <SettingsView {dash} section={route.section} onsection={section => go('settings', section)} />
  {/if}

  <footer class="foot">Local access only · Use a trusted LAN. Gateway HTTP is unencrypted; do not expose this app's port.</footer>
</main>

<ReviewDialog {dash} />
{#if editingLoad}<QuickEditor load={editingLoad} rooms={dash.roomNames} onsave={dash.saveLocal} onclose={() => (editingLoad = null)} />{/if}
