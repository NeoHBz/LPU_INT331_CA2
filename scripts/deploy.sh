#!/bin/bash

# Deploy script - handles Kubernetes/Helm deployments

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Source common functions and variables
source "$SCRIPT_DIR/common.sh"

# Change to project root
cd "$PROJECT_ROOT" || exit 1

# Function to check deployment prerequisites
check_deploy_prerequisites() {
    print_info "Checking deployment prerequisites..."
    
    local missing_tools=()
    
    # Check if kubectl is installed
    if ! command_exists kubectl; then
        missing_tools+=("kubectl")
    fi
    
    # Check if Helm is installed
    if ! command_exists helm; then
        missing_tools+=("helm")
    fi
    
    if [ ${#missing_tools[@]} -gt 0 ]; then
        print_error "Missing required tools: ${missing_tools[*]}"
        echo ""
        echo "Please install the missing tools:"
        for tool in "${missing_tools[@]}"; do
            echo "  - $tool"
        done
        exit 1
    fi
    
    # Check if kubectl can connect to cluster
    if ! kubectl cluster-info &> /dev/null; then
        print_error "Cannot connect to Kubernetes cluster. Please check your kubeconfig."
        print_info "To setup a local cluster, run one of:"
        echo "  - minikube start --driver=docker"
        echo "  - kind create cluster --name platform-automation"
        exit 1
    fi
    
    print_success "All deployment prerequisites met!"
}

# Function to create namespace if it doesn't exist
create_namespace() {
    print_info "Checking namespace: $NAMESPACE"
    
    if kubectl get namespace "$NAMESPACE" &> /dev/null; then
        print_info "Namespace $NAMESPACE already exists"
    else
        print_info "Creating namespace: $NAMESPACE"
        kubectl create namespace "$NAMESPACE"
        print_success "Namespace created successfully!"
    fi
}

# Function to deploy using Helm for a specific user
deploy_user() {
    local user_config_file=$1
    local user_name=$(basename "$user_config_file" .yaml)
    local release_name="platform-${user_name}"
    
    print_info "Deploying for user: $user_name (release: $release_name)"
    
    if [ ! -f "$user_config_file" ]; then
        print_error "User config file not found: $user_config_file"
        return 1
    fi
    
    # Check if release already exists
    if helm list -n "$NAMESPACE" | grep -q "$release_name"; then
        print_info "Release $release_name already exists, upgrading..."
        helm upgrade "$release_name" "$HELM_CHART_PATH" \
            -f "$user_config_file" \
            -n "$NAMESPACE" \
            --set image.repository="${DOCKER_IMAGE_NAME}" \
            --set image.tag="${DOCKER_IMAGE_TAG}" \
            --wait
    else
        print_info "Installing new release: $release_name"
        helm install "$release_name" "$HELM_CHART_PATH" \
            -f "$user_config_file" \
            -n "$NAMESPACE" \
            --set image.repository="${DOCKER_IMAGE_NAME}" \
            --set image.tag="${DOCKER_IMAGE_TAG}" \
            --wait
    fi
    
    if [ $? -eq 0 ]; then
        print_success "Deployment successful for $user_name!"
    else
        print_error "Deployment failed for $user_name"
        return 1
    fi
}

# Function to deploy all users
deploy_all_users() {
    print_info "Deploying all users from: $USER_CONFIGS_DIR"
    
    if [ ! -d "$USER_CONFIGS_DIR" ]; then
        print_error "User configs directory not found: $USER_CONFIGS_DIR"
        exit 1
    fi
    
    # Find all .yaml files in user configs directory
    local config_files=("$USER_CONFIGS_DIR"/*.yaml)
    
    if [ ${#config_files[@]} -eq 0 ]; then
        print_warning "No user config files found in $USER_CONFIGS_DIR"
        return 0
    fi
    
    local success_count=0
    local fail_count=0
    local total_users=${#config_files[@]}
    local current_user=0
    
    for config_file in "${config_files[@]}"; do
        # Skip if it's the README or not a file
        if [[ "$(basename "$config_file")" == "README.yaml" ]] || [ ! -f "$config_file" ]; then
            continue
        fi
        
        ((current_user++))
        
        if deploy_user "$config_file"; then
            ((success_count++))
        else
            ((fail_count++))
        fi
        
        # Add random delay between deployments (0.5-2 seconds)
        # Skip delay for the last user
        if [ $current_user -lt $total_users ]; then
            local delay=$(awk -v min=0.5 -v max=2.0 'BEGIN{srand(); print min+rand()*(max-min)}')
            print_info "Waiting ${delay}s before next deployment..."
            sleep "$delay"
        fi
        
        echo "" # Add spacing between deployments
    done
    
    print_info "Deployment summary: $success_count successful, $fail_count failed"
}

# Function to list all deployments
list_deployments() {
    print_info "Listing all deployments in namespace: $NAMESPACE"
    helm list -n "$NAMESPACE"
    echo ""
    print_info "Pod status:"
    kubectl get pods -n "$NAMESPACE"
}

# Function to get logs for a specific user
get_logs() {
    local user_input=$1
    local pod_name=""
    
    # Check if input looks like a full pod name (contains platform- prefix)
    if [[ "$user_input" == platform-* ]]; then
        # Input is likely a pod name, use it directly if it exists
        if kubectl get pod -n "$NAMESPACE" "$user_input" &> /dev/null; then
            pod_name="$user_input"
            print_info "Getting logs for pod: $pod_name"
        else
            # Try removing the -0 suffix if present
            local base_name="${user_input%-*}"
            if kubectl get pod -n "$NAMESPACE" "${base_name}-0" &> /dev/null; then
                pod_name="${base_name}-0"
                print_info "Getting logs for pod: $pod_name"
            fi
        fi
    fi
    
    # If not found yet, treat as username
    if [ -z "$pod_name" ]; then
        local user_name="$user_input"
        local release_name="platform-${user_name}"
        
        print_info "Getting logs for user: $user_name (searching for release: $release_name)"
        
        # Get pod name for the release
        pod_name=$(kubectl get pods -n "$NAMESPACE" -l "app.kubernetes.io/instance=$release_name" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
        
        if [ -z "$pod_name" ]; then
            # Try alternate label selector
            pod_name=$(kubectl get pods -n "$NAMESPACE" -l "app=$release_name" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
        fi
        
        if [ -z "$pod_name" ]; then
            # Try direct pod name lookup
            if kubectl get pod -n "$NAMESPACE" "platform-${user_name}-0" &> /dev/null; then
                pod_name="platform-${user_name}-0"
            fi
        fi
    fi
    
    if [ -z "$pod_name" ]; then
        print_error "No pod found for: $user_input"
        print_info "Try using the username without 'platform-' prefix (e.g., 'anjali-mehta' not 'platform-anjali-mehta-0')"
        print_info "Available pods in namespace $NAMESPACE:"
        kubectl get pods -n "$NAMESPACE" -o custom-columns=NAME:.metadata.name,STATUS:.status.phase
        return 1
    fi
    
    kubectl logs -n "$NAMESPACE" "$pod_name" -f
}

# Function to delete a specific user deployment
delete_user() {
    local user_name=$1
    local release_name="platform-${user_name}"
    
    print_info "Deleting deployment for user: $user_name"
    
    if helm list -n "$NAMESPACE" | grep -q "$release_name"; then
        helm uninstall "$release_name" -n "$NAMESPACE"
        print_success "Deployment deleted for $user_name"
    else
        print_warning "No deployment found for user: $user_name"
    fi
}

# Function to delete all deployments
delete_all() {
    print_info "Deleting all deployments in namespace: $NAMESPACE"
    
    # Get all release names in the namespace
    local releases=$(helm list -n "$NAMESPACE" -q)
    
    if [ -z "$releases" ]; then
        print_info "No deployments found in namespace: $NAMESPACE"
        return 0
    fi
    
    for release in $releases; do
        print_info "Deleting release: $release"
        helm uninstall "$release" -n "$NAMESPACE"
    done
    
    print_success "All deployments deleted"
}

# Function to show deployment status
show_status() {
    print_info "Deployment status in namespace: $NAMESPACE"
    echo ""
    echo "=== Helm Releases ==="
    helm list -n "$NAMESPACE"
    echo ""
    echo "=== Pods ==="
    kubectl get pods -n "$NAMESPACE" -o wide
    echo ""
    echo "=== Services ==="
    kubectl get services -n "$NAMESPACE"
}

# Function to show deploy help
show_deploy_help() {
    cat << EOF
${GREEN}Deploy Script - Kubernetes/Helm deployment management${NC}

${BLUE}Usage:${NC}
    $0 [COMMAND] [OPTIONS]

${BLUE}Commands:${NC}
    all                 Deploy all user configurations
    user <username>     Deploy specific user (e.g., user user1)
    list                List all deployments and pods
    status              Show detailed deployment status
    logs <username>     Show logs for specific user
    delete <username>   Delete deployment for specific user
    delete-all          Delete all deployments
    help                Show this help message

${BLUE}Examples:${NC}
    $0 all              # Deploy all users
    $0 user user1       # Deploy only user1
    $0 list             # List deployments
    $0 status           # Show detailed status
    $0 logs user1       # Stream logs for user1
    $0 delete user1     # Delete user1 deployment

${BLUE}Environment Variables:${NC}
    NAMESPACE           Kubernetes namespace (default: platform-automation)
    DOCKER_IMAGE_TAG    Docker image tag (default: dev)

EOF
}

# Main deploy script logic
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    # Script is being executed directly
    case "${1:-all}" in
        all)
            check_deploy_prerequisites
            create_namespace
            deploy_all_users
            ;;
        user)
            if [ -z "${2:-}" ]; then
                print_error "Please specify a username"
                echo "Usage: $0 user <username>"
                exit 1
            fi
            check_deploy_prerequisites
            create_namespace
            deploy_user "$USER_CONFIGS_DIR/$2.yaml"
            ;;
        list)
            list_deployments
            ;;
        status)
            show_status
            ;;
        logs)
            if [ -z "${2:-}" ]; then
                print_error "Please specify a username"
                echo "Usage: $0 logs <username>"
                exit 1
            fi
            get_logs "$2"
            ;;
        delete)
            if [ -z "${2:-}" ]; then
                print_error "Please specify a username"
                echo "Usage: $0 delete <username>"
                exit 1
            fi
            delete_user "$2"
            ;;
        delete-all)
            delete_all
            ;;
        help|--help|-h)
            show_deploy_help
            ;;
        *)
            print_error "Unknown command: $1"
            echo ""
            show_deploy_help
            exit 1
            ;;
    esac
fi
