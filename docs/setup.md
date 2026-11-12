# Setup and usage

The dashboard is a small standalone **Node.js** service (built-in modules only, Node 18+, no `npm install` needed)
plus a static HTML/CSS/JavaScript front end that draws the charts with Chart.js. It only **reads** from Jenkins.

## 1. Try it with sample data (no Jenkins needed)
```bash
npm run mock
```
Open http://127.0.0.1:8000. The sample data has 7 jobs (including folders `team-a` and `team-b`),
14 days of history, a flaky job and a small queue.

## 2. Connect to a real Jenkins
macOS / Linux:
```bash
export JENKINS_URL=http://localhost:8080
export JENKINS_USER=your-username
export JENKINS_TOKEN=your-api-token      # Jenkins > your user > Configure > API Token
npm start
```
Windows (PowerShell):
```powershell
$env:JENKINS_URL="http://localhost:8080"; $env:JENKINS_USER="your-username"; $env:JENKINS_TOKEN="your-api-token"
npm start
```
Never commit the token. It is sent only to `JENKINS_URL` using HTTP Basic auth.

| Setting (env var) | Default | Meaning |
|---|---|---|
| `REFRESH_SECONDS` | 60 | How long fetched Jenkins data is reused before the next fetch |
| `QUEUE_THRESHOLD_SECONDS` | 300 | Queue items waiting longer than this are highlighted |
| `PORT` | 8000 | Port to listen on (`--host` / `--port` flags also work) |

## 3. Generate build history in a local Jenkins
```bash
docker run -d --name jenkins -p 8080:8080 -p 50000:50000 -v jenkins_home:/var/jenkins_home jenkins/jenkins:lts
```
Then create Pipeline jobs from `jenkins/` (see `jenkins/README.md`) and let them run for 20-30 minutes.

## 4. Run the tests
```bash
npm test
```
Coverage report (Node 20+): `node --test --experimental-test-coverage`

## Project layout
```
src/metrics.js         metric calculations (pure functions)
src/jenkinsClient.js   Jenkins Remote API client + mock client
src/sampleData.js      generated sample data for --mock
src/server.js          HTTP server, cache and JSON/CSV API
dashboard/             index.html, style.css, app.js (Chart.js)
test/                  unit and integration tests
jenkins/               sample Jenkinsfiles
```

## API
| Endpoint | Purpose |
|---|---|
| `GET /api/metrics` | Dashboard data. Query: `days`, `folder`, `status`, `q`, `sort`, `order`, `page`, `page_size`, `refresh=1` |
| `GET /api/export.csv` | Same filters, all matching jobs as CSV |
| `GET /api/health` | Returns `{"status":"ok"}` |

Jenkins endpoints used: `/api/json` (jobs, folders, builds) and `/queue/api/json` (queue), both with `tree=` filters
and at most 200 builds per job.

## Refresh and errors
- Data is cached for `REFRESH_SECONDS`; the page auto-refreshes at the same interval and shows the last refresh time.
- If a refresh fails (Jenkins down, bad token), the last good data is still shown with a **stale data** warning and the error.
- If the very first fetch fails, the dashboard shows the error message instead of crashing.

## Known limitations
- Queue time is the *current* queue only; Jenkins does not record per-build queue time without extra plugins.
- Job labels are not exposed by the Remote API for jobs, so filtering is by folder, last status, name and time range.
- Only the latest 200 builds per job are read. Rerun/replay and log-rotation effects are not corrected for.
- The flaky heuristic is a candidate indicator, not proof of a flaky test.
- The dashboard itself has no login; run it on localhost or behind your own access control.
