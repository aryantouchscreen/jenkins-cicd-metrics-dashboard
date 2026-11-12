# Metric definitions

All numbers in the dashboard follow these rules (implemented in `src/metrics.js`, tested in `test/metrics.test.js`).

**Completed build:** result is SUCCESS, UNSTABLE or FAILURE. ABORTED, NOT_BUILT and still-running builds are not completed
and are left out of rates and duration statistics (aborted builds are still counted separately).

| Metric | Definition |
|---|---|
| Success rate | `SUCCESS / completed builds x 100`. UNSTABLE counts as not successful. Empty denominator shows "–". |
| Duration | Average, min, max, median (p50) and 95th percentile (linear interpolation) of completed builds. Zero or missing durations are ignored. |
| Daily trend | Completed builds grouped by UTC day: builds, failures, success rate, average duration. |
| Queue | Current Jenkins queue. Waiting time = now minus `inQueueSince`. Items above `QUEUE_THRESHOLD_SECONDS` are marked long. |
| Flaky candidate | Look at the last 10 completed builds in the selected time range (minimum 5). `flip rate = pass/fail switches / (builds - 1)`. Flagged when the window has at least one pass and one fail and flip rate >= 0.4. |
| Leaderboards | Top 5 jobs by failure count, average duration and build volume in the current filters. |
| Time range | Builds with a start time inside the last N days (or all history). |
| Folder filter | Folder path of the job, including sub-folders. |
| Status filter | Result of the job's most recent completed build (over all history, not only the time range). |

**Why flip rate?** A job that failed 5 times and was then fixed has one switch (flip rate 0.11) and is not flagged.
A job that alternates pass, fail, pass, fail has a flip rate near 1.0 and is flagged.
