// Productivity multiplier applied to raw pick/pack benchmark rates when computing
// hours of work. 1.125 reflects observed throughput uplift over baseline benchmarks
// during typical shifts. Tune cautiously — used everywhere flow hours are derived.
export const BACKLOG_MULTIPLIER = 1.125;

// Forecast volume safety multiplier — adds 12.5% buffer to the raw forecast so
// headcount planning doesn't undershoot.
export const FORECAST_MULTIPLIER = 1.125;

// How often the live Metabase dashboard refetches data, in milliseconds.
export const METABASE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

// Maximum random jitter added to a refetch delay so concurrent clients don't
// stampede the edge function at the same instant.
export const METABASE_REFRESH_JITTER_MS = 30 * 1000;

// Polling/retry parameters for the Metabase fetch when a request fails. Backoff
// doubles up to MAX from BASE; the next successful fetch resets the schedule.
export const METABASE_RETRY_BASE_MS = 30 * 1000;
export const METABASE_RETRY_MAX_MS = 5 * 60 * 1000;
