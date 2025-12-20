# Kubernetes Deployment Quick Reference

## Prerequisites Setup

```bash
# Install required tools (macOS)
brew install docker kubectl helm

# Start a local Kubernetes cluster
# Option 1: Minikube
brew install minikube
minikube start --driver=docker

# Option 2: kind
brew install kind
kind create cluster --name platform-automation
```

## Quick Start

```bash
# 1. Build Docker image and deploy all users
./automate.sh

# 2. Check status
./automate.sh list

# 3. View logs for a specific user
./automate.sh logs user1
```

## Common Commands

| Command | Description |
|---------|-------------|
| `./automate.sh` | Build image and deploy all users |
| `./automate.sh build` | Build Docker image only |
| `./automate.sh deploy` | Deploy all user configurations |
| `./automate.sh deploy-user user1` | Deploy specific user |
| `./automate.sh list` | List all deployments and pods |
| `./automate.sh logs user1` | View logs for user1 |
| `./automate.sh delete user1` | Delete user1 deployment |
| `./automate.sh delete-all` | Delete all deployments |
| `./automate.sh help` | Show help message |

## Adding a New User

1. Create configuration file:
   ```bash
   cp user-configs/user1.yaml user-configs/user3.yaml
   ```

2. Edit the configuration:
   ```bash
   # Edit username, password, and other settings
   vim user-configs/user3.yaml
   ```

3. Deploy:
   ```bash
   ./automate.sh deploy-user user3
   ```

## Manual Kubernetes Commands

```bash
# View all resources
kubectl get all -n platform-automation

# Get pod details
kubectl describe pod <pod-name> -n platform-automation

# View real-time logs
kubectl logs -f <pod-name> -n platform-automation

# Execute command in pod
kubectl exec -it <pod-name> -n platform-automation -- /bin/sh

# Port forward to pod
kubectl port-forward <pod-name> 3000:3000 -n platform-automation
```

## Manual Helm Commands

```bash
# List releases
helm list -n platform-automation

# Install/upgrade release
helm upgrade --install platform-user1 ./helm/platform-automation \
  -n platform-automation \
  -f user-configs/user1.yaml

# Uninstall release
helm uninstall platform-user1 -n platform-automation

# Check release status
helm status platform-user1 -n platform-automation

# View release values
helm get values platform-user1 -n platform-automation
```

## Troubleshooting

### Pod not starting
```bash
kubectl get pods -n platform-automation
kubectl describe pod <pod-name> -n platform-automation
kubectl logs <pod-name> -n platform-automation
```

### Image not found (kind clusters)
```bash
./automate.sh build  # Rebuilds and loads image to kind
```

### Check cluster connection
```bash
kubectl cluster-info
kubectl config current-context
```

## File Structure

```
├── automate.sh              # Main automation script
├── K8S_SETUP.md            # Detailed setup documentation
├── source/                 # Application source code
│   └── Dockerfile         # Docker image definition
├── helm/platform-automation/   # Helm chart
│   ├── Chart.yaml
│   ├── values.yaml
│   └── templates/
│       ├── deployment.yaml
│       ├── service.yaml
│       ├── configmap.yaml
│       └── secret.yaml
└── user-configs/           # User configurations
    ├── user1.yaml
    └── user2.yaml
```

## For More Details

See [K8S_SETUP.md](./K8S_SETUP.md) for comprehensive documentation including:
- Detailed prerequisites installation
- Production considerations
- Security best practices
- Scaling and monitoring
- CI/CD integration examples
