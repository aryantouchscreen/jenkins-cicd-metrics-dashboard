"use strict";
// Deterministic fake Jenkins data so the dashboard runs without a Jenkins server (--mock).

// name: [failure prob, unstable prob, aborted prob, min duration ms, max duration ms]
const SPECS = {
  "always-pass": [0.0, 0.0, 0.0, 8_000, 12_000],
  "always-fail": [1.0, 0.0, 0.0, 4_000, 6_000],
  "flaky": [0.0, 0.0, 0.0, 4_000, 8_000],
  "slow": [0.0, 0.0, 0.0, 5_000, 30_000],
  "team-a/api-build": [0.10, 0.0, 0.02, 20_000, 45_000],
  "team-a/web-build": [0.18, 0.08, 0.02, 30_000, 70_000],
  "team-b/deploy": [0.05, 0.0, 0.04, 60_000, 140_000],
};

function mulberry32(seed) { // small seeded random generator
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generate(nowMs = Date.now(), days = 14, seed = 7) {
  const rnd = mulberry32(seed);
  const randint = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const jobs = [];
  for (const [fullName, [fail, unstable, aborted, dMin, dMax]] of Object.entries(SPECS)) {
    const builds = [];
    let t = nowMs - days * 86_400_000, number = 1;
    while (t < nowMs - 60_000) {
      const r = rnd();
      let result;
      if (fullName === "flaky") { // mostly alternates pass/fail, with a little noise
        const passed = (number % 2 === 0) !== (rnd() < 0.1);
        result = passed ? "SUCCESS" : "FAILURE";
      } else {
        result = r < fail ? "FAILURE" : r < fail + unstable ? "UNSTABLE" : r < fail + unstable + aborted ? "ABORTED" : "SUCCESS";
      }
      builds.push({ number, result, duration_ms: randint(dMin, dMax), timestamp_ms: Math.floor(t) });
      number += 1;
      t += randint(60, 150) * 60_000; // a build every 1-2.5 hours
    }
    builds.reverse(); // Jenkins returns newest first
    jobs.push({ full_name: fullName, name: fullName.split("/").pop(),
      url: `http://localhost:8080/job/${fullName.replace(/\//g, "/job/")}/`, builds });
  }
  const queue = [
    { id: 101, job: "team-a/web-build", in_queue_since_ms: nowMs - 30_000, why: "Waiting for next available executor" },
    { id: 102, job: "team-b/deploy", in_queue_since_ms: nowMs - 200_000, why: "Waiting for next available executor" },
    { id: 103, job: "slow", in_queue_since_ms: nowMs - 900_000, why: "All nodes of label 'linux' are offline" },
  ];
  return { jobs, queue };
}

module.exports = { generate };
