# Kubernetes & Helm Setup Guide

This guide will help you set up and deploy the platform automation system using Kubernetes and Helm.

## Prerequisites

Before you begin, ensure you have the following installed:

1. **Docker** - Container runtime
   ```bash
   # macOS (using Homebrew)
   brew install --cask docker
   
   # Verify installation
   docker --version
   ```

2. **kubectl** - Kubernetes command-line tool
   ```bash
   # macOS (using Homebrew)
   brew install kubectl
   
   # Verify installation
   kubectl version --client
   ```

3. **Helm** - Kubernetes package manager
   ```bash
   # macOS (using Homebrew)
   brew install helm
   
   # Verify installation
   helm version
   ```

4. **A Kubernetes Cluster** - Choose one of the following:

   ### Option A: Minikube (Local Development)
   ```bash
   # Install Minikube
   brew install minikube
   
   # Start Minikube
   minikube start --driver=docker --memory=4096 --cpus=2
   
   # Verify cluster is running
   kubectl cluster-info
   ```

   ### Option B: kind (Kubernetes in Docker)
   ```bash
   # Install kind
   brew install kind
   
   # Create a cluster
   kind create cluster --name platform-automation
   
   # Verify cluster
   kubectl cluster-info --context kind-platform-automation
   ```

   ### Option C: Cloud Provider (Production)
   - **AWS EKS**: Use `eksctl` or AWS Console
   - **Google GKE**: Use `gcloud` CLI
   - **Azure AKS**: Use `az` CLI
   - **DigitalOcean**: Use `doctl` CLI

## Project Structure

```
.
├── automate.sh                    # Main automation script
├── source/                        # Application source code
│   ├── Dockerfile                 # Docker image definition
│   ├── package.json              # Node.js dependencies
│   └── src/                      # Application code
├── helm/platform-automation/      # Helm chart
│   ├── Chart.yaml                # Chart metadata
│   ├── values.yaml               # Default configuration values
│   └── templates/                # Kubernetes manifest templates
│       ├── deployment.yaml       # Pod deployment definition
│       ├── service.yaml          # Service definition
│       ├── configmap.yaml        # Configuration data
│       └── secret.yaml           # Sensitive data (passwords)
└── user-configs/                  # User-specific configurations
    └── user1.yaml                # Example user configuration
```

## Quick Start

### 1. Setup Kubernetes Cluster

Choose and set up one of the cluster options mentioned in Prerequisites.

### 2. Build and Deploy

The `automate.sh` script handles everything:

```bash
# Full workflow: Build Docker image and deploy all users
./automate.sh

# Or run step by step:
./automate.sh build              # Build Docker image only
./automate.sh deploy             # Deploy all users
```

### 3. Verify Deployment

```bash
# List all deployments
./automate.sh list

# Or use kubectl directly
kubectl get pods -n platform-automation
kubectl get services -n platform-automation
```

## Using automate.sh Script

The automation script provides several commands:

### Build Docker Image
```bash
./automate.sh build
```
- Builds the Docker image from the `source/` directory
- Tags it as `online-platform-automation:dev`
- Automatically loads to kind cluster if detected

### Deploy All Users
```bash
./automate.sh deploy
```
- Creates the `platform-automation` namespace
- Deploys Helm releases for all users in `user-configs/`
- Each user gets their own pod and service

### Deploy Specific User
```bash
./automate.sh deploy-user user1
```
- Deploys or upgrades only the specified user
- Uses the config file `user-configs/user1.yaml`

### List Deployments
```bash
./automate.sh list
```
- Shows all Helm releases
- Lists all pods with their status

### View Logs
```bash
./automate.sh logs user1
```
- Streams logs from the user's pod
- Press Ctrl+C to stop following logs

### Delete Deployment
```bash
# Delete specific user
./automate.sh delete user1

# Delete all deployments
./automate.sh delete-all
```

### Show Help
```bash
./automate.sh help
```

## User Configuration

### Creating a New User

1. Create a new YAML file in `user-configs/`:
   ```bash
   cp user-configs/user1.yaml user-configs/user2.yaml
   ```

2. Edit the configuration:
   ```yaml
   userConfig:
     username: "bobsmith"
     password: "securepass456"
     homepageUrl: "http://localhost:5173"
     emailPrefix: "bob"
     targetUrl: "http://localhost:5173/class"
     logLevel: "info"
     headless: 1
   ```

3. Deploy the new user:
   ```bash
   ./automate.sh deploy-user user2
   ```

### Configuration Options

| Field | Description | Example |
|-------|-------------|---------|
| `username` | Login username | `alicesmith` |
| `password` | Login password (stored securely) | `password123` |
| `homepageUrl` | Starting URL | `http://localhost:5173` |
| `emailPrefix` | Email prefix for login | `alice` |
| `targetUrl` | Target page URL | `http://localhost:5173/class` |
| `logLevel` | Logging verbosity | `info`, `debug`, `error` |
| `headless` | Run browser in headless mode | `1` (yes) or `0` (no) |

## Helm Chart Details

### Chart Structure

The Helm chart creates the following Kubernetes resources:

1. **Deployment**: Manages pod lifecycle and replicas
2. **Service**: Exposes the pod on the cluster network
3. **ConfigMap**: Stores non-sensitive configuration
4. **Secret**: Stores sensitive data (passwords)

### Customizing Helm Values

You can override default values when deploying:

```bash
helm install platform-user1 ./helm/platform-automation \
  --namespace platform-automation \
  --values user-configs/user1.yaml \
  --set image.tag=latest \
  --set replicaCount=2
```

