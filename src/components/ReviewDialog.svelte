<script>
  // Gateway metadata edits are real configuration changes, so they are confirmed in a protected dialog.
  let { dash } = $props();
  let dialog;
  const review = $derived(dash.review);
  $effect(() => {
    if (review && !dialog.open) dialog.showModal();
    if (!review && dialog.open) dialog.close();
  });
  const roomName = id => dash.rooms.find(room => room.id === id)?.name;
</script>

<dialog bind:this={dialog} class="dialog" aria-labelledby="review-dialog-heading" onclose={() => dash.closeReview()}>
  <h2 id="review-dialog-heading">Change gateway metadata?</h2>
  {#if review}
    <p>{dash.reviewLoad?.name || 'Load ' + review.id} · gateway {dash.host}</p>
    <dl class="draft-diff">
      {#each Object.entries(review.changes) as [field, value]}
        <div><dt>{field === 'room' ? 'Room' : 'Name'}</dt>
          <dd>{field === 'room' ? roomName(review.expected[field]) || 'Unassigned' : String(review.expected[field] ?? 'Unnamed')} → <strong>{field === 'room' ? roomName(value) || 'Room ' + value : String(value)}</strong></dd></div>
      {/each}
    </dl>
    <p>This is a real gateway configuration change, separate from your personal details. Values are checked again first. Device commissioning and installer settings are not changed.</p>
    {#if dash.reviewConflict}<p class="warn" role="alert">Gateway values changed. Refresh and review a new change.</p>{/if}
    <div class="actions">
      <button class="btn btn-outline" type="button" onclick={() => dash.closeReview()}>Cancel</button>
      <button class="btn btn-primary" type="button" disabled={dash.busy || dash.demo || !dash.connected || dash.reviewConflict} onclick={dash.applyReview}>Apply this change to gateway</button>
    </div>
  {/if}
</dialog>
