<script lang="ts">
  interface Props {
    id: string;
    checked: boolean;
    /** The visible text and the accessible name of the switch. */
    label: string;
    /** Id of the element that says more (a status line), for assistive technology. */
    describedBy?: string | undefined;
    disabled?: boolean;
    onchange: (event: Event & { currentTarget: HTMLInputElement }) => void;
  }

  let { id, checked, label, describedBy, disabled = false, onchange }: Props = $props();
</script>

<!--
  A real checkbox with the switch role, so it is focusable, works with the keyboard and reads as "switch,
  on/off" to a screen reader. Only its look is replaced; the text On or Off repeats the state for people
  who cannot judge the colour, and is hidden from assistive technology because the role already says it.
-->
<label class="switch" for={id}>
  <input
    {id}
    type="checkbox"
    role="switch"
    {checked}
    {disabled}
    aria-describedby={describedBy}
    {onchange}
  />
  <span class="track" aria-hidden="true"><span class="knob"></span></span>
  <span class="switch-text">
    {label}
    <b class="state num" aria-hidden="true">{checked ? 'On' : 'Off'}</b>
  </span>
</label>

<style>
  .switch {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    min-height: 44px;
    cursor: pointer;
  }

  /* The real checkbox stays in the page, focusable and clickable through its label; only its look is
     replaced. */
  .switch input {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    border: 0;
  }

  .track {
    flex: none;
    width: 48px;
    height: 26px;
    padding: 2px;
    border: 2px solid #000;
    background: var(--track);
    box-shadow: inset 0 0 0 2px var(--wood);
    display: flex;
    align-items: center;
  }

  .knob {
    width: 16px;
    height: 16px;
    background: var(--fg-dim);
    border: 2px solid #000;
  }

  .switch input:checked + .track {
    background: var(--act-done);
    justify-content: flex-end;
  }

  .switch input:checked + .track .knob {
    background: var(--xp);
  }

  .switch input:focus-visible + .track {
    outline: 3px solid var(--focus);
    outline-offset: 2px;
    box-shadow:
      inset 0 0 0 2px var(--wood),
      0 0 0 2px #000;
  }

  .switch input:disabled + .track {
    opacity: 0.55;
  }

  .state {
    margin-left: 6px;
    padding: 1px 6px;
    background: var(--stone2);
    font-size: 12px;
  }
</style>
