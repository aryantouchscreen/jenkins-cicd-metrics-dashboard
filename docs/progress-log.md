# Progress log

## Week 1 (requirements and setup)
- Researched open source, Jenkins and existing tools (see research.md)
- Reviewed the project proposal (PRD) and defined metric calculations (metrics-definitions.md)
- Created the repository

## Week 2 (core development, started)
- Node.js service that reads jobs, builds and the queue from the Jenkins Remote Access API
- Metric calculations: success rate, duration stats (avg/min/max/p50/p95), daily trends, queue waits, flaky candidates
- Dashboard UI with Chart.js: KPIs, trend charts, queue, flaky list, leaderboards, filters, paging, CSV export, last-refresh time
- Sample Jenkins pipelines for generating build history
- Unit and integration tests, GitHub Actions workflow

## Still to do
- Verify against a real local Jenkins with a few days of build history (so far tested with mocked responses and sample data)
- Authentication for the dashboard, performance measurements with large histories
- Mentor review of metric definitions and flaky heuristic
- Contribute an issue/PR to a Jenkins open source repository
