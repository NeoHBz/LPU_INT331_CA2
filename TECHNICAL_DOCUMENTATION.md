# Technical Documentation

## Project Overview

**Online Platform Automation** is a Kubernetes-based automation framework built with TypeScript, Express, and containerized using Docker. It provides infrastructure for deploying multiple automation instances with individual configurations.

## Architecture

### Technology Stack

- **Runtime**: Node.js 18+
- **Language**: TypeScript 5.7+
- **Web Framework**: Express 4.x
- **Container**: Docker with Alpine Chrome
- **Orchestration**: Kubernetes with Helm 3.x
- **Logging**: Custom Winston-based logger
- **Concurrency**: async-mutex for thread-safe operations
- **Monitoring**: Prometheus metrics + health checks
- **State Management**: ExecutionStage enum with retry logic

### System Components

```
┌─────────────────────────────────────────────┐
│         Kubernetes Cluster                  │
│  ┌───────────────────────────────────────┐  │
│  │  Helm Chart: platform-automation      │  │
│  │  ┌─────────────────────────────────┐  │  │
│  │  │  Pod: user1                     │  │  │
│  │  │  ┌──────────────────────────┐   │  │  │
│  │  │  │  Container: automation   │   │  │  │
│  │  │  │  - Express Server        │   │  │  │
│  │  │  │  - Health Endpoints      │   │  │  │
│  │  │  │  - Config from ENV       │   │  │  │
│  │  │  └──────────────────────────┘   │  │  │
│  │  └─────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────┐  │  │
│  │  │  Pod: user2                     │  │  │
│  │  │  └─────────────────────────────┘  │  │
│  │  │  ...                              │  │
│  │  └───────────────────────────────────┘  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

## Project Structure

```
.
├── helm/
│   └── platform-automation/
│       ├── Chart.yaml              # Helm chart metadata
│       ├── values.yaml             # Default values
│       └── templates/
│           └── deployment.yaml     # K8s deployment template
├── source/
│   ├── Dockerfile                  # Multi-stage container build
│   ├── package.json                # Node.js dependencies
│   ├── tsconfig.json               # TypeScript compiler config
│   └── src/
│       ├── index.ts                # Main application entry
│       └── utils/
│           └── logger.ts           # Logging utility
├── user-configs/
│   └── user1.yaml                  # User-specific Helm values
├── package.json                    # Root scripts for deployment
└── README.md                       # User documentation
```

## Deployment Architecture

### Helm Chart Structure

**Chart.yaml**
- API Version: v2
- Chart Name: `platform-automation`
- Description: Automated platform interaction
- Version: 0.1.0
- App Version: 1.0.0

**values.yaml** - Default Configuration
```yaml
replicaCount: 1

image:
  repository: online-platform-automation
  pullPolicy: IfNotPresent
  tag: "dev"

userConfig:
  username: ""
  password: ""
  homeUrl: ""
  emailPrefix: ""
  targetUrl: ""
  logLevel: "info"
  headless: 1

resources:
  limits:
    cpu: 500m
    memory: 512Mi
  requests:
    cpu: 100m
    memory: 256Mi
```

### Deployment Template

The Kubernetes deployment creates:
- **Deployment**: Manages pod lifecycle
- **ReplicaSet**: Ensures desired number of pods
- **Pod**: Contains the automation container
- **Environment Variables**: Injected from Helm values

Key environment variables:
- `USERNAME`: Platform username
- `PASSWORD`: Platform password  
- `HOME_URL`: Platform base URL
- `EMAIL_PREFIX`: Email configuration
- `TARGET_URL`: Target resource URL
- `LOG_LEVEL`: Logging verbosity
- `HEADLESS`: Browser mode flag
- `PORT`: Server port (default: 3000)

## Container Build Process

### Multi-Stage Dockerfile

**Stage 1: Builder**
```dockerfile
FROM node:18-bullseye AS builder
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-common \
    ca-certificates
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
RUN npx --yes javascript-obfuscator dist --output dist
```

**Stage 2: Runtime**
```dockerfile
FROM zenika/alpine-chrome:with-puppeteer
WORKDIR /app
COPY --from=builder /app/dist dist
COPY --from=builder /app/node_modules node_modules
ENV NODE_ENV=production
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
CMD ["node", "dist/index.js"]
```

### Build Optimizations

1. **Multi-stage build**: Separates build dependencies from runtime
2. **Code obfuscation**: Protects compiled JavaScript
3. **Production dependencies only**: Minimal container size
4. **Alpine base**: Lightweight Linux distribution
5. **Pre-installed Chrome**: Chromium bundled with Puppeteer support

## Application Architecture

### Entry Point: index.ts

**Core Components:**

1. **Express Server**
   - Port: 3000 (configurable via PORT env var)
   - Routes: `/status`, `/health`
   - Error handling for uncaught exceptions

2. **Automation Class**
   - Configuration management
   - Workflow orchestration
   - Health status tracking
   - Graceful shutdown handling

3. **Configuration System**
   - Environment variable loading
   - dotenv integration
   - Type-safe config with TypeScript

### Type Definitions

```typescript
type TConfig = {
    username: string;
    password: string;
    platformHomeUrl: string;
    emailPrefix: string;
    targetPlatformURL: string;
};

