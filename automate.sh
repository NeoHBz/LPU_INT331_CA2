#!/bin/bash

# Main automation script - orchestrates build and deploy scripts

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source common functions and scripts
source "$SCRIPT_DIR/scripts/common.sh"
source "$SCRIPT_DIR/scripts/build.sh"
source "$SCRIPT_DIR/scripts/deploy.sh"

# Function to show main usage
show_usage() {
    cat << EOF
${GREEN}Platform Automation - Main Orchestration Script${NC}

${BLUE}Usage:${NC}
    $0 [COMMAND] [OPTIONS]

${BLUE}Commands:${NC}
    ${YELLOW}Build Commands:${NC}
    build               Build Docker image (includes local TypeScript compilation)
    build-local         Build TypeScript locally only (no Docker)
    clean               Clean build artifacts
    
    ${YELLOW}Deploy Commands:${NC}
    deploy              Deploy all user configurations
    deploy-user <user>  Deploy specific user (e.g., deploy-user user1)
    list                List all deployments and pods
    status              Show detailed deployment status
    logs <user>         Show logs for specific user
    delete <user>       Delete deployment for specific user
    delete-all          Delete all deployments
    
    ${YELLOW}Combined Commands:${NC}
    all                 Build and deploy everything (default)
    
    ${YELLOW}Other:${NC}
    help                Show this help message

${BLUE}Examples:${NC}
    $0                  # Build and deploy all (default)
    $0 build            # Build Docker image
    $0 deploy           # Deploy all users (uses existing image)
    $0 deploy-user user1    # Deploy only user1
    $0 logs user1       # Stream logs for user1
    $0 delete user1     # Delete user1 deployment
    $0 list             # List all deployments
    $0 status           # Show detailed status

${BLUE}Quick Start:${NC}
    1. Setup a local Kubernetes cluster:
       ${YELLOW}kind create cluster --name platform-automation${NC}
       
    2. Build and deploy:
       ${YELLOW}$0${NC}
       
    3. Check status:
       ${YELLOW}$0 list${NC}

${BLUE}Environment Variables:${NC}
    NAMESPACE           Kubernetes namespace (default: platform-automation)
    DOCKER_IMAGE_TAG    Docker image tag (default: dev)

${BLUE}Separate Scripts:${NC}
    For more control, use the separate scripts:
    - ${YELLOW}./scripts/build.sh${NC}   - Build operations only
    - ${YELLOW}./scripts/deploy.sh${NC}  - Deploy operations only

EOF
}

# Main script logic
case "${1:-all}" in
    # Build commands
    build)
        check_build_prerequisites
        build_docker_image
        load_image_to_kind
        ;;
    build-local)
        check_build_prerequisites
        build_local_artifact
        ;;
    clean)
        clean_artifacts
        ;;
    
    # Deploy commands
    deploy)
        check_deploy_prerequisites
        create_namespace
        deploy_all_users
        ;;
    deploy-user)
        if [ -z "${2:-}" ]; then
            print_error "Please specify a username"
            echo "Usage: $0 deploy-user <username>"
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
    
    # Combined commands
    all)
        check_build_prerequisites
        check_deploy_prerequisites
        build_docker_image
        load_image_to_kind
        create_namespace
        deploy_all_users
        ;;
    
    # Help
    help|--help|-h)
        show_usage
        ;;
    
    *)
        print_error "Unknown command: $1"
        echo ""
        show_usage
        exit 1
        ;;
esac
