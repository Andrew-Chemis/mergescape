/**
 * Runs `tick` once now and then every second for as long as `active()` holds, and stops as soon as it
 * does not. A screen with a live countdown uses it to move its clock only while a countdown is showing,
 * instead of waking the page every second to redraw nothing. Call it while a component initialises.
 *
 * The timer restarts only when `active()` changes, not each time `tick` moves the clock `active()` reads.
 * It runs before the DOM updates (`$effect.pre`), so a countdown that has just begun draws its first
 * frame from a fresh clock rather than the one left over from the last time something ticked.
 */
export function tickWhile(active: () => boolean, tick: () => void): void {
  const running = $derived.by(active);
  $effect.pre(() => {
    if (!running) {
      return;
    }
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  });
}