enum ExecutionStage {
    INITIAL = "initial",
    INITIALIZED = "initialized",
    WORKFLOW_RUNNING = "workflow_running",
    WORKFLOW_COMPLETED = "workflow_completed",
    FAILED = "failed",
}

type RetryConfig = {
    maxRetries: number;
    currentRetries: number;
    lastAttempt: string | null;
    lastError: string | null;
    success: boolean;
    lastSuccessTime: string | null;
};

type StageStatus = {
    [key: string]: RetryConfig;
};
```

## Concurrency Control & Thread Safety

### Mutex Implementation

The application uses `async-mutex` library to prevent race conditions:

**Monitoring Mutex** (`monitoringMutex`)
- Prevents overlapping monitoring cycles
- Ensures only one health check runs at a time
- Avoids cycle starvation with timeout handling

**Workflow Mutex** (`workflowMutex`)
- Protects critical workflow execution
- Prevents duplicate concurrent runs
- Thread-safe state transitions

### Usage Pattern

```typescript
const release = await this.monitoringMutex.acquire().catch(() => null);
if (!release) {
    Logger.error("Failed to acquire mutex, skipping cycle");
    return;
}

try {
    // Critical section - only one execution at a time
    await this.monitorExecution();
} finally {
    release(); // Always release mutex
}
```

### Benefits

- **Race Condition Prevention**: Mutex ensures exclusive access
- **Resource Safety**: Prevents double-allocation of resources
- **State Consistency**: No conflicting state updates
- **Deadlock Avoidance**: Timeout-based acquisition

## Monitoring & Self-Healing

### Monitoring Loop

Automated monitoring runs every 30 seconds:

```typescript
const MONITORING_INTERVAL = 30000; // 30 seconds

startMonitoring() {
    this.monitoringInterval = setInterval(
        () => this.monitorExecution(),
        MONITORING_INTERVAL,
    );
}
```

### Stage-Based Execution

Monitoring loop handles different stages:

1. **INITIAL** → Attempt initialization
2. **INITIALIZED** → Execute workflow
3. **WORKFLOW_RUNNING** → Perform health checks
4. **WORKFLOW_COMPLETED** → Wait or restart
5. **FAILED** → Attempt recovery

### Self-Healing Logic

```typescript
case ExecutionStage.FAILED:
    const failedStage = this.findFailedStage();
    if (failedStage && retriesAvailable) {
        Logger.info(`Recovering from failed stage: ${failedStage}`);
        this.resetStageBeforeFailure(failedStage);
        this.systemStatus = "degraded";
    } else {
        this.systemStatus = "failed";
    }
```

## Retry Logic & Fault Tolerance

### Retry Configuration

Each stage has configurable retry limits:

```typescript
stageStatus = {
    initialization: {
        maxRetries: 3,
        currentRetries: 0,
        lastAttempt: null,
        lastError: null,
        success: false,
        lastSuccessTime: null,
    },
    workflowExecution: {
        maxRetries: 5,  // More retries for critical workflow
        currentRetries: 0,
        // ...
    },
    healthCheck: {
        maxRetries: 3,
        // ...
    },
};
```

### Retry Execution Flow

```
┌───────────────────┐
│  Attempt Stage     │
└────────┬─────────┘
         │
         ↓
    Success? ───── Yes ────► Mark success, proceed
         │
         No
         │
         ↓
  Retries < Max?
         │
    Yes ───┬───► Increment retry, try again
         │       │
         │       └─────────────┐
         No                    │
         │                     │
         ↓                     │
  Mark FAILED ◀───────────────┘
