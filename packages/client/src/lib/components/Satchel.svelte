<script lang="ts">
  import { SUPPLY_KINDS } from '@mergescape/shared';
  import type { MaterialKind, Satchel } from '@mergescape/shared';
  import { TIER_MATERIAL_KINDS } from '../depth';
  import { formatInt, MATERIAL_LABELS } from '../format';

  interface Props {
    satchel: Satchel;
    /** Heading for assistive technology; the strip itself is not headed. */
    label?: string;
  }

  let { satchel, label = 'Satchel' }: Props = $props();

  // The six supplies always; Silver and the rarer materials once an expedition has found some.
  const kinds = $derived<MaterialKind[]>([
    ...SUPPLY_KINDS,
    ...TIER_MATERIAL_KINDS.filter((kind) => (satchel[kind as keyof Satchel] ?? 0) > 0),
  ]);
</script>

<ul class="satchel" aria-label={label}>
  {#each kinds as kind (kind)}
    <li class="item {kind}">
      <span class="pip" aria-hidden="true"></span>
      <span class="k">{MATERIAL_LABELS[kind]}</span>
      <b class="num">{formatInt(satchel[kind as keyof Satchel] ?? 0)}</b>
    </li>
  {/each}
</ul>

<style>
  .satchel {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px 3px 6px;
    background: var(--slot);
    border: 2px solid #000;
    font-size: 12px;
    color: var(--fg-dim);
  }

  .item b {
    color: var(--parch);
    font-size: 13px;
  }

  /* A small coloured square for each supply, so the strip can be scanned without reading. */
  .pip {
    width: 8px;
    height: 8px;
    background: var(--pip, var(--fg-dim));
    border: 1px solid #000;
    flex: none;
  }

  .ore {
    --pip: #c0794a;
  }

  .timber {
    --pip: #8c5a2b;
  }

  .lore {
    --pip: #7fb0ff;
  }

  .ink {
    --pip: #a371f7;
  }

  .provisions {
    --pip: #ffd23f;
  }

  .flux {
    --pip: #ff9c2b;
  }

  .silver {
    --pip: #cfd8e6;
  }

  .mithril {
    --pip: #2f8f93;
  }

  .rune {
    --pip: #3a8fb5;
  }

  .dragon {
    --pip: #b3272b;
  }
</style>
