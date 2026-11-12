# Sample Jenkins jobs

Pipeline scripts that generate realistic build history on a fresh Jenkins instance.

| File | Behaviour |
|---|---|
| `Jenkinsfile.always-pass` | Always succeeds |
| `Jenkinsfile.always-fail` | Always fails in the Test stage |
| `Jenkinsfile.flaky` | Fails about 1 in 3 runs |
| `Jenkinsfile.slow` | Succeeds with durations of 5 to 29 seconds |

## How to use
1. In Jenkins: **New Item**, enter a name (for example `always-pass`), choose **Pipeline**, click OK.
2. Under **Pipeline**, set Definition to *Pipeline script* and paste the file contents. Save.
3. Click **Build Now** once. The cron trigger registers on the first run and builds then run every minute.
4. Let them run for 20 to 30 minutes to collect history.
5. When enough history exists, disable the triggers to stop adding builds.
