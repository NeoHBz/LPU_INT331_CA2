# Online Platform Automation

Automated platform system using Puppeteer, TypeScript, and Kubernetes deployment via Helm.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Project Structure](#project-structure)
- [Setup](#setup)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Managing Multiple Users](#managing-multiple-users)
- [Common Commands](#common-commands)
- [Troubleshooting](#troubleshooting)

## Prerequisites

- **Docker**: For building container images
- **Kubernetes**: Local cluster (Minikube, Docker Desktop, or similar)
- **Helm**: v3.x or later for Kubernetes deployments
- **Node.js**: v18.0.0 or later (for local development)
- **npm**: Package manager

## Project Structure

```
.
├── helm/
│   └── platform-automation/
│       ├── Chart.yaml           # Helm chart metadata
│       ├── values.yaml          # Default configuration values
│       └── templates/
│           └── deployment.yaml  # Kubernetes deployment template
├── source/
│   ├── Dockerfile              # Container image definition
│   ├── package.json            # Application dependencies
│   ├── tsconfig.json           # TypeScript configuration
│   └── src/
│       ├── index.ts            # Application entry point
│       └── utils/
│           └── logger.ts       # Logging utilities
├── user-configs/
│   └── user1.yaml              # User-specific configurations
└── package.json                # Root scripts for automation
```

## Setup

### 1. Clone the Repository

```bash
git clone git@github.com:NeoHBz/online-platform-automation.git
cd online-platform-automation
```

### 2. Install Dependencies (for local development)

```bash
cd source
npm install
```

### 3. Build Docker Image

Build the container image for the automation application:

```bash
npm run docker:build
```

Or manually:

```bash
docker build -t online-platform-automation:dev source
```

### 4. Verify Kubernetes Cluster

Ensure your Kubernetes cluster is running:

```bash
kubectl cluster-info
kubectl get nodes
```

### 5. Verify Helm Installation

```bash
helm version
```

## Configuration

### Helm Chart Configuration

The main configuration is in [helm/platform-automation/values.yaml](helm/platform-automation/values.yaml):

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
  classUrl: ""
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

### User-Specific Configuration

Create user configuration files in the `user-configs/` directory. Each file should override the necessary values:

**Example: user-configs/user1.yaml**

```yaml
userConfig:
  username: "john.doe"
  password: "secure_password"
  homeUrl: "https://platform.example.com"
  emailPrefix: "john.doe"
  classUrl: "https://platform.example.com/class/12345"
  logLevel: "debug"
  headless: 1
```

**Configuration Parameters:**

- `username`: Platform login username
- `password`: Platform login password
- `homeUrl`: Base URL of the platform
- `emailPrefix`: Email prefix for notifications
- `classUrl`: Direct URL to the class/meeting
- `logLevel`: Logging level (`debug`, `info`, `warn`, `error`)
- `headless`: Run browser in headless mode (1 = headless, 0 = visible)

## Deployment

### Deploy a Single User Instance

Deploy using a user-specific configuration:

```bash
helm install <release-name> helm/platform-automation -f user-configs/<user>.yaml
```

**Example:**

```bash
helm install user1 helm/platform-automation -f user-configs/user1.yaml
```

Or use the npm script:

```bash
npm run helm:user1
```

### Verify Deployment

Check deployment status:

```bash
helm list
kubectl get deployments
kubectl get pods
```

View logs:

```bash
kubectl logs -l app=<release-name> -f
```

### Update Existing Deployment

If you modify the user configuration, upgrade the deployment:

```bash
helm upgrade <release-name> helm/platform-automation -f user-configs/<user>.yaml
```

### Uninstall Deployment

Remove a deployment:

```bash
helm uninstall <release-name>
```

Or use the npm script:

```bash
npm run helm:uninstall
```

## Managing Multiple Users

### Creating New User Configurations

1. **Create a new user config file:**

```bash
cp user-configs/user1.yaml user-configs/user2.yaml
```

2. **Edit the configuration:**

```bash
nano user-configs/user2.yaml
```

Update with user-specific credentials and URLs.

3. **Add npm script (optional):**

Edit [package.json](package.json) and add:

```json
{
  "scripts": {
    "helm:user2": "helm install user2 helm/platform-automation -f user-configs/user2.yaml"
  }
}
```

4. **Deploy the new user:**

```bash
npm run helm:user2
```

Or manually:

```bash
helm install user2 helm/platform-automation -f user-configs/user2.yaml
```

### List All Running Instances

```bash
helm list
kubectl get pods -o wide
```

### Spin Up Multiple Containers Simultaneously

Deploy multiple users in parallel:

```bash
helm install user1 helm/platform-automation -f user-configs/user1.yaml &
helm install user2 helm/platform-automation -f user-configs/user2.yaml &
helm install user3 helm/platform-automation -f user-configs/user3.yaml &
wait
```

Or create a bash script `deploy-all.sh`:

```bash
#!/bin/bash
for config in user-configs/*.yaml; do
  username=$(basename "$config" .yaml)
  echo "Deploying $username..."
  helm install "$username" helm/platform-automation -f "$config"
done
```

Make it executable and run:

```bash
chmod +x deploy-all.sh
./deploy-all.sh
```

## Common Commands

### Development

```bash
# Build TypeScript locally
cd source && npm run build

# Run locally (dev mode)
cd source && npm run dev

# Run compiled version
cd source && npm start
```

### Docker

```bash
# Build image
npm run docker:build

# Remove image and uninstall
npm run docker:imgrm

# Full rebuild and deploy
npm run auto
```

### Helm

```bash
# Install with custom release name
helm install <name> helm/platform-automation -f user-configs/<user>.yaml

# Upgrade existing deployment
helm upgrade <name> helm/platform-automation -f user-configs/<user>.yaml

# Uninstall deployment
helm uninstall <name>

# List all deployments
helm list

# Get deployment values
helm get values <name>

# Dry-run to validate
helm install <name> helm/platform-automation -f user-configs/<user>.yaml --dry-run --debug
```

### Kubernetes

```bash
# View pods
kubectl get pods

# View logs
kubectl logs -l app=<release-name> -f

# Describe pod
kubectl describe pod <pod-name>

# Execute into container
kubectl exec -it <pod-name> -- /bin/sh

# Delete pod (will be recreated by deployment)
kubectl delete pod <pod-name>

# View deployments
kubectl get deployments

# Scale deployment
kubectl scale deployment <release-name> --replicas=2
```

## Troubleshooting

### Pod Not Starting

Check pod status and events:

```bash
kubectl describe pod <pod-name>
kubectl logs <pod-name>
```

Common issues:
- Image not found: Ensure Docker image is built and available
- ImagePullBackOff: Check image name and pull policy
- CrashLoopBackOff: Check application logs for errors

### Image Pull Errors

If using local images, ensure proper image pull policy:

```yaml
image:
  pullPolicy: IfNotPresent  # or Never for local-only images
```

For Minikube, load the image:

```bash
minikube image load online-platform-automation:dev
```

For Docker Desktop, ensure the image exists:

```bash
docker images | grep online-platform-automation
```

### Configuration Issues

Validate Helm chart:

```bash
helm lint helm/platform-automation
helm template test helm/platform-automation -f user-configs/user1.yaml
```

### Viewing Application Logs

```bash
# Follow logs in real-time
kubectl logs -l app=<release-name> -f

# Get logs from all pods with label
kubectl logs -l app=<release-name> --all-containers=true

# Get previous container logs (if crashed)
kubectl logs <pod-name> --previous
```

### Resource Constraints

If pods are being evicted or OOMKilled, adjust resources in user config:

```yaml
resources:
  limits:
    cpu: 1000m
    memory: 1Gi
  requests:
    cpu: 200m
    memory: 512Mi
```

## Environment Variables

The application uses these environment variables (configured via Helm):

- `USERNAME`: Platform username
- `PASSWORD`: Platform password
- `HOME_URL`: Platform home URL
- `EMAIL_PREFIX`: Email prefix for notifications
- `CLASS_URL`: Class/meeting URL
- `LOG_LEVEL`: Logging verbosity (`debug`, `info`, `warn`, `error`)
- `HEADLESS`: Browser headless mode (1 or 0)

## License

See repository for license information.

## Author

**NeoHBz**
- Email: neohbz@gmail.com
- Website: https://neohbz.com
- GitHub: [@NeoHBz](https://github.com/NeoHBz)
