#!/usr/bin/env bash
# Run inside your cloned repo after copying these files in. Makes one commit per component, then pushes.
set -e
commit() { # commit "message" paths...
  msg="$1"; shift
  git add "$@"
  git diff --cached --quiet || git commit -m "$msg"
}
commit "chore: add package.json and .gitignore" package.json .gitignore
commit "feat: add metric calculations (success rate, durations, trends, queue, flaky detection, CSV)" src/metrics.js
commit "test: add unit tests for metric calculations" test/metrics.test.js
commit "feat: add sample data generator for running without Jenkins" src/sampleData.js
commit "feat: add Jenkins Remote Access API client with folder walking and error handling" src/jenkinsClient.js
commit "feat: add HTTP server with refresh-interval cache and JSON/CSV API" src/server.js
commit "test: add client, cache and server integration tests" test/clientAndServer.test.js
commit "feat: add dashboard UI with Chart.js, filters, paging and CSV export" dashboard
commit "chore: add sample Jenkins pipelines for generating build history" jenkins
commit "ci: run tests with GitHub Actions" .github
commit "docs: add setup guide, metric definitions and progress log" docs commit_project.sh
git push
