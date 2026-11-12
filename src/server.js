"use strict";
/**
 * Standalone dashboard server: serves the UI and a JSON API with a refresh-interval cache.
 *
 *   Sample data:      node src/server.js --mock
 *   Against Jenkins:  JENKINS_URL=http://localhost:8080 JENKINS_USER=me JENKINS_TOKEN=xxx node src/server.js
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { JenkinsClient, JenkinsError, MockClient } = require("./jenkinsClient");
const { buildDashboard, rowsToCsv } = require("./metrics");

const STATIC_DIR = path.resolve(__dirname, "..", "dashboard");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml" };

/** Keeps the last fetch for `ttlSeconds`. If a refresh fails, serves the old data marked stale. */
class DataCache {
  constructor(fetchFn, ttlSeconds = 60) {
    this.fetchFn = fetchFn; this.ttl = ttlSeconds;
    this.raw = null; this.fetchedAt = 0; this.error = null; this.inFlight = null;
  }

  async get(force = false) {
    const fresh = this.raw !== null && Date.now() - this.fetchedAt < this.ttl * 1000;
    if (!fresh || force) {
      if (!this.inFlight) { // several requests at once share a single Jenkins fetch
        this.inFlight = this.fetchFn()
          .then((raw) => { this.raw = raw; this.fetchedAt = Date.now(); this.error = null; })
          .catch((e) => { if (this.raw === null || !(e instanceof JenkinsError)) throw e; this.error = e.message; })
          .finally(() => { this.inFlight = null; });
      }
      await this.inFlight;
    }
    return { raw: this.raw, meta: { last_refreshed_ms: this.fetchedAt, stale: this.error !== null,
      error: this.error, refresh_seconds: this.ttl } };
  }
}

const intParam = (params, key, def, lo, hi) => {
  const n = parseInt(params.get(key) ?? "", 10);
  return Number.isNaN(n) ? def : Math.max(lo, Math.min(hi, n));
};

function createServer(client, { ttlSeconds = 60, queueThresholdS = 300 } = {}) {
  const cache = new DataCache(() => client.fetchAll(), ttlSeconds);

  async function dashboard(params, exportAll = false) {
    const { raw, meta } = await cache.get(params.get("refresh") === "1");
    const d = buildDashboard(raw, Date.now(), {
      days: intParam(params, "days", 7, 0, 3650), folder: params.get("folder") || "", status: params.get("status") || "",
      q: params.get("q") || "", sort: params.get("sort") || "failures", order: params.get("order") || "desc",
      page: intParam(params, "page", 1, 1, 100000), pageSize: exportAll ? 100000 : intParam(params, "page_size", 10, 1, 100),
      queueThresholdS });
    d.meta = meta;
    return d;
  }

  const send = (res, code, body, type, extra = {}) => {
    const data = Buffer.isBuffer(body) ? body : Buffer.from(body);
    res.writeHead(code, { "Content-Type": type, "Content-Length": data.length, "Cache-Control": "no-store", ...extra });
    res.end(data);
  };
  const sendJson = (res, code, obj) => send(res, code, JSON.stringify(obj), "application/json; charset=utf-8");

  function sendStatic(res, pathname) {
    let rel;
    try { rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, ""); }
    catch { return sendJson(res, 404, { error: "not found" }); }
    const full = path.resolve(STATIC_DIR, rel);
    if (!full.startsWith(STATIC_DIR + path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
      return sendJson(res, 404, { error: "not found" });
    }
    send(res, 200, fs.readFileSync(full), MIME[path.extname(full)] || "application/octet-stream");
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    try {
      if (url.pathname === "/api/health") return sendJson(res, 200, { status: "ok" });
      if (url.pathname === "/api/metrics") return sendJson(res, 200, await dashboard(url.searchParams));
      if (url.pathname === "/api/export.csv") {
        const d = await dashboard(url.searchParams, true);
        return send(res, 200, rowsToCsv(d.jobs), "text/csv; charset=utf-8",
          { "Content-Disposition": 'attachment; filename="jenkins-metrics.csv"' });
      }
      sendStatic(res, url.pathname);
    } catch (e) {
      if (e instanceof JenkinsError) return sendJson(res, 502, { error: e.message });
      console.error(e);
      sendJson(res, 500, { error: "internal error" });
    }
  });
}

function main() {
  const args = process.argv.slice(2);
  const flag = (name, def) => { const i = args.indexOf(name); return i === -1 ? def : args[i + 1]; };
  const mock = args.includes("--mock");
  const host = flag("--host", "127.0.0.1");
  const port = parseInt(flag("--port", process.env.PORT || "8000"), 10);
  const ttlSeconds = parseInt(process.env.REFRESH_SECONDS || "60", 10);
  const queueThresholdS = parseInt(process.env.QUEUE_THRESHOLD_SECONDS || "300", 10);
  let client;
  if (mock) client = new MockClient();
  else if (process.env.JENKINS_URL) {
    client = new JenkinsClient(process.env.JENKINS_URL, { user: process.env.JENKINS_USER, token: process.env.JENKINS_TOKEN });
  } else {
    console.error("Set JENKINS_URL (and JENKINS_USER / JENKINS_TOKEN if needed), or use --mock");
    process.exit(1);
  }
  createServer(client, { ttlSeconds, queueThresholdS }).listen(port, host, () =>
    console.log(`Dashboard on http://${host}:${port} (${mock ? "mock data" : process.env.JENKINS_URL}, refresh ${ttlSeconds}s)`));
}

if (require.main === module) main();
module.exports = { DataCache, createServer };
