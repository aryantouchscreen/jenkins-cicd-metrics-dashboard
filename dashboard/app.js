"use strict";
const state = { days: 7, folder: "", status: "", q: "", sort: "failures", order: "desc", page: 1, page_size: 10 };
const charts = {};
let timer = null, timerSeconds = 0;
const $ = (id) => document.getElementById(id);

// Build DOM with textContent only, so job names from Jenkins can never inject HTML.
function el(tag, text, cls) {
  const e = document.createElement(tag);
  if (text !== undefined && text !== null) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}
const fmtDur = (ms) => {
  if (ms === null || ms === undefined) return "–";
  const s = ms / 1000;
  if (s < 60) return s.toFixed(1) + "s";
  return Math.floor(s / 60) + "m " + String(Math.round(s % 60)).padStart(2, "0") + "s";
};
const fmtPct = (v) => (v === null || v === undefined ? "–" : v.toFixed(1) + "%");

function query(extra) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(state)) if (v !== "" && v !== null) p.set(k, v);
  if (extra) for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return p.toString();
}

async function load(forceRefresh) {
  try {
    const res = await fetch("/api/metrics?" + query(forceRefresh ? { refresh: 1 } : null));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
    render(data);
  } catch (err) {
    showBanner("Could not load metrics: " + err.message, false);
  }
}

function showBanner(msg, isWarn) {
  const b = $("banner");
  b.textContent = msg;
  b.className = "banner" + (isWarn ? " warn" : "");
  b.hidden = !msg;
}

function render(d) {
  const meta = d.meta;
  $("refreshed").textContent = "Last refreshed: " + new Date(meta.last_refreshed_ms).toLocaleTimeString();
  $("stale").hidden = !meta.stale;
  showBanner(meta.stale ? "Showing older data. Latest refresh failed: " + meta.error : "", true);
  if (meta.refresh_seconds !== timerSeconds) {
    timerSeconds = meta.refresh_seconds;
    clearInterval(timer);
    timer = setInterval(() => load(false), Math.max(10, timerSeconds) * 1000);
  }
  renderFolders(d.folders);
  renderKpis(d.kpis);
  renderCharts(d.trend);
  renderQueue(d.queue);
  renderFlaky(d.flaky);
  renderBoard("lbFailures", d.leaderboards.failures, (r) => r.failures + " failures");
  renderBoard("lbDuration", d.leaderboards.avg_duration, (r) => fmtDur(r.avg_duration_ms));
  renderBoard("lbVolume", d.leaderboards.volume, (r) => r.builds + " builds");
  renderJobs(d.jobs, d.paging);
  $("exportBtn").href = "/api/export.csv?" + query({ page: 1 });
}

function renderFolders(folders) {
  const sel = $("folder");
  const wanted = ["", ...folders].join("|");
  if (sel.dataset.options !== wanted) {
    sel.replaceChildren(new Option("All folders", ""), ...folders.map((f) => new Option(f, f)));
    sel.dataset.options = wanted;
  }
  sel.value = state.folder;
}

function renderKpis(k) {
  const items = [
    ["Success rate", fmtPct(k.success_rate)], ["Completed builds", k.completed_builds],
    ["Failures", k.failures], ["Avg duration", fmtDur(k.avg_duration_ms)],
    ["p95 duration", fmtDur(k.p95_duration_ms)], ["Queue length", k.queue_length],
    ["Jobs", k.jobs], ["Flaky candidates", k.flaky_candidates],
  ];
  $("kpis").replaceChildren(...items.map(([l, v]) => {
    const box = el("div", null, "kpi");
    box.append(el("div", v, "v"), el("div", l, "l"));
    return box;
  }));
}

function renderCharts(trend) {
  if (typeof Chart === "undefined") { showBanner("Chart.js could not be loaded (check your internet connection).", true); return; }
  const labels = trend.map((t) => t.date);
  const set = (id, label, data, color, max) => {
    if (!charts[id]) {
      charts[id] = new Chart($(id), {
        type: "line",
        data: { labels, datasets: [{ label, data, borderColor: color, backgroundColor: color, tension: 0.25, spanGaps: true }] },
        options: { responsive: true, maintainAspectRatio: false,
                   scales: { y: { beginAtZero: true, max: max } }, plugins: { legend: { display: false } } },
      });
    } else {
      charts[id].data.labels = labels;
      charts[id].data.datasets[0].data = data;
      charts[id].update();
    }
  };
  set("successChart", "Success rate %", trend.map((t) => t.success_rate), "#1a8a4a", 100);
  set("durationChart", "Avg duration (s)", trend.map((t) => (t.avg_duration_ms === null ? null : +(t.avg_duration_ms / 1000).toFixed(1))), "#2f6fed");
}

