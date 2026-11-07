<script>
  import Icon from './Icon.svelte';
  import { weatherChips } from '../home.js';
  let { sensors, onmore } = $props();
  const chips = $derived(weatherChips(sensors));
  const icon = chip => /rain|hail/i.test(chip.label) ? 'drop' : /wind/i.test(chip.label) ? 'wind' : /lux|daylight|bright|illum/i.test(chip.label) ? 'sun' : 'temp';
</script>

{#if chips.length}
  <section class="weather" aria-label="Weather and sensors">
    <ul>
      {#each chips as chip (chip.key)}
        <li class:alert={chip.alert}><Icon name={icon(chip)} size={16} /><span class="chip-label">{chip.label}</span><strong class="tabular">{chip.value}</strong></li>
      {/each}
    </ul>
    <button class="link" type="button" onclick={onmore}>All sensors</button>
  </section>
{/if}
