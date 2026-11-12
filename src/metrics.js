"use strict";
/**
 * Pure metric calculations for the Jenkins build metrics dashboard.
 * Every function takes plain objects and an explicit `nowMs`, so it is easy to unit test.
 *
 * Build: { number, result, duration_ms, timestamp_ms }
 * Job:   { full_name, name, url, builds: [Build] }
 */

const COMPLETED = ["SUCCESS", "UNSTABLE", "FAILURE"]; // ABORTED / NOT_BUILT are not "completed"
const DAY_MS = 86_400_000;
const SORT_KEYS = ["name", "builds", "failures", "success_rate", "avg_duration_ms", "last_result"];
const CSV_COLUMNS = ["job", "folder", "builds", "success", "unstable", "failures", "aborted",
  "success_rate_pct", "avg_duration_s", "p95_duration_s", "last_result", "flaky_candidate"];

const isCompleted = (b) => COMPLETED.includes(b.result);
const round = (v, digits) => { const f = 10 ** digits; return Math.round(v * f) / f; };

/** Linear-interpolated percentile (0-100). Returns null for an empty list. */
function percentile(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const k = ((s.length - 1) * p) / 100;
  const lo = Math.floor(k), hi = Math.ceil(k);
  return s[lo] + (s[hi] - s[lo]) * (k - lo);
}

function folderOf(fullName) {
  const i = fullName.lastIndexOf("/");
  return i === -1 ? "" : fullName.slice(0, i);
}

function buildsInRange(builds, days, nowMs) {
  if (!days) return [...builds];
  const cutoff = nowMs - days * DAY_MS;
  return builds.filter((b) => b.timestamp_ms >= cutoff);
}

/** success_rate = SUCCESS / (SUCCESS + UNSTABLE + FAILURE) * 100 */
function outcomeCounts(builds) {
  const c = { success: 0, unstable: 0, failure: 0, aborted: 0, other: 0 };
  const keys = { SUCCESS: "success", UNSTABLE: "unstable", FAILURE: "failure", ABORTED: "aborted" };
  for (const b of builds) c[keys[b.result] || "other"] += 1;
  c.completed = c.success + c.unstable + c.failure;
  c.success_rate = c.completed ? round((100 * c.success) / c.completed, 1) : null;
  return c;
}

/** Duration stats over completed builds, ignoring missing or zero durations. */
function durationStats(builds) {
  const d = builds.filter((b) => isCompleted(b) && (b.duration_ms || 0) > 0).map((b) => b.duration_ms);
  if (!d.length) return { count: 0, avg: null, min: null, max: null, p50: null, p95: null };
  return { count: d.length, avg: d.reduce((a, x) => a + x, 0) / d.length, min: Math.min(...d),
    max: Math.max(...d), p50: percentile(d, 50), p95: percentile(d, 95) };
}

/**
 * Flag a job as a flaky *candidate*. Looks at the last `window` completed builds.
 * flip_rate = how often consecutive builds switch between pass and fail. Flagged when the window has
 * at least one pass and one fail and flip_rate >= threshold. Needs `minSamples` builds.
 */
function detectFlaky(builds, { window = 10, minSamples = 5, threshold = 0.4 } = {}) {
  const done = builds.filter(isCompleted).sort((a, b) => a.timestamp_ms - b.timestamp_ms).slice(-window);
  const n = done.length;
  if (n < minSamples) return { flaky: false, flip_rate: null, sample: n, reason: "not enough builds" };
  const ok = done.map((b) => b.result === "SUCCESS");
  let flips = 0;
  for (let i = 1; i < ok.length; i++) if (ok[i] !== ok[i - 1]) flips += 1;
  const rate = flips / (n - 1);
  const flaky = ok.some(Boolean) && !ok.every(Boolean) && rate >= threshold;
  return { flaky, flip_rate: round(rate, 2), sample: n, reason: flaky ? "alternates between pass and fail" : "" };
}

/** Group completed builds by UTC day. */
function dailyTrend(builds) {
  const buckets = new Map();
  for (const b of builds) {
    if (!isCompleted(b)) continue;
    const day = new Date(b.timestamp_ms).toISOString().slice(0, 10);
    if (!buckets.has(day)) buckets.set(day, []);
    buckets.get(day).push(b);
  }
  return [...buckets.keys()].sort().map((day) => {
    const bs = buckets.get(day), c = outcomeCounts(bs), d = durationStats(bs);
    return { date: day, builds: c.completed, failures: c.failure, success_rate: c.success_rate, avg_duration_ms: d.avg };
  });
}

/** Current queue: length, waiting time per item, and items over the threshold. */
function queueSummary(items, nowMs, thresholdS = 300) {
  const rows = items.map((it) => {
    const waiting = Math.max(0, (nowMs - it.in_queue_since_ms) / 1000);
    return { id: it.id ?? null, job: it.job || "", waiting_s: round(waiting, 1), why: it.why || "", long: waiting >= thresholdS };
  }).sort((a, b) => b.waiting_s - a.waiting_s);
  const waits = rows.map((r) => r.waiting_s);
  return { length: rows.length, max_wait_s: waits.length ? Math.max(...waits) : 0,
    avg_wait_s: waits.length ? round(waits.reduce((a, x) => a + x, 0) / waits.length, 1) : 0,
    long_count: rows.filter((r) => r.long).length, threshold_s: thresholdS, items: rows };
}

