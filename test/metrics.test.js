"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const m = require("../src/metrics");
const { generate } = require("../src/sampleData");

const NOW = 1_800_000_000_000;
const H = 3_600_000;
const b = (number, result, dur = 1000, hoursAgo = 0) => ({ number, result, duration_ms: dur, timestamp_ms: NOW - hoursAgo * H });
const job = (name, builds) => ({ full_name: name, name: name.split("/").pop(), url: "", builds });
const range = (n) => Array.from({ length: n }, (_, i) => i);

describe("success rate", () => {
  test("denominator excludes aborted and other results", () => {
    const c = m.outcomeCounts([b(1, "SUCCESS"), b(2, "FAILURE"), b(3, "UNSTABLE"), b(4, "ABORTED"), b(5, "NOT_BUILT")]);
    assert.equal(c.completed, 3);
    assert.equal(c.success_rate, 33.3);
    assert.equal(c.aborted, 1);
    assert.equal(c.other, 1);
  });
  test("empty list has no rate", () => assert.equal(m.outcomeCounts([]).success_rate, null));
});

describe("durations", () => {
  test("ignores zero and missing durations", () => {
    const s = m.durationStats([b(1, "SUCCESS", 1000), b(2, "SUCCESS", 3000), b(3, "SUCCESS", 0),
      { number: 4, result: "FAILURE", duration_ms: null, timestamp_ms: NOW }]);
    assert.deepEqual([s.count, s.avg, s.min, s.max], [2, 2000, 1000, 3000]);
  });
  test("percentile", () => {
    assert.equal(m.percentile([1, 2, 3, 4, 5], 50), 3);
    assert.ok(Math.abs(m.percentile(range(100).map((i) => i + 1), 95) - 95.05) < 1e-9);
    assert.equal(m.percentile([], 95), null);
  });
  test("empty stats", () => assert.equal(m.durationStats([]).avg, null));
});

describe("flaky detection", () => {
  test("alternating builds are flagged", () => {
    const bs = range(8).map((i) => b(i + 1, (i + 1) % 2 ? "SUCCESS" : "FAILURE", 1000, 10 - i));
    assert.equal(m.detectFlaky(bs).flaky, true);
  });
  test("always fail and always pass are not flagged", () => {
    assert.equal(m.detectFlaky(range(8).map((i) => b(i, "FAILURE", 1000, i))).flaky, false);
    assert.equal(m.detectFlaky(range(8).map((i) => b(i, "SUCCESS", 1000, i))).flaky, false);
  });
  test("a single fix is not flagged", () => {
    const bs = range(10).map((i) => b(i, i < 5 ? "FAILURE" : "SUCCESS", 1000, 10 - i));
    assert.equal(m.detectFlaky(bs).flaky, false);
  });
  test("too few builds", () => {
    const r = m.detectFlaky([b(1, "SUCCESS", 1000, 3), b(2, "FAILURE", 1000, 2), b(3, "SUCCESS", 1000, 1)]);
    assert.equal(r.flaky, false);
    assert.equal(r.reason, "not enough builds");
  });
});

describe("queue", () => {
  test("length, waits and threshold", () => {
    const q = m.queueSummary([{ id: 1, job: "a", in_queue_since_ms: NOW - 10_000 },
      { id: 2, job: "b", in_queue_since_ms: NOW - 400_000, why: "no executor" }], NOW, 300);
    assert.deepEqual([q.length, q.long_count, q.max_wait_s], [2, 1, 400]);
    assert.equal(q.items[0].job, "b");
  });
  test("empty queue", () => assert.equal(m.queueSummary([], NOW).length, 0));
});

describe("trend", () => {
  test("groups completed builds by day", () => {
    const t = m.dailyTrend([b(1, "SUCCESS", 1000, 1), b(2, "FAILURE", 1000, 2), b(3, "SUCCESS", 1000, 30), b(4, "ABORTED", 1000, 1)]);
    assert.equal(t.reduce((s, x) => s + x.builds, 0), 3);
    assert.equal(t.length, 2);
  });
});

