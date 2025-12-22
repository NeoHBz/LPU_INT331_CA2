#!/bin/bash

# Build script - handles local compilation and Docker image building

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Source common functions and variables
source "$SCRIPT_DIR/common.sh"

# Change to project root
cd "$PROJECT_ROOT" || exit 1

# Function to check build prerequisites
check_build_prerequisites() {
    print_info "Checking build prerequisites..."
    
    local missing_tools=()
    
    if ! command_exists docker; then
        missing_tools+=("docker")
    fi

    if ! command_exists bun; then
        missing_tools+=("bun")
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
    
    print_success "All build prerequisites met!"
}

# Function to build locally and create zip artifact
build_local_artifact() {
    print_info "Building application locally..."
    
    if [ ! -d "$SOURCE_DIR" ]; then
        print_error "Source directory not found: $SOURCE_DIR"
        exit 1
    fi
    
    cd "$SOURCE_DIR" || exit 1
    
    # Install dependencies if node_modules doesn't exist
    if [ ! -d "node_modules" ]; then
        print_info "Installing dependencies with bun..."
        bun install
    fi
    
    # Clean previous build
    print_info "Cleaning previous build..."
    rm -rf dist/
    
    # Build TypeScript
    print_info "Compiling TypeScript..."
    if ! bun run build; then
        print_error "TypeScript compilation failed"
        cd - > /dev/null || exit 1
        exit 1
    fi
    
    print_success "TypeScript compilation successful!"
    
    # Create zip artifact with dist and package files
    print_info "Creating build artifact..."
    cd .. || exit 1
    
    # Remove old artifact if exists
    rm -f "$BUILD_ARTIFACT"
    
    # Create zip with dist folder and package files
    local archive_items=("$SOURCE_DIR/dist" "$SOURCE_DIR/package.json")
    
    # Support both legacy binary lock (lockb) and new text lock (lock)
    for lockfile in "bun.lockb" "bun.lock"; do
        if [ -f "$SOURCE_DIR/$lockfile" ]; then
            archive_items+=("$SOURCE_DIR/$lockfile")
        fi
    done

    if command_exists zip; then
        zip -r "$BUILD_ARTIFACT" "${archive_items[@]}" -q
    else
        # Fallback to tar if zip is not available
        BUILD_ARTIFACT="./build-artifact.tar.gz"
        tar -czf "$BUILD_ARTIFACT" "${archive_items[@]}"
    fi
    
    print_success "Build artifact created: $BUILD_ARTIFACT"
}

# Function to build Docker image using local artifact
build_docker_image() {
    print_info "Building Docker image: ${DOCKER_IMAGE_NAME}:${DOCKER_IMAGE_TAG}"
    print_info "Using local build artifact for faster builds..."
    
    # Build local artifact first
    build_local_artifact
    
    cd "$SOURCE_DIR" || exit 1
    
    # Enable BuildKit for faster builds with cache mounts
    export DOCKER_BUILDKIT=1
    
    if docker build -t "${DOCKER_IMAGE_NAME}:${DOCKER_IMAGE_TAG}" .; then
        print_success "Docker image built successfully!"
    else
        print_error "Failed to build Docker image"
        cd - > /dev/null || exit 1
        exit 1
    fi
    
    cd - > /dev/null || exit 1
}

# Function to load image to kind cluster (if using kind)
load_image_to_kind() {
    if command_exists kind; then
        print_info "Checking if running on kind cluster..."
        
        if ! command_exists kubectl; then
            print_warning "kubectl not found, skipping kind image load"
            return 0
        fi
        
        CURRENT_CONTEXT=$(kubectl config current-context 2>/dev/null)
        
        if [[ "$CURRENT_CONTEXT" == kind-* ]]; then
            CLUSTER_NAME=${CURRENT_CONTEXT#kind-}
            print_info "Loading image to kind cluster: $CLUSTER_NAME"
            if kind load docker-image "${DOCKER_IMAGE_NAME}:${DOCKER_IMAGE_TAG}" --name "$CLUSTER_NAME"; then
                print_success "Image loaded to kind cluster successfully!"
            else
                print_warning "Failed to load image to kind cluster"
            fi
        else
            print_info "Not using kind cluster, skipping image load"
        fi
    fi
}

# Function to clean build artifacts
clean_artifacts() {
    print_info "Cleaning build artifacts..."
    rm -f "$BUILD_ARTIFACT"
    rm -rf "$BUILD_DIR"
    print_success "Build artifacts cleaned"
}

# Function to show build help
show_build_help() {
    cat << EOF
${GREEN}Build Script - Local compilation and Docker image building${NC}

${BLUE}Usage:${NC}
    $0 [COMMAND]

${BLUE}Commands:${NC}
    local               Build application locally (TypeScript compilation)
    docker              Build Docker image (includes local build)
    clean               Clean build artifacts
    help                Show this help message

${BLUE}Examples:${NC}
    $0 local            # Compile TypeScript only
    $0 docker           # Build Docker image
    $0 clean            # Remove build artifacts

${BLUE}Environment Variables:${NC}
    DOCKER_IMAGE_NAME   Docker image name (default: online-platform-automation)
    DOCKER_IMAGE_TAG    Docker image tag (default: dev)

EOF
}

# Main build script logic
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    # Script is being executed directly
    case "${1:-docker}" in
        local)
            check_build_prerequisites
            build_local_artifact
            ;;
        docker)
            check_build_prerequisites
            build_docker_image
            load_image_to_kind
            ;;
        clean)
            clean_artifacts
            ;;
        help|--help|-h)
            show_build_help
            ;;
        *)
            print_error "Unknown command: $1"
            echo ""
            show_build_help
            exit 1
            ;;
    esac
fi