function jobRow(job, days, nowMs, flakyCfg) {
  const builds = buildsInRange(job.builds, days, nowMs);
  const c = outcomeCounts(builds), d = durationStats(builds);
  const allDone = job.builds.filter(isCompleted).sort((a, b) => a.timestamp_ms - b.timestamp_ms);
  const fl = detectFlaky(builds, flakyCfg);
  return { full_name: job.full_name, name: job.name || job.full_name, folder: folderOf(job.full_name),
    url: job.url || "", builds: c.completed, success: c.success, unstable: c.unstable, failures: c.failure,
    aborted: c.aborted, success_rate: c.success_rate, avg_duration_ms: d.avg, p95_duration_ms: d.p95,
    last_result: allDone.length ? allDone[allDone.length - 1].result : null, flaky: fl.flaky, flip_rate: fl.flip_rate };
}

function sortRows(rows, sort, order) {
  const key = SORT_KEYS.includes(sort) ? sort : "failures";
  const dir = order === "asc" ? 1 : -1;
  const present = rows.filter((r) => r[key] !== null && r[key] !== undefined);
  const missing = rows.filter((r) => r[key] === null || r[key] === undefined); // missing values always last
  const val = (r) => (typeof r[key] === "string" ? r[key].toLowerCase() : r[key]);
  present.sort((a, b) => (val(a) < val(b) ? -dir : val(a) > val(b) ? dir : 0));
  return [...present, ...missing];
}

function leaderboards(rows, limit = 5) {
  const active = rows.filter((r) => r.builds > 0);
  const top = (key) => [...active].sort((a, b) => (b[key] || 0) - (a[key] || 0)).slice(0, limit).filter((r) => (r[key] || 0) > 0);
  return { failures: top("failures"), avg_duration: top("avg_duration_ms"), volume: top("builds") };
}

/** Combine everything into the JSON the dashboard displays. */
function buildDashboard(raw, nowMs, opts = {}) {
  const { days = 7, folder = "", status = "", q = "", sort = "failures", order = "desc", page = 1,
    pageSize = 10, queueThresholdS = 300, flakyWindow = 10, flakyMinSamples = 5, flakyThreshold = 0.4 } = opts;
  const flakyCfg = { window: flakyWindow, minSamples: flakyMinSamples, threshold: flakyThreshold };
  const jobs = raw.jobs || [];
  const folders = [...new Set(jobs.map((j) => folderOf(j.full_name)).filter(Boolean))].sort();
  const qLower = (q || "").trim().toLowerCase();

  const wanted = (j) => {
    const f = folderOf(j.full_name);
    if (folder && !(f === folder || f.startsWith(folder + "/"))) return false;
    return !qLower || j.full_name.toLowerCase().includes(qLower);
  };

  const selected = jobs.filter(wanted);
  let rows = selected.map((j) => jobRow(j, days, nowMs, flakyCfg));
  if (status) rows = rows.filter((r) => (r.last_result || "").toUpperCase() === status.toUpperCase());
  const names = new Set(rows.map((r) => r.full_name));
  const filtered = Boolean(folder || qLower || status);

  const allBuilds = selected.filter((j) => names.has(j.full_name)).flatMap((j) => buildsInRange(j.builds, days, nowMs));
  const overall = outcomeCounts(allBuilds), dur = durationStats(allBuilds);
  const queue = queueSummary((raw.queue || []).filter((i) => !filtered || names.has(i.job)), nowMs, queueThresholdS);

  const ordered = sortRows(rows, sort, order);
  const size = Math.max(1, Math.floor(pageSize));
  const pages = Math.max(1, Math.ceil(ordered.length / size));
  const pageNo = Math.min(Math.max(1, Math.floor(page)), pages);
  const start = (pageNo - 1) * size;
  return {
    kpis: { success_rate: overall.success_rate, completed_builds: overall.completed, failures: overall.failure,
      avg_duration_ms: dur.avg, p95_duration_ms: dur.p95, queue_length: queue.length, jobs: rows.length,
      flaky_candidates: rows.filter((r) => r.flaky).length, outcomes: overall },
    trend: dailyTrend(allBuilds), queue, flaky: rows.filter((r) => r.flaky), leaderboards: leaderboards(rows),
    jobs: ordered.slice(start, start + size),
    paging: { page: pageNo, pages, page_size: size, total: ordered.length },
    filters: { days, folder, status, q, sort, order }, folders,
  };
}

/** Stop spreadsheet apps from running job names like '=cmd' as formulas. */
function csvSafe(value) {
  const s = value === null || value === undefined ? "" : String(value);
  return "=+-@".includes(s[0] || "x") ? "'" + s : s;
}
const csvField = (v) => { const s = String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

function rowsToCsv(rows) {
  const sec = (ms) => (ms === null || ms === undefined ? "" : round(ms / 1000, 2));
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of rows) {
    lines.push([csvSafe(r.full_name), csvSafe(r.folder), r.builds, r.success, r.unstable, r.failures, r.aborted,
      r.success_rate === null ? "" : r.success_rate, sec(r.avg_duration_ms), sec(r.p95_duration_ms),
      r.last_result || "", r.flaky ? "yes" : "no"].map(csvField).join(","));
  }
  return lines.join("\n") + "\n";
}

module.exports = { COMPLETED, CSV_COLUMNS, percentile, folderOf, buildsInRange, outcomeCounts, durationStats,
  detectFlaky, dailyTrend, queueSummary, jobRow, leaderboards, buildDashboard, rowsToCsv };
