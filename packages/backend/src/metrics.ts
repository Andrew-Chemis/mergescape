/**
 * Custom metrics through CloudWatch Embedded Metric Format: one JSON line per invocation on stdout, which
 * CloudWatch turns into metrics. No SDK call, no extra IAM. The line carries counts only.
 */

export const METRIC_NAMES = [
  'events_scored',
  'dropped_unlinked',
  'dropped_bot',
  'dropped_installation',
  'duplicates',
] as const;

export type MetricName = (typeof METRIC_NAMES)[number];

export interface Metrics {
  count(name: MetricName, value?: number): void;
  /** Emit what was counted since the last flush, then reset. */
  flush(): void;
}

export const NAMESPACE = 'Mergescape';

export function createEmfMetrics(
  service: string,
  write: (line: string) => void = console.log,
  now: () => number = Date.now,
): Metrics {
  const counts = new Map<MetricName, number>();
  return {
    count(name, value = 1) {
      counts.set(name, (counts.get(name) ?? 0) + value);
    },
    flush() {
      if (counts.size === 0) {
        return;
      }
      const values = Object.fromEntries(counts);
      write(
        JSON.stringify({
          _aws: {
            Timestamp: now(),
            CloudWatchMetrics: [
              {
                Namespace: NAMESPACE,
                Dimensions: [['Service']],
                Metrics: [...counts.keys()].map((name) => ({ Name: name, Unit: 'Count' })),
              },
            ],
          },
          Service: service,
          ...values,
        }),
      );
      counts.clear();
    },
  };
}

/** In-memory metrics for tests and for code paths that do not report. */
export function createRecordingMetrics(): Metrics & { readonly totals: Map<MetricName, number> } {
  const totals = new Map<MetricName, number>();
  return {
    totals,
    count(name, value = 1) {
      totals.set(name, (totals.get(name) ?? 0) + value);
    },
    flush() {},
  };
}