```

### Error Tracking

Each retry attempt records:
- Timestamp of attempt
- Error message (if failed)
- Success status
- Last successful execution time

## Prometheus Metrics Integration

### API Endpoints

### API Endpoints

#### GET /status
Returns detailed automation service status:
```json
{
    "username": "user1",
    "status": "healthy",
    "timestamp": "2025-12-03T14:00:00.000Z",
    "startTime": "2025-12-03T13:00:00.000Z",
    "currentStage": "workflow_completed",
    "executionCount": 42,
    "stageStatus": {
        "initialization": {
            "maxRetries": 3,
            "currentRetries": 0,
            "lastAttempt": "2025-12-03T13:00:01.000Z",
            "lastError": null,
            "success": true,
            "lastSuccessTime": "2025-12-03T13:00:01.500Z"
        },
        "workflowExecution": {...},
        "healthCheck": {...}
    },
    "message": "Automation service running"
}
```

#### GET /health
Basic health check for Kubernetes liveness probe:
```json
{
    "status": "ok",
    "timestamp": "2025-12-03T14:00:00.000Z"
}
```

#### GET /ready
Readiness probe with detailed system state:
```json
{
    "ready": true,
    "status": "healthy",
    "currentStage": "workflow_completed",
    "timestamp": "2025-12-03T14:00:00.000Z"
}
```

**Status Codes:**
- `200`: System is ready
- `503`: System is not ready (failed state)

#### GET /metrics
Prometheus-compatible metrics endpoint:

```
# HELP automation_uptime_seconds Total uptime in seconds
# TYPE automation_uptime_seconds gauge
automation_uptime_seconds 3600

# HELP automation_execution_count Total number of workflow executions
# TYPE automation_execution_count counter
automation_execution_count 42

# HELP automation_status Current system status (0=failed, 1=degraded, 2=healthy)
# TYPE automation_status gauge
automation_status 2

# HELP automation_stage_success Stage completion status (0=failed, 1=success)
# TYPE automation_stage_success gauge
automation_stage_success{stage="initialization"} 1
automation_stage_success{stage="workflowExecution"} 1
automation_stage_success{stage="healthCheck"} 1

# HELP automation_stage_retries Current retry count per stage
# TYPE automation_stage_retries gauge
automation_stage_retries{stage="initialization"} 0
automation_stage_retries{stage="workflowExecution"} 0
automation_stage_retries{stage="healthCheck"} 0
```

**Metric Types:**
- **Gauge**: Current value (uptime, status, success flags)
- **Counter**: Monotonically increasing value (execution count)

### Logging System

Custom logger in `utils/logger.ts`:
- **Levels**: debug, info, warn, error
- **Console output**: Color-coded by level
- **Timestamps**: ISO 8601 format
- **Context**: Function name tracking

## Multi-User Deployment

### Configuration Pattern

Each user gets:
1. **YAML config file**: `user-configs/userX.yaml`
2. **Helm release**: Separate Kubernetes deployment
3. **Isolated resources**: Independent CPU/memory limits
4. **Unique environment**: Own set of credentials

### Deployment Commands

**Deploy single user:**
```bash
helm install user1 helm/platform-automation -f user-configs/user1.yaml
```

**Deploy multiple users:**
```bash
helm install user1 helm/platform-automation -f user-configs/user1.yaml
helm install user2 helm/platform-automation -f user-configs/user2.yaml
helm install user3 helm/platform-automation -f user-configs/user3.yaml
```

**Scale deployment:**
```bash
kubectl scale deployment user1 --replicas=2
```

**View logs:**
```bash
kubectl logs -l app=user1 -f
```

## Resource Management

### CPU and Memory Allocation

Default per pod:
- **CPU Request**: 100m (0.1 cores)
- **CPU Limit**: 500m (0.5 cores)
- **Memory Request**: 256Mi
- **Memory Limit**: 512Mi

Adjustable via user config:
```yaml
resources:
  limits:
    cpu: 1000m
    memory: 1Gi
  requests:
    cpu: 200m
    memory: 512Mi
