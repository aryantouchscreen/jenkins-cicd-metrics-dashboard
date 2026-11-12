# Research summary

Full research document: https://claude.ai/artifact/6B5ott3NKAbH6JHHwW6ViV
Day-1 checklist doc: https://claude.ai/artifact/4BxSvoCGKBx4hEstEP2JwG

Figures below were checked in October 2026 and are approximate.

## Open source basics
Open source means the license lets anyone use, study, modify and share the code. Permissive licenses (MIT, BSD, Apache 2.0) allow almost free reuse; copyleft licenses (GPL) require modified versions to be shared on the same terms. Contribution flow: fork, clone, branch, change, test, commit, push, pull request, review, merge.

## Jenkins
Jenkins is an MIT-licensed automation server written in Java, used mainly for CI/CD. It began as Hudson and was renamed in 2011. Work runs as jobs; Pipeline jobs are defined in a `Jenkinsfile` (Groovy-based). A small core is extended by plugins, which are Java/Maven projects. Most code lives in the `jenkinsci` GitHub organization.

## Repositories relevant to this project
- `jenkinsci/jenkins`: core; exposes the Remote Access API (`/api/json`)
- `jenkinsci/docker`: official image, used for local testing
- `jenkinsci/pipeline-stage-view-plugin`: per-pipeline stage view
- `jenkinsci/prometheus-plugin`, `jenkinsci/metrics-plugin`, `jenkinsci/opentelemetry-plugin`: metrics export
- `jenkinsci/pipeline-dora-metrics-plugin`: closest existing project
- `jenkinsci/echarts-api-plugin`, `jenkinsci/data-tables-api-plugin`: examples of sharing chart libraries between plugins

## Is the problem already solved?
Partly. Pipeline DORA Metrics provides DORA metrics, rankings and a REST API. Prometheus, OpenTelemetry, the Grafana Jenkins data source and Apache DevLake work well but need extra infrastructure. Built-in views are per job or status-only.

## Gaps this project targets
1. A dashboard that works with only Jenkins installed and shows history across many jobs.
2. Clear, written metric definitions and plain-language explanation for small teams.
3. Careful data handling (reruns, deleted builds, discarded history), documented.

## Decision
Pursue the project as a new take on an existing need, keep it read-only and build-level first, study the Pipeline DORA Metrics plugin, and aim for a first contribution to a Jenkins repository.
