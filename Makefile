# Makefile for Platform Automation Kubernetes Deployment
# Alternative to automate.sh for those who prefer make commands

.PHONY: help build deploy deploy-user list logs delete delete-all clean check

# Configuration
DOCKER_IMAGE_NAME ?= online-platform-automation
DOCKER_IMAGE_TAG ?= dev
NAMESPACE ?= platform-automation
SOURCE_DIR = ./source
HELM_CHART = ./helm/platform-automation
USER_CONFIGS_DIR = ./user-configs

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

check: ## Check prerequisites
	@echo "Checking prerequisites..."
	@command -v docker >/dev/null 2>&1 || { echo "Docker is not installed"; exit 1; }
	@command -v kubectl >/dev/null 2>&1 || { echo "kubectl is not installed"; exit 1; }
	@command -v helm >/dev/null 2>&1 || { echo "Helm is not installed"; exit 1; }
	@kubectl cluster-info >/dev/null 2>&1 || { echo "Cannot connect to Kubernetes cluster"; exit 1; }
	@echo "All prerequisites met!"

build: check ## Build Docker image
	@echo "Building Docker image: $(DOCKER_IMAGE_NAME):$(DOCKER_IMAGE_TAG)"
	cd $(SOURCE_DIR) && docker build -t $(DOCKER_IMAGE_NAME):$(DOCKER_IMAGE_TAG) .
	@if command -v kind >/dev/null 2>&1; then \
		CONTEXT=$$(kubectl config current-context); \
		if echo $$CONTEXT | grep -q "^kind-"; then \
			CLUSTER=$${CONTEXT#kind-}; \
			echo "Loading image to kind cluster: $$CLUSTER"; \
			kind load docker-image $(DOCKER_IMAGE_NAME):$(DOCKER_IMAGE_TAG) --name $$CLUSTER; \
		fi \
	fi

namespace: ## Create namespace if it doesn't exist
	@kubectl get namespace $(NAMESPACE) >/dev/null 2>&1 || \
		kubectl create namespace $(NAMESPACE)

deploy: check namespace ## Deploy all users
	@echo "Deploying all users..."
	@for config in $(USER_CONFIGS_DIR)/*.yaml; do \
		if [ -f "$$config" ]; then \
			user=$$(basename $$config .yaml); \
			release="platform-$$user"; \
			echo "Deploying $$user as release $$release..."; \
			helm upgrade --install $$release $(HELM_CHART) \
				--namespace $(NAMESPACE) \
				--values $$config \
				--set image.repository=$(DOCKER_IMAGE_NAME) \
				--set image.tag=$(DOCKER_IMAGE_TAG) \
				--wait; \
		fi \
	done
	@$(MAKE) list

deploy-user: check namespace ## Deploy specific user (usage: make deploy-user USER=user1)
ifndef USER
	@echo "Error: USER is not set. Usage: make deploy-user USER=user1"
	@exit 1
endif
	@echo "Deploying user: $(USER)"
	@config=$(USER_CONFIGS_DIR)/$(USER).yaml; \
	if [ ! -f "$$config" ]; then \
		echo "Error: Config file not found: $$config"; \
		exit 1; \
	fi; \
	release="platform-$(USER)"; \
	helm upgrade --install $$release $(HELM_CHART) \
		--namespace $(NAMESPACE) \
		--values $$config \
		--set image.repository=$(DOCKER_IMAGE_NAME) \
		--set image.tag=$(DOCKER_IMAGE_TAG) \
		--wait
	@$(MAKE) list

list: ## List all deployments and pods
	@echo "Helm Releases:"
	@helm list -n $(NAMESPACE)
	@echo ""
	@echo "Pods:"
	@kubectl get pods -n $(NAMESPACE)

logs: ## Show logs for specific user (usage: make logs USER=user1)
ifndef USER
	@echo "Error: USER is not set. Usage: make logs USER=user1"
	@exit 1
endif
	@release="platform-$(USER)"; \
	pod=$$(kubectl get pods -n $(NAMESPACE) -l app=$$release -o jsonpath='{.items[0].metadata.name}' 2>/dev/null); \
	if [ -z "$$pod" ]; then \
		echo "Error: No pod found for user: $(USER)"; \
		exit 1; \
	fi; \
	kubectl logs -f -n $(NAMESPACE) $$pod

delete: ## Delete deployment for specific user (usage: make delete USER=user1)
ifndef USER
	@echo "Error: USER is not set. Usage: make delete USER=user1"
	@exit 1
endif
	@echo "Deleting deployment for user: $(USER)"
	@release="platform-$(USER)"; \
	helm uninstall $$release -n $(NAMESPACE)

delete-all: ## Delete all deployments
	@echo "Deleting all deployments in namespace: $(NAMESPACE)"
	@releases=$$(helm list -n $(NAMESPACE) -q); \
	if [ -z "$$releases" ]; then \
		echo "No deployments found"; \
	else \
		for release in $$releases; do \
			echo "Deleting release: $$release"; \
			helm uninstall $$release -n $(NAMESPACE); \
		done; \
	fi

clean: delete-all ## Clean up everything (delete all deployments and namespace)
	@echo "Deleting namespace: $(NAMESPACE)"
	@kubectl delete namespace $(NAMESPACE) --ignore-not-found=true

all: build deploy ## Build and deploy everything

.DEFAULT_GOAL := help