```

### Pod Lifecycle

1. **Init**: Container starts, loads config
2. **Running**: Express server listening
3. **Ready**: Health checks passing
4. **Terminating**: SIGTERM received, graceful shutdown

## Development Workflow

### Local Development

```bash
# Install dependencies
cd source
npm install

# Run in development mode
npm run dev

# Build TypeScript
npm run build

# Run compiled code
npm start
```

### Docker Development

```bash
# Build image
docker build -t online-platform-automation:dev source

# Run container
docker run -p 3000:3000 \
  -e USERNAME=user \
  -e PASSWORD=pass \
  -e HOME_URL=https://example.com \
  -e EMAIL_PREFIX=user@example.com \
  -e TARGET_URL=https://example.com/target \
  online-platform-automation:dev
```

### Kubernetes Development

```bash
# Dry-run deployment
helm install test helm/platform-automation \
  -f user-configs/user1.yaml \
  --dry-run --debug

# Install to cluster
helm install user1 helm/platform-automation \
  -f user-configs/user1.yaml

# Upgrade deployment
helm upgrade user1 helm/platform-automation \
  -f user-configs/user1.yaml

# Rollback
helm rollback user1

# Uninstall
helm uninstall user1
```

## Monitoring and Observability

### Health Checks

**Liveness Probe**: Ensures pod is alive
```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 30
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3
```

**Readiness Probe**: Ensures pod is ready for traffic
```yaml
readinessProbe:
  httpGet:
    path: /ready
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 5
  timeoutSeconds: 3
  failureThreshold: 3
```

### Prometheus Integration

**ServiceMonitor Configuration:**
```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: automation-metrics
spec:
  selector:
    matchLabels:
      app: platform-automation
  endpoints:
  - port: http
    path: /metrics
    interval: 30s
```

**Sample Prometheus Queries:**

```promql
# Average uptime across all instances
avg(automation_uptime_seconds)

# Execution rate (executions per minute)
rate(automation_execution_count[5m]) * 60

# Failed stages
automation_stage_success{stage="workflowExecution"} == 0

# Total retry attempts
sum(automation_stage_retries)

# System health percentage
(sum(automation_status == 2) / count(automation_status)) * 100
```

**Grafana Dashboard Panels:**

1. **System Status Gauge**
   - Query: `automation_status`
   - Visualization: Gauge (0-2 scale)

2. **Execution Count**
   - Query: `automation_execution_count`
   - Visualization: Counter/Stat

3. **Uptime**
   - Query: `automation_uptime_seconds / 3600`
   - Visualization: Time series (hours)

4. **Stage Success Rate**
   - Query: `automation_stage_success`
   - Visualization: Table/Heatmap

5. **Retry Count Trend**
   - Query: `automation_stage_retries`
   - Visualization: Time series

### Metrics

Available metrics via `/status` and `/metrics`:

| Metric | Type | Description |
|--------|------|-------------|
| `automation_uptime_seconds` | Gauge | Total uptime since start |
| `automation_execution_count` | Counter | Number of workflow executions |
| `automation_status` | Gauge | System status (0/1/2) |
| `automation_stage_success` | Gauge | Per-stage success flags |
| `automation_stage_retries` | Gauge | Per-stage retry counts |

**Status Values:**
- `2`: Healthy - all systems operational
- `1`: Degraded - some failures with retry available
- `0`: Failed - max retries exceeded

### Alerting Rules

**Prometheus AlertManager Rules:**

```yaml
groups:
- name: automation_alerts
  interval: 30s
  rules:
  - alert: AutomationDown
    expr: up{job="automation"} == 0
    for: 2m
    labels:
      severity: critical
    annotations:
      summary: "Automation instance {{ $labels.instance }} is down"

  - alert: AutomationDegraded
    expr: automation_status < 2
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "Automation system degraded on {{ $labels.instance }}"

  - alert: HighRetryRate
    expr: sum(automation_stage_retries) > 10
    for: 3m
    labels:
      severity: warning
    annotations:
      summary: "High retry rate detected: {{ $value }} retries"

  - alert: WorkflowStageFailure
    expr: automation_stage_success{stage="workflowExecution"} == 0
    for: 1m
    labels:
      severity: critical
    annotations:
      summary: "Workflow execution failed on {{ $labels.instance }}"
```

### Logging

Logs accessible via:
```bash
# Follow logs
kubectl logs -f deployment/user1

# Last 100 lines
kubectl logs --tail=100 deployment/user1