### Available Helm Values

```yaml
replicaCount: 1                    # Number of pod replicas

image:
  repository: online-platform-automation
  pullPolicy: IfNotPresent         # Image pull policy
  tag: "dev"                       # Image tag

userConfig:
  username: ""                     # Login username
  password: ""                     # Login password
  homepageUrl: ""                  # Starting URL
  emailPrefix: ""                  # Email prefix
  targetUrl: ""                    # Target page URL
  logLevel: "info"                 # Log level
  headless: 1                      # Headless browser mode

resources:                         # Resource limits
  limits:
    cpu: 500m
    memory: 512Mi
  requests:
    cpu: 100m
    memory: 256Mi
```

## Manual Kubernetes Operations

If you prefer not to use the automation script:

### Build and Push Image
```bash
# Build image
cd source
docker build -t online-platform-automation:dev .

# For kind cluster
kind load docker-image online-platform-automation:dev --name platform-automation

# For remote registry
docker tag online-platform-automation:dev your-registry/online-platform-automation:dev
docker push your-registry/online-platform-automation:dev
```

### Deploy with Helm
```bash
# Create namespace
kubectl create namespace platform-automation

# Install release
helm install platform-user1 ./helm/platform-automation \
  --namespace platform-automation \
  --values user-configs/user1.yaml

# Upgrade release
helm upgrade platform-user1 ./helm/platform-automation \
  --namespace platform-automation \
  --values user-configs/user1.yaml

# Uninstall release
helm uninstall platform-user1 --namespace platform-automation
```

### Check Resources
```bash
# Get all resources in namespace
kubectl get all -n platform-automation

# Describe pod
kubectl describe pod <pod-name> -n platform-automation

# View logs
kubectl logs <pod-name> -n platform-automation -f

# Execute command in pod
kubectl exec -it <pod-name> -n platform-automation -- /bin/sh
```

## Troubleshooting

### Pod Not Starting

1. Check pod status:
   ```bash
   kubectl get pods -n platform-automation
   kubectl describe pod <pod-name> -n platform-automation
   ```

2. Common issues:
   - **ImagePullBackOff**: Image not available in cluster
     - For kind: Run `./automate.sh build` to reload image
     - For remote: Check image registry and pull secrets
   
   - **CrashLoopBackOff**: Application is crashing
     - Check logs: `kubectl logs <pod-name> -n platform-automation`
     - Verify configuration in user config file

### Cannot Connect to Cluster

```bash
# Check current context
kubectl config current-context

# List available contexts
kubectl config get-contexts

# Switch context
kubectl config use-context <context-name>

# Test connection
kubectl cluster-info
```

### Helm Release Issues

```bash
# List releases
helm list -n platform-automation

# Check release status
helm status platform-user1 -n platform-automation

# View release history
helm history platform-user1 -n platform-automation

# Rollback to previous version
helm rollback platform-user1 -n platform-automation
```

### Image Not Found in kind

```bash
# Reload image to kind cluster
kind load docker-image online-platform-automation:dev --name platform-automation

# Or rebuild and reload automatically
./automate.sh build
```

## Production Considerations

### Security

1. **Use Secrets Manager**:
   - Don't commit passwords to version control
   - Use Kubernetes Secrets or external secret managers (AWS Secrets Manager, HashiCorp Vault)

2. **Image Registry**:
   - Use a private container registry
   - Enable image scanning for vulnerabilities
   - Use specific version tags instead of `latest`

3. **Resource Limits**:
   - Set appropriate CPU and memory limits
   - Use resource quotas at namespace level

### Scaling

1. **Horizontal Pod Autoscaling**:
   ```bash
   kubectl autoscale deployment platform-user1 \
     --cpu-percent=80 \
     --min=1 \
     --max=10 \
     -n platform-automation
   ```

2. **Multiple Replicas**:
   ```yaml
   # In user config file
   replicaCount: 3
   ```

### Monitoring

1. **Prometheus & Grafana**:
   - Install monitoring stack
   - Create dashboards for pod metrics
   - Set up alerts for failures

2. **Logging**:
   - Use centralized logging (ELK, Loki)
   - Ship logs from all pods
   - Set appropriate log levels

### High Availability

1. **Multi-node cluster**: Deploy across multiple nodes
2. **Pod Disruption Budgets**: Ensure minimum pods available during updates
3. **Node Affinity**: Distribute pods across availability zones

## Environment Variables

The automation script supports these environment variables:

```bash
# Custom namespace
NAMESPACE=my-custom-namespace ./automate.sh deploy

# Custom image tag
DOCKER_IMAGE_TAG=v1.2.3 ./automate.sh build
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Deploy to Kubernetes

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      
      - name: Build and Deploy
        run: |
          ./automate.sh build
          ./automate.sh deploy
        env:
          KUBECONFIG: ${{ secrets.KUBECONFIG }}
```

## Additional Resources

- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [Helm Documentation](https://helm.sh/docs/)
- [kubectl Cheat Sheet](https://kubernetes.io/docs/reference/kubectl/cheatsheet/)
- [kind Documentation](https://kind.sigs.k8s.io/)
- [Minikube Documentation](https://minikube.sigs.k8s.io/docs/)

## Support

For issues or questions:
1. Check the troubleshooting section
2. View pod logs: `./automate.sh logs <username>`
3. Review Helm release status: `helm status <release-name> -n platform-automation`
4. Consult Kubernetes documentation