describe("dashboard", () => {
  const raw = {
    jobs: [
      job("a/one", range(12).map((i) => b(i + 1, (i + 1) % 3 === 0 ? "FAILURE" : "SUCCESS", 1000 * (i + 1), i + 1))),
      job("a/two", range(4).map((i) => b(i + 1, "SUCCESS", 500, i + 1))),
      job("solo", [b(1, "FAILURE", 2000, 2)]),
      job("empty", []),
    ],
    queue: [{ id: 1, job: "solo", in_queue_since_ms: NOW - 1000 }],
  };
  const run = (opts) => m.buildDashboard(raw, NOW, opts);

  test("folder filter", () => {
    const d = run({ folder: "a" });
    assert.deepEqual(d.jobs.map((r) => r.full_name).sort(), ["a/one", "a/two"]);
    assert.equal(d.kpis.queue_length, 0); // queued job "solo" is filtered out
    assert.deepEqual(d.folders, ["a"]);
  });
  test("status and search filters", () => {
    assert.deepEqual(run({ status: "FAILURE" }).jobs.map((r) => r.full_name), ["solo"]);
    assert.deepEqual(run({ q: "TWO" }).jobs.map((r) => r.full_name), ["a/two"]);
  });
  test("time range", () => {
    assert.equal(run({ days: 1 }).kpis.completed_builds, 17);
    assert.equal(m.buildDashboard(raw, NOW + 10 * 86_400_000, { days: 1 }).kpis.completed_builds, 0);
  });
  test("pagination and sort", () => {
    const d = run({ pageSize: 2, page: 2, sort: "name", order: "asc" });
    assert.deepEqual(d.paging, { page: 2, pages: 2, page_size: 2, total: 4 });
    assert.deepEqual(d.jobs.map((r) => r.name), ["solo", "two"]);
    assert.equal(run({ page: 99 }).paging.page, 1); // clamped to the last page
  });
  test("missing values sort last and a bad sort key falls back", () => {
    assert.equal(run({ sort: "avg_duration_ms", order: "desc" }).jobs.at(-1).full_name, "empty");
    assert.equal(run({ sort: "nonsense" }).jobs[0].full_name, "a/one");
  });
  test("empty dataset", () => {
    const d = m.buildDashboard({ jobs: [], queue: [] }, NOW);
    assert.deepEqual([d.kpis.jobs, d.paging.total, d.trend], [0, 0, []]);
  });
  test("sample data end to end", () => {
    const d = m.buildDashboard(generate(NOW), NOW, { days: 14 });
    const by = Object.fromEntries(d.jobs.map((r) => [r.full_name, r]));
    assert.equal(by["always-pass"].success_rate, 100);
    assert.equal(by["always-fail"].success_rate, 0);
    assert.equal(by["flaky"].flaky, true);
    assert.equal(by["always-pass"].flaky, false);
    assert.equal(d.queue.length, 3);
    assert.equal(d.queue.long_count, 1);
  });
});

describe("csv", () => {
  test("header, rows and escaping", () => {
    const row = { full_name: '=HYPERLINK("x")', folder: "a,b", builds: 3, success: 2, unstable: 0, failures: 1, aborted: 0,
      success_rate: 66.7, avg_duration_ms: 1500, p95_duration_ms: 2000, last_result: "FAILURE", flaky: true };
    const lines = m.rowsToCsv([row]).split("\n");
    assert.equal(lines[0], m.CSV_COLUMNS.join(","));
    assert.equal(lines[1], `"'=HYPERLINK(""x"")","a,b",3,2,0,1,0,66.7,1.5,2,FAILURE,yes`);
  });
  test("empty export has only the header", () => assert.equal(m.rowsToCsv([]).trim().split("\n").length, 1));
});
