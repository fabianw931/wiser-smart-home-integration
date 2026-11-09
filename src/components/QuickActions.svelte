<script>
  import { ACTIONS, actionTargets, kindOf } from '../home.js';

  // Lights act immediately. Blind actions move motors, so the button turns into an inline confirmation.
  let { loads, states, scope = 'home', dash, disabled = false } = $props();

  const lights = $derived(loads.filter(load => kindOf(load) === 'light'));
  const blinds = $derived(loads.filter(load => kindOf(load) === 'blind'));
  const lightsOnCount = $derived(actionTargets('lights-off', loads, states).length);
  const lightsOffCount = $derived(actionTargets('lights-on', loads, states).length);
  const blindsOpenable = $derived(actionTargets('blinds-open', loads, states).length);
  const blindsClosable = $derived(actionTargets('blinds-close', loads, states).length);
  const blindsTiltable = $derived(actionTargets('blinds-tilt', loads, states).length);
  const counts = $derived({ 'blinds-open': blindsOpenable, 'blinds-tilt': blindsTiltable, 'blinds-close': blindsClosable });
  const key = action => `${action}:${loads.map(load => load.id).join(',')}`;
  const pending = action => dash.pendingAction === key(action);
  const label = action => ACTIONS[action].label + (scope === 'home' ? ' (all)' : '');
</script>

<div class="actions" role="group" aria-label={scope === 'home' ? 'Whole-home actions' : `${scope} actions`}>
  {#if lights.length}
    {#if lightsOnCount || !lightsOffCount}
      <button class="btn btn-outline" type="button" disabled={disabled || !lightsOnCount} onclick={() => dash.requestAction('lights-off', loads)}>{label('lights-off')}</button>
    {:else}
      <button class="btn btn-outline" type="button" disabled={disabled} onclick={() => dash.requestAction('lights-on', loads)}>{label('lights-on')}</button>
    {/if}
  {/if}
  {#if blinds.length}
    {#each ['blinds-open', 'blinds-tilt', 'blinds-close'] as action}
      {@const count = counts[action]}
      {#if pending(action)}
        <span class="confirm" role="group" aria-label={`Confirm ${ACTIONS[action].label.toLowerCase()}`}>
          <button class="btn btn-warning" type="button" onclick={() => dash.requestAction(action, loads)}>Confirm: {ACTIONS[action].label.toLowerCase()} ({count})</button>
          <button class="btn btn-ghost" type="button" onclick={dash.cancelAction}>Cancel</button>
        </span>
      {:else}
        <button class="btn btn-outline" type="button" disabled={disabled || !count} onclick={() => dash.requestAction(action, loads)}>{label(action)}</button>
      {/if}
    {/each}
  {/if}
</div>