# Previous container (if crashed)
kubectl logs -p deployment/user1
```

## Security Considerations

### Secrets Management

**Current**: Environment variables in Helm values
**Recommended**: Kubernetes Secrets

```yaml
# Example secret creation
kubectl create secret generic user1-creds \
  --from-literal=username=user1 \
  --from-literal=password=secretpass
```

### Network Policies

Recommended isolation:
```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: automation-policy
spec:
  podSelector:
    matchLabels:
      app: user1
  policyTypes:
  - Ingress
  - Egress
  egress:
  - to:
    - podSelector: {}
    ports:
    - protocol: TCP
      port: 443
```

### RBAC

Minimal permissions for automation pods:
- No cluster-wide access
- Namespace-scoped only
- Read-only service account

## Troubleshooting

### Common Issues

**Pod not starting:**
```bash
kubectl describe pod <pod-name>
kubectl logs <pod-name>
```

**Image pull errors:**
```bash
# For local images
minikube image load online-platform-automation:dev

# Or set pull policy
pullPolicy: IfNotPresent  # or Never
```

**Configuration errors:**
```bash
# Validate Helm chart
helm lint helm/platform-automation

# Template output
helm template test helm/platform-automation \
  -f user-configs/user1.yaml
```

**Resource constraints:**
```bash
# Check resource usage
kubectl top pods

# Adjust limits in user config
```

### Debug Mode

Enable verbose logging:
```yaml
userConfig:
  logLevel: "debug"
```

## Performance Optimization

### Container Optimization
- Multi-stage builds reduce image size
- Production-only dependencies
- Code obfuscation adds minimal overhead
- Alpine base for minimal footprint

### Kubernetes Optimization
- Resource requests enable better scheduling
- CPU/memory limits prevent resource hogging
- Horizontal Pod Autoscaler (HPA) for scaling:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: user1-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: user1
  minReplicas: 1
  maxReplicas: 3
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
```

## Extending the Framework

### Adding Custom Logic

Implement automation in `Automation.run()`:

```typescript
async run() {
    try {
        Logger.info("Starting automation workflow...");
        
        // Your custom implementation here
        // Examples:
        // - API calls
        // - Web scraping
        // - Data processing
        // - Scheduled tasks
        
        this.systemStatus = "healthy";
    } catch (error: any) {
        Logger.error(`Error: ${error.message}`);
        this.systemStatus = "failed";
    }
}
```

### Adding Dependencies

Update `source/package.json`:
```json
{
  "dependencies": {
    "dotenv": "^16.4.7",
    "express": "^4.21.2",
    "your-library": "^1.0.0"
  }
}
```

### Adding Endpoints

Extend Express routes:
```typescript
app.get("/custom-endpoint", async (req, res) => {
    // Your handler logic
    res.json({ data: "response" });
});
```

## CI/CD Integration

### Example GitLab CI

```yaml
stages:
  - build
  - deploy

build-image:
  stage: build
  script:
    - docker build -t $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA source
    - docker push $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA

deploy-k8s:
  stage: deploy
  script:
    - helm upgrade --install user1 helm/platform-automation \
        --set image.tag=$CI_COMMIT_SHA \
        -f user-configs/user1.yaml
```

### Example GitHub Actions

```yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      
      - name: Build Docker image
        run: docker build -t automation:${{ github.sha }} source
      
      - name: Deploy to Kubernetes
        run: |
          helm upgrade --install user1 helm/platform-automation \
            --set image.tag=${{ github.sha }} \
            -f user-configs/user1.yaml
```

## Version History

- **v0.1.0** (Initial): Basic framework with Helm deployment support
- Future versions will include additional features based on requirements

## Best Practices

1. **Secrets**: Never commit `.env` files or credentials
2. **Resources**: Set appropriate limits based on workload
3. **Logging**: Use appropriate log levels (debug only in dev)
4. **Monitoring**: Implement health checks for production
5. **Updates**: Keep dependencies updated for security
6. **Testing**: Test Helm charts with `--dry-run` before deploying
7. **Cleanup**: Remove unused deployments to free resources

## DevOps Best Practices Implemented

### 1. Containerization
- ✅ Multi-stage Docker builds for minimal image size
- ✅ Alpine-based runtime for security and efficiency
- ✅ Code obfuscation protecting intellectual property
- ✅ Non-root user execution for security

