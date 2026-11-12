"use strict";
// Read-only client for the Jenkins Remote Access API (uses Node's built-in fetch, no packages).
const { generate } = require("./sampleData");

const jobTree = (maxBuilds) =>
  `fullName,name,url,jobs[fullName,name,url],builds[number,result,duration,timestamp,building]{0,${maxBuilds}}`;
const QUEUE_TREE = "items[id,inQueueSince,why,task[name,fullName,url]]";

/** Any problem talking to Jenkins; the message is safe to show to the user. */
class JenkinsError extends Error {}

class JenkinsClient {
  constructor(baseUrl, { user, token, timeoutMs = 10_000, maxBuilds = 200, maxDepth = 6 } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "") + "/";
    Object.assign(this, { user, token, timeoutMs, maxBuilds, maxDepth });
  }

  async _get(url, tree) {
    const full = url.replace(/\/+$/, "") + "/api/json?tree=" + encodeURIComponent(tree).replace(/%5B/g, "[").replace(/%5D/g, "]").replace(/%2C/g, ",").replace(/%7B/g, "{").replace(/%7D/g, "}");
    const headers = {};
    if (this.user && this.token) headers.Authorization = "Basic " + Buffer.from(`${this.user}:${this.token}`).toString("base64");
    let res;
    try {
      res = await fetch(full, { headers, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (e) {
      throw new JenkinsError(`Could not reach Jenkins at ${this.baseUrl}: ${e.cause?.code || e.message}`);
    }
    if (!res.ok) {
      const hint = res.status === 401 || res.status === 403 ? " (check JENKINS_USER / JENKINS_TOKEN)" : "";
      throw new JenkinsError(`Jenkins returned HTTP ${res.status} for ${url}${hint}`);
    }
    try {
      return await res.json();
    } catch {
      throw new JenkinsError("Jenkins returned a response that is not valid JSON");
    }
  }

  static normalizeBuilds(rawBuilds) {
    return (rawBuilds || [])
      .filter((b) => !b.building && b.result) // skip builds that are still running
      .map((b) => ({ number: b.number, result: b.result, duration_ms: b.duration || 0, timestamp_ms: b.timestamp || 0 }));
  }

  async _walk(url, out, depth = 0) {
    const data = await this._get(url, jobTree(this.maxBuilds));
    const children = data.jobs || [];
    if (children.length && depth < this.maxDepth) { // folder: recurse into its jobs
      for (const child of children) await this._walk(child.url, out, depth + 1);
    } else if (data.fullName) {
      out.push({ full_name: data.fullName, name: data.name || data.fullName, url: data.url || "",
        builds: JenkinsClient.normalizeBuilds(data.builds) });
    }
  }

  async fetchJobs() {
    const out = [];
    await this._walk(this.baseUrl, out);
    return out;
  }

  async fetchQueue() {
    const data = await this._get(this.baseUrl + "queue", QUEUE_TREE);
    return (data.items || []).map((it) => ({ id: it.id, job: it.task?.fullName || it.task?.name || "unknown",
      in_queue_since_ms: it.inQueueSince || 0, why: it.why }));
  }

  async fetchAll() {
    return { jobs: await this.fetchJobs(), queue: await this.fetchQueue() };
  }
}

/** Same interface as JenkinsClient, backed by generated sample data. */
class MockClient {
  async fetchAll() { return generate(); }
}

module.exports = { JenkinsClient, JenkinsError, MockClient };
