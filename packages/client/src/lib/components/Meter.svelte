<script lang="ts">
  import { clamp01 } from '@mergescape/shared';

  interface Props {
    /** 0 to 1. */
    fraction: number;
    /** Text under the bar, e.g. `Lv 42 in 1,512,402`. Also the value read out to assistive technology. */
    label: string;
    /** What the bar measures, e.g. `Experience to level 42`. */
    name: string;
    tone?: 'xp' | 'gold';
  }

  let { fraction, label, name, tone = 'xp' }: Props = $props();

  const percent = $derived(Math.round(clamp01(fraction) * 1000) / 10);
</script>

<div class="meter-wrap">
  <div
    class="meter"
    class:gold={tone === 'gold'}
    role="progressbar"
    aria-label={name}
    aria-valuemin="0"
    aria-valuemax="100"
    aria-valuenow={percent}
    aria-valuetext={label}
  >
    <div class="fill" style:--w="{percent}%"></div>
  </div>
  <!-- The bar announces this text as its value; the visible copy is not read out twice. -->
  <span class="label num" aria-hidden="true">{label}</span>
</div>
