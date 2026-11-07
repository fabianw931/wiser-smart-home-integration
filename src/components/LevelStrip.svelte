<script>
  // Room-at-a-glance: one glyph per light or blind. Amber fill = light level, slate fill from the top = blind closed share.
  // Hollow = off/open, dashed = no valid reading. Purely visual; the text summary carries the meaning.
  let { glyphs } = $props();
</script>

<span class="strip" aria-hidden="true">
  {#each glyphs as glyph (glyph.id)}
    <span class="glyph" class:blind={glyph.kind === 'blind'} class:unknown={glyph.fill === null} title={glyph.name}>
      {#if glyph.fill !== null}<span class="fill" style:height={`${Math.round(glyph.fill * 100)}%`}></span>{/if}
    </span>
  {/each}
</span>
