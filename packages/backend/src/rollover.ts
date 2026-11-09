/** The EventBridge input of the weekly schedule (`Input: '{"action":"rollover"}'` in the SAM template). */
export interface RolloverEvent {
  action: 'rollover';
}

/**
 * True for the scheduled invocation and only for it. A Function URL request always carries a
 * `requestContext`, so no HTTP caller can reach the rollover by crafting a body or a path.
 */
export function isRolloverEvent(event: unknown): event is RolloverEvent {
  return (
    typeof event === 'object' &&
    event !== null &&
    !('requestContext' in event) &&
    (event as { action?: unknown }).action === 'rollover'
  );
}

/**
 * Monday 00:05 UTC run rollover. A stub until task 15 (close last week, create this week's run, targets,
 * Mogul, Pledge hand and shop seed for every profile). It touches nothing and logs nothing.
 */
export function rollover(): Promise<{ statusCode: 200 }> {
  return Promise.resolve({ statusCode: 200 });
}
