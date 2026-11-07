<script>
  import { onMount } from 'svelte';
  import { readTheme, applyTheme, saveTheme, THEME_KEY } from '../theme.js';
  import { THEME_GROUPS } from '../themes.js';
  let preference = readTheme();
  let saved = true;
  function change(event) {
    preference = event.currentTarget.value;
    saved = saveTheme(preference);
  }
  onMount(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const update = () => applyTheme(preference);
    const sync = event => {
      if (event.key === THEME_KEY || event.key === null) { preference = readTheme(); saved = true; update(); }
    };
    media.addEventListener('change', update);
    window.addEventListener('storage', sync);
    update();
    return () => { media.removeEventListener('change', update); window.removeEventListener('storage', sync); };
  });
</script>

<div class="theme-setting">
  <label class="theme-picker">Appearance
    <select class="select" value={preference} onchange={change}>
      {#each THEME_GROUPS as group}
        <optgroup label={group.label}>
          {#each group.themes as theme}<option value={theme.id}>{theme.label}</option>{/each}
        </optgroup>
      {/each}
    </select>
  </label>
  {#if !saved}<p class="text-xs" role="status">Theme changed for this visit; browser storage is unavailable.</p>{/if}
</div>
