# Online Platform Automation

Kubernetes-first automation framework built with TypeScript and Express. Each deployment runs as an isolated instance with configurable credentials, self-healing monitoring, and Kubernetes-ready health probes.

## What It Does

- Automated monitoring loop (30s) drives the lifecycle across initialization, workflow execution, and health checks
- Mutex-guarded execution to prevent overlapping runs; per-stage retry budgets (3 for init/health, 5 for workflow)
- Health and readiness endpoints (`/health`, `/ready`, `/status`) for Kubernetes probes and observability
- Helm chart + per-user values files to spin up multiple isolated instances from the same image
- Lightweight container build on `zenika/alpine-chrome:with-puppeteer`, ready for browser automation

## Runtime Flow

1. Load env/config and validate required variables
2. Start Express server (default `PORT=3000`) and create the automation runner
3. Monitoring loop triggers stages based on `currentStage`
   - Init → Workflow → Health check → Completed, or recovery when retries remain
4. Status endpoints expose stage progress, retry counters, and timestamps

Key implementation is in [source/src/index.ts](source/src/index.ts); logging is handled by [source/src/utils/logger.ts](source/src/utils/logger.ts).

## Configuration

Environment variables (set directly or via Helm values/ConfigMap):

| Name | Purpose |
| ---- | ------- |
| `USERNAME` | Account username for the target platform |
| `PASSWORD` | Account password (mounted from Secret in Helm) |
| `HOME_URL` | Platform home URL |
| `EMAIL_PREFIX` | Prefix used for generated emails |
| `TARGET_URL` | Target platform URL for automation |
| `LOG_LEVEL` | `debug` \| `info` \| `error` (defaults to `info`) |
| `HEADLESS` | `1` to run Puppeteer headless (default) |
| `PORT` | API port (default `3000`) |
| `ENV_FILE` | Optional `.env` file path to load at startup |

Helm values override these via [helm/platform-automation/values.yaml](helm/platform-automation/values.yaml). Per-user configs live in [user-configs/](user-configs/).

## API

- `GET /health` — liveness
- `GET /ready` — readiness (503 when the system is failed)
- `GET /status` — detailed status: stage, retries, last attempts, execution count

## Local Development

```bash
cd source
npm install
ENV_FILE=.env npm run dev
```

Example `.env`:

```env
USERNAME=demo
PASSWORD=secret
HOME_URL=https://example.com
EMAIL_PREFIX=demo+
TARGET_URL=https://example.com/target
LOG_LEVEL=debug
```

Build locally (TypeScript → dist):

```bash
npm run build
```

## Container Image

The production image is built from [source/Dockerfile](source/Dockerfile) using `zenika/alpine-chrome:with-puppeteer`. It installs production deps and runs `dist/index.js` with Chromium available for browser automation.

## Kubernetes Deployment

- Prerequisites: Docker, kubectl, Helm, and a reachable cluster (kind works well)
- Preferred flow via scripts:

  ```bash
  ./scripts/build.sh docker   # build image (includes local TS build) and load to kind when applicable
  ./scripts/deploy.sh all     # deploy all users found in user-configs/*.yaml
  ./scripts/deploy.sh list    # list releases and pods
  ./scripts/deploy.sh logs user1
  ```

- Make targets remain available: `make build`, `make deploy`, `make deploy-user USER=user1`, `make logs USER=user1`.
- Helm chart deploys a StatefulSet per user with defaults from [helm/platform-automation/values.yaml](helm/platform-automation/values.yaml); adjust CPU/memory or add volumes as needed.

## File Guide

- App: [source/src/index.ts](source/src/index.ts) (lifecycle, monitoring, APIs)
- Logging: [source/src/utils/logger.ts](source/src/utils/logger.ts)
- Container: [source/Dockerfile](source/Dockerfile)
- Deployment scripts: [automate.sh](automate.sh), [Makefile](Makefile)
- Helm chart: [helm/platform-automation/](helm/platform-automation/)
- User overrides: [user-configs/](user-configs/)

## Implement Your Automation

Fill in the TODO blocks in the stage handlers inside [source/src/index.ts](source/src/index.ts):

- `initialize()` — prepare clients/resources
- `executeWorkflow()` — perform the automation work (protected by a mutex)
- `performHealthCheck()` — validate external dependencies and data health

The monitoring loop will keep invoking stages and retries; the exposed endpoints surface status to your cluster or dashboards.