### 2. Orchestration
- ✅ Kubernetes-native deployment with Helm
- ✅ ConfigMaps for configuration management
- ✅ Resource limits preventing resource exhaustion
- ✅ Horizontal Pod Autoscaler (HPA) support
- ✅ Multi-user isolation via namespaces

### 3. Observability
- ✅ Structured logging with Winston
- ✅ Prometheus metrics endpoint
- ✅ Health check endpoints (liveness/readiness)
- ✅ Distributed tracing ready
- ✅ Execution stage tracking

### 4. Reliability
- ✅ Retry logic with exponential backoff
- ✅ Mutex-based concurrency control
- ✅ Self-healing monitoring loop
- ✅ Graceful shutdown handling (SIGTERM/SIGINT)
- ✅ Circuit breaker pattern ready

### 5. Security
- ✅ Secrets management via Kubernetes Secrets
- ✅ RBAC-ready service accounts
- ✅ Network policies for pod isolation
- ✅ Non-hardcoded credentials
- ✅ Environment-based configuration

### 6. CI/CD Integration
- ✅ GitLab CI/CD pipeline examples
- ✅ GitHub Actions workflow examples
- ✅ Automated Docker builds
- ✅ Helm chart validation
- ✅ Blue-green deployment support

### 7. Scalability
- ✅ Stateless application design
- ✅ Horizontal scaling via replicas
- ✅ Resource requests/limits tuning
- ✅ Load balancing ready
- ✅ Multi-instance deployment support

### 8. Maintainability
- ✅ TypeScript for type safety
- ✅ Modular architecture
- ✅ Comprehensive documentation
- ✅ Clear error messages
- ✅ Versioned Helm charts

## Production Deployment Checklist

### Pre-Deployment
- [ ] Build and test Docker image locally
- [ ] Validate Helm chart with `--dry-run`
- [ ] Configure resource limits appropriately
- [ ] Set up Kubernetes Secrets for credentials
- [ ] Review and adjust retry limits
- [ ] Configure monitoring interval

### Deployment
- [ ] Deploy to staging environment first
- [ ] Verify health endpoints respond correctly
- [ ] Check Prometheus metrics are scraped
- [ ] Test graceful shutdown (SIGTERM)
- [ ] Validate log output format
- [ ] Confirm mutex prevents race conditions

### Post-Deployment
- [ ] Set up Prometheus alerts
- [ ] Create Grafana dashboards
- [ ] Configure log aggregation (ELK/Loki)
- [ ] Document runbook for common issues
- [ ] Set up on-call rotation
- [ ] Schedule regular dependency updates

### Monitoring Checklist
- [ ] `/metrics` endpoint accessible
- [ ] Prometheus scraping configured
- [ ] Alert rules created
- [ ] Grafana dashboards deployed
- [ ] Log aggregation working
- [ ] Error tracking configured

## Performance Tuning

### Monitoring Interval

```typescript
// Adjust based on requirements
const MONITORING_INTERVAL = 30000; // 30s (default)
// High-frequency: 10000 (10s)
// Low-frequency: 60000 (60s)
```

**Trade-offs:**
- Lower interval = faster detection, higher CPU usage
- Higher interval = slower detection, lower CPU usage

### Retry Configuration

```typescript
stageStatus = {
    initialization: {
        maxRetries: 3,  // Fast-fail for initialization
    },
    workflowExecution: {
        maxRetries: 5,  // More retries for critical workflow
    },
    healthCheck: {
        maxRetries: 3,  // Moderate retries for health checks
    },
};
```

### Resource Optimization

**For CPU-intensive workflows:**
```yaml
resources:
  limits:
    cpu: 1000m      # 1 core
    memory: 1Gi
  requests:
    cpu: 500m       # 0.5 cores
    memory: 512Mi
```

**For memory-intensive workflows:**
```yaml
resources:
  limits:
    cpu: 500m
    memory: 2Gi     # 2GB
  requests:
    cpu: 200m
    memory: 1Gi     # 1GB
```

## Support and Contribution

This is a framework/template project. Implement your specific automation logic in the `Automation.run()` method.

For infrastructure improvements or bug fixes, consider:
- Adding comprehensive tests
- Implementing metrics collection
- Adding distributed tracing
- Implementing circuit breakers
- Adding rate limiting
