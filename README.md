# Online Platform Automation

Kubernetes-first automation framework built with TypeScript and Express. It’s designed to run many isolated automation instances (one per “user” configuration) from the same container image, with predictable deploy/upgrade behavior via Helm.

## The Problem This Solves

Running browser/API automation at scale usually turns into:

- Copy/pasted scripts and `.env` files per operator/user
- Credentials leaking into repos or terminals
- Manual “run it again” recovery when Puppeteer/external services flake
- Ad-hoc deployment drift (different versions/configs per instance)

This repo standardizes all of that:

- `user-configs/*.yaml` defines per-instance configuration (including credentials via Kubernetes Secret)
- Helm installs one release per user (e.g. `platform-user1`) so each instance is isolated, repeatable, and upgradeable
- The app exposes probe endpoints and internal stage/retry status so Kubernetes and operators can see if it’s healthy

## What It Does

- Deploys one automation instance per config in `user-configs/`
- Uses Helm + ConfigMap/Secret to inject environment variables consistently
- Runs a monitoring loop (30s) that drives initialization → workflow → health checks
- Prevents overlapping execution with mutexes; retries each stage (3 for init/health, 5 for workflow)
- Exposes `GET /health`, `GET /ready`, `GET /status` for Kubernetes probes and observability
- Ships a lightweight runtime image based on `zenika/alpine-chrome:with-puppeteer` (Chromium included)

## Runtime Flow (Inside Each Pod)

1. Load env/config and validate required variables
2. Start Express server (default `PORT=3000`) and create the automation runner
3. Monitoring loop triggers stages based on `currentStage`
   - Init → Workflow → Health check → Completed, or recovery when retries remain
4. Status endpoints expose stage progress, retry counters, and timestamps

Key implementation is in [source/src/index.ts](source/src/index.ts); logging is handled by [source/src/utils/logger.ts](source/src/utils/logger.ts).

## Kubernetes Deployment (Helm + user-configs)

- Prerequisites: Docker, kubectl, Helm, and a reachable cluster (kind works well)
- Preferred flow via scripts:

  ```bash
  ./scripts/build.sh docker
  ./scripts/deploy.sh all
  ./scripts/deploy.sh list
  ./scripts/deploy.sh logs user1
  ```

### How Helm + user-configs Work

- Each `user-configs/<user>.yaml` becomes a Helm release named `platform-<user>`.
- Helm renders:
  - a ConfigMap for non-secret env (`USERNAME`, `HOME_URL`, `TARGET_URL`, `LOG_LEVEL`, `HEADLESS`, ...)
  - a Secret for `PASSWORD`
  - a StatefulSet running the container image for that user
  - a ClusterIP Service on port `3000`

This gives you safe per-user credential handling, easy upgrades (`helm upgrade`), and reproducible deployments.

### Script Defaults (and Overrides)

The scripts read defaults from `scripts/common.sh`:

- `DOCKER_IMAGE_NAME=online-platform-automation`
- `DOCKER_IMAGE_TAG=dev`
- `NAMESPACE=platform-automation`

Override by exporting env vars before running the scripts.

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

Helm values map to these via [helm/platform-automation/values.yaml](helm/platform-automation/values.yaml). Per-user overrides live in [user-configs/](user-configs/).

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

## File Guide

- App: [source/src/index.ts](source/src/index.ts) (lifecycle, monitoring, APIs)
- Logging: [source/src/utils/logger.ts](source/src/utils/logger.ts)
- Container: [source/Dockerfile](source/Dockerfile)
- Deployment scripts: [scripts/build.sh](scripts/build.sh), [scripts/deploy.sh](scripts/deploy.sh) (or [Makefile](Makefile))
- Helm chart: [helm/platform-automation/](helm/platform-automation/)
- Per-user values: [user-configs/](user-configs/)

## Implement Your Automation

Fill in the TODO blocks in the stage handlers inside [source/src/index.ts](source/src/index.ts):

- `initialize()` — prepare clients/resources
- `executeWorkflow()` — perform the automation work (protected by a mutex)
- `performHealthCheck()` — validate external dependencies and data health

The monitoring loop will keep invoking stages and retries; the exposed endpoints surface status to your cluster or dashboards.
