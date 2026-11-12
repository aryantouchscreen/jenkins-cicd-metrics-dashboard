"use strict";
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { JenkinsClient, JenkinsError, MockClient } = require("../src/jenkinsClient");
const { DataCache, createServer } = require("../src/server");

/** Serves canned Jenkins API responses instead of using the network. */
class FakeJenkins extends JenkinsClient {
  constructor() {
    super("http://jenkins.test");
    this.pages = {
      "http://jenkins.test/": { jobs: [{ fullName: "team", name: "team", url: "http://jenkins.test/job/team/" },
        { fullName: "solo", name: "solo", url: "http://jenkins.test/job/solo/" }] },
      "http://jenkins.test/job/team/": { fullName: "team", name: "team",
        jobs: [{ fullName: "team/api", name: "api", url: "http://jenkins.test/job/team/job/api/" }] },
      "http://jenkins.test/job/team/job/api/": { fullName: "team/api", name: "api", url: "u", builds: [
        { number: 2, result: null, duration: 0, timestamp: 2, building: true },
        { number: 1, result: "SUCCESS", duration: 900, timestamp: 1, building: false }] },
      "http://jenkins.test/job/solo/": { fullName: "solo", name: "solo", url: "u", builds: [] },
      "http://jenkins.test/queue": { items: [{ id: 5, inQueueSince: 123, why: "busy", task: { name: "api", fullName: "team/api" } }] },
    };
  }
  async _get(url) { return this.pages[url.endsWith("queue") ? url : url.replace(/\/+$/, "") + "/"]; }
}

describe("Jenkins client", () => {
  test("walks folders and skips running builds", async () => {
    const data = await new FakeJenkins().fetchAll();
    assert.deepEqual(data.jobs.map((j) => j.full_name).sort(), ["solo", "team/api"]);
    assert.deepEqual(data.jobs.find((j) => j.full_name === "team/api").builds.map((x) => x.number), [1]);
    assert.deepEqual(data.queue, [{ id: 5, job: "team/api", in_queue_since_ms: 123, why: "busy" }]);
  });
  test("unreachable Jenkins raises a friendly error", async () => {
    await assert.rejects(new JenkinsClient("http://127.0.0.1:9", { timeoutMs: 1000 }).fetchAll(), JenkinsError);
  });
});

describe("cache", () => {
  test("reuses data within the TTL and falls back to stale data on failure", async () => {
    let calls = 0, fail = false;
    const cache = new DataCache(async () => { calls += 1; if (fail) throw new JenkinsError("down"); return { jobs: [], queue: [] }; }, 60);
    await cache.get(); await cache.get();
    assert.equal(calls, 1); // second call came from the cache
    fail = true;
    const { meta } = await cache.get(true); // refresh fails -> old data, flagged stale
    assert.equal(meta.stale, true);
    assert.equal(meta.error, "down");
  });
  test("a failed first fetch is an error", async () => {
    await assert.rejects(new DataCache(async () => { throw new JenkinsError("down"); }).get(), JenkinsError);
  });
});

describe("http server", () => {
  let srv, base;
  before(async () => {
    srv = createServer(new MockClient());
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${srv.address().port}`;
  });
  after(() => srv.close());

  test("metrics endpoint", async () => {
    const res = await fetch(base + "/api/metrics?days=14&folder=team-a&page_size=1");
    const d = await res.json();
    assert.equal(res.status, 200);
    assert.equal(d.paging.total, 2);
    assert.equal(d.jobs.length, 1);
    assert.ok(d.meta.last_refreshed_ms > 0);
  });
  test("csv export respects filters", async () => {
    const res = await fetch(base + "/api/export.csv?days=14&folder=team-b");
    assert.match(res.headers.get("content-type"), /text\/csv/);
    assert.equal((await res.text()).trim().split("\n").length, 2); // header + team-b/deploy
  });
  test("serves the page; unknown and traversal paths are 404", async () => {
    assert.equal((await fetch(base + "/")).status, 200);
    for (const bad of ["/nope.html", "/..%2Fsrc%2Fserver.js", "/%2e%2e/src/server.js"]) {
      assert.equal((await fetch(base + bad)).status, 404, bad);
    }
  });
});