function simpleTable(headers, rows) {
  const t = el("table");
  const hr = el("tr");
  headers.forEach((h) => hr.append(el("th", h)));
  t.append(hr);
  rows.forEach((cells) => {
    const tr = el("tr");
    cells.forEach((c) => tr.append(c instanceof Node ? c : el("td", c)));
    t.append(tr);
  });
  return t;
}

function renderQueue(q) {
  $("queueNote").textContent = `(${q.length} waiting, alert over ${Math.round(q.threshold_s / 60)} min)`;
  if (!q.items.length) return $("queue").replaceChildren(el("div", "Queue is empty.", "empty"));
  $("queue").replaceChildren(simpleTable(["Job", "Waiting", "Reason"], q.items.map((i) => {
    const w = el("td", fmtDur(i.waiting_s * 1000), i.long ? "long" : "");
    return [i.job, w, i.why];
  })));
}

function renderFlaky(list) {
  if (!list.length) return $("flaky").replaceChildren(el("div", "No flaky candidates in this view.", "empty"));
  $("flaky").replaceChildren(simpleTable(["Job", "Flip rate", "Success"], list.map((r) =>
    [r.full_name, Math.round(r.flip_rate * 100) + "%", fmtPct(r.success_rate)])));
}

function renderBoard(id, rows, valueFn) {
  if (!rows.length) return $(id).replaceChildren(el("div", "Nothing to show.", "empty"));
  $(id).replaceChildren(simpleTable(["#", "Job", "Value"], rows.map((r, i) => [String(i + 1), r.full_name, valueFn(r)])));
}

const COLUMNS = [
  ["full_name", "Job", "name"], ["builds", "Builds", "builds"], ["failures", "Failures", "failures"],
  ["success_rate", "Success", "success_rate"], ["avg_duration_ms", "Avg duration", "avg_duration_ms"],
  ["p95_duration_ms", "p95", null], ["last_result", "Last result", "last_result"], ["flaky", "Flaky?", null],
];

function renderJobs(jobs, paging) {
  const t = $("jobsTable");
  const head = el("tr");
  COLUMNS.forEach(([, label, sortKey]) => {
    const th = el("th", label + (sortKey && state.sort === sortKey ? (state.order === "asc" ? " ▲" : " ▼") : ""));
    if (sortKey) {
      th.className = "sortable";
      th.onclick = () => {
        state.order = state.sort === sortKey && state.order === "desc" ? "asc" : (sortKey === "name" ? "asc" : "desc");
        state.sort = sortKey; state.page = 1; load(false);
      };
    }
    head.append(th);
  });
  const body = jobs.map((r) => {
    const tr = el("tr");
    tr.append(el("td", r.full_name), el("td", r.builds, "num"), el("td", r.failures, "num"),
              el("td", fmtPct(r.success_rate), "num"), el("td", fmtDur(r.avg_duration_ms), "num"),
              el("td", fmtDur(r.p95_duration_ms), "num"));
    const last = el("td"); if (r.last_result) last.append(el("span", r.last_result, "badge " + r.last_result)); else last.textContent = "–";
    const fl = el("td"); if (r.flaky) fl.append(el("span", "candidate", "badge warn"));
    tr.append(last, fl);
    return tr;
  });
  if (!body.length) { const tr = el("tr"); const td = el("td", "No jobs match these filters.", "empty"); td.colSpan = COLUMNS.length; tr.append(td); body.push(tr); }
  t.replaceChildren(head, ...body);
  $("pageInfo").textContent = `Page ${paging.page} of ${paging.pages} (${paging.total} jobs)`;
  $("prev").disabled = paging.page <= 1;
  $("next").disabled = paging.page >= paging.pages;
}

// events
["days", "folder", "status"].forEach((id) => $(id).addEventListener("change", (e) => { state[id] = e.target.value; state.page = 1; load(false); }));
let debounce;
$("q").addEventListener("input", (e) => { clearTimeout(debounce); debounce = setTimeout(() => { state.q = e.target.value; state.page = 1; load(false); }, 300); });
$("prev").addEventListener("click", () => { state.page -= 1; load(false); });
$("next").addEventListener("click", () => { state.page += 1; load(false); });
$("refreshBtn").addEventListener("click", () => load(true));
load(false);
