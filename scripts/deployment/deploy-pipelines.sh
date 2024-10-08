#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

echo
echo -e "\033[1;34m╔═════════════════════════════════════════════════════════════════╗\033[0m"
echo -e "\033[1;34m║\033[0m                                                      \033[1;32m__________\033[0m \033[1;34m║\033[0m"
echo -e "\033[1;34m║\033[0m   \033[1;32m_____          __  _              _               \033[1;32m/         /\033[0m \033[1;34m║\033[0m"
echo -e "\033[1;34m║\033[0m   \033[1;32m\\_   \\ _ __   / _|| |  ___   ___ | |_        \033[1;32m____/         /\033[0m  \033[1;34m║\033[0m"
echo -e "\033[1;34m║\033[0m    \033[1;32m/ /\\/| '_ \\ | |_ | | / _ \\ / __|| __|      \033[1;32m/         /\\  /\033[0m   \033[1;34m║\033[0m"
echo -e "\033[1;34m║\033[0m \033[1;32m/\\/ /_  | | | ||  _|| ||  __/| (__ | |_      \033[1;32m/         /__\\/\033[0m    \033[1;34m║\033[0m"
echo -e "\033[1;34m║\033[0m \033[1;32m\\____/  |_| |_||_|  |_| \\___| \\___| \\__|    \033[1;32m/         /\033[0m         \033[1;34m║\033[0m"
echo -e "\033[1;34m║\033[0m                                            \033[1;32m/_________/\033[0m          \033[1;34m║\033[0m"
echo -e "\033[1;34m║\033[0m                                                                 \033[1;34m║\033[0m"
echo -e "\033[1;34m╚═════════════════════════════════════════════════════════════════╝\033[0m"
echo
echo -e "\033[1mWelcome to Inflect!\033[0m"
echo -e "\033[1mThis script will guide you through the deployment process.\033[0m"
echo -e "\n\033[1;32mFirst, specify your Kafka broker information:\033[0m"
echo

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check if a Kubernetes resource exists
resource_exists() {
    kubectl get "$1" "$2" -n "$3" >/dev/null 2>&1
}

# Check for required tools
command_exists kubectl || { echo "kubectl is required but not installed. Aborting." >&2; exit 1; }
command_exists docker || { echo "docker is required but not installed. Aborting." >&2; exit 1; }
command_exists minikube || { echo "minikube is required but not installed. Aborting." >&2; exit 1; }
command_exists helm || { echo "helm is required but not installed. Aborting." >&2; exit 1; }

# Source the environment file
if [ ! -f .env ]; then
    echo ".env file not found. Please create one based on .env.example. Aborting." >&2;
    exit 1;
fi
source .env

# Function to prompt for new values or use defaults
prompt_for_value() {
    local var_name=$1
    local current_value=${!var_name}
    local prompt_text=$2
    
    read -p "$prompt_text (current: $current_value, press Enter to keep current value): " new_value
    if [ -n "$new_value" ]; then
        eval "$var_name=\"$new_value\""
    fi
}

# Prompt for new values or use defaults
prompt_for_value APIKEY "Enter Kafka API Key"
prompt_for_value APISECRET "Enter Kafka API Secret"
prompt_for_value BROKER "Enter Kafka Broker URL"
prompt_for_value REGISTRY_APIKEY "Enter Registry API Key"
prompt_for_value REGISTRY_APISECRET "Enter Registry API Secret"
prompt_for_value REGISTRY_URL "Enter Registry URL"

# Validate environment variables
[[ -z "$DATABASE_URL" ]] && { echo "DATABASE_URL is not set in .env. Aborting." >&2; exit 1; }
[[ -z "$DUMP_FILE" ]] && { echo "DUMP_FILE is not set in .env. Aborting." >&2; exit 1; }
[[ -z "$APIKEY" ]] && { echo "APIKEY is not set. Aborting." >&2; exit 1; }
[[ -z "$APISECRET" ]] && { echo "APISECRET is not set. Aborting." >&2; exit 1; }
[[ -z "$BROKER" ]] && { echo "BROKER is not set. Aborting." >&2; exit 1; }
[[ -z "$REGISTRY_APIKEY" ]] && { echo "REGISTRY_APIKEY is not set. Aborting." >&2; exit 1; }
[[ -z "$REGISTRY_APISECRET" ]] && { echo "REGISTRY_APISECRET is not set. Aborting." >&2; exit 1; }
[[ -z "$REGISTRY_URL" ]] && { echo "REGISTRY_URL is not set. Aborting." >&2; exit 1; }

# Check Minikube status
# minikube status || minikube start

# Configure Docker to use Minikube's Docker daemon
eval $(minikube docker-env)

# Build the Docker image
echo "Building Docker image..."
docker build -t inflect:latest .


eval $(minikube docker-env)

# Build the partition-scaler Docker image
echo "Building partition-scaler Docker image..."
docker build -t partition-scaler:latest -f partition-scaler/Dockerfile .

# Check Kubernetes context
echo "Current Kubernetes context: $(kubectl config current-context)"
read -p "Is this the correct context? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Please set the correct Kubernetes context and try again. Aborting." >&2
    exit 1
fi

# Extract database information from DATABASE_URL
DB_URL_REGEX='postgres://([^:]+):([^@]+)@([^:]+):([^/]+)/(.+)'
if [[ $DATABASE_URL =~ $DB_URL_REGEX ]]; then
    DB_USER="${BASH_REMATCH[1]}"
    DB_PASSWORD="${BASH_REMATCH[2]}"
    DB_HOST="${BASH_REMATCH[3]}"
    DB_PORT="${BASH_REMATCH[4]}"
    DB_NAME="${BASH_REMATCH[5]}"
else
    echo "Error: Unable to parse DATABASE_URL"
    exit 1
fi

# Script variables
NAMESPACE="inflect"
PG_DEPLOYMENT_NAME="inflect-postgres"
PG_SERVICE_NAME="inflect-postgres-service"
PG_SECRET_NAME="inflect-postgres-secrets"
PG_STORAGE_CLASS="standard"
PG_STORAGE_SIZE="5Gi"

deploy_prometheus() {
    echo "Deploying Prometheus..."
    
    # Clean up existing Prometheus resources
    kubectl delete clusterrole --selector=app.kubernetes.io/name=prometheus-operator --ignore-not-found
    kubectl delete clusterrolebinding --selector=app.kubernetes.io/name=prometheus-operator --ignore-not-found
    kubectl delete crd --selector=app.kubernetes.io/name=prometheus-operator --ignore-not-found

    # Delete any remaining CRDs manually
    kubectl delete crd alertmanagerconfigs.monitoring.coreos.com --ignore-not-found
    kubectl delete crd alertmanagers.monitoring.coreos.com --ignore-not-found
    kubectl delete crd podmonitors.monitoring.coreos.com --ignore-not-found
    kubectl delete crd probes.monitoring.coreos.com --ignore-not-found
    kubectl delete crd prometheuses.monitoring.coreos.com --ignore-not-found
    kubectl delete crd prometheusrules.monitoring.coreos.com --ignore-not-found
    kubectl delete crd servicemonitors.monitoring.coreos.com --ignore-not-found
    kubectl delete crd thanosrulers.monitoring.coreos.com --ignore-not-found

    # Add Prometheus Helm repo
    helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
    helm repo update

    # Uninstall existing Prometheus installation if it exists
    helm uninstall prometheus -n $NAMESPACE --ignore-not-found

    # Wait for resources to be fully removed
    echo "Waiting for Prometheus resources to be fully removed..."
    sleep 15

    # Create a values file for Prometheus configuration
    cat <<EOF > prometheus-values.yaml
prometheus:
  prometheusSpec:
    serviceMonitorSelectorNilUsesHelmValues: false
    serviceMonitorSelector:
      matchLabels:
        release: prometheus
    serviceMonitorNamespaceSelector:
      matchNames:
        - $NAMESPACE
    resources:
      requests:
        cpu: 500m
        memory: 2Gi
      limits:
        cpu: 1
        memory: 4Gi
    storageSpec:
      volumeClaimTemplate:
        spec:
          accessModes: ["ReadWriteOnce"]
          resources:
            requests:
              storage: 10Gi
    additionalScrapeConfigs:
      - job_name: 'pipeline-metrics'
        kubernetes_sd_configs:
          - role: service
            namespaces:
              names:
                - $NAMESPACE
        relabel_configs:
          - source_labels: [__meta_kubernetes_service_label_app]
            regex: pipeline-.*
            action: keep
          - source_labels: [__meta_kubernetes_service_port_name]
            regex: metrics
            action: keep
          - source_labels: [__meta_kubernetes_service_label_app]
            target_label: pipeline_id
            regex: pipeline-(.*)
            replacement: \$1
grafana:
  namespaceOverride: $NAMESPACE
prometheusOperator:
  namespaceOverride: $NAMESPACE
  resources:
    requests:
      cpu: 100m
      memory: 50Mi
    limits:
      cpu: 200m
      memory: 100Mi
alertmanager:
  namespaceOverride: $NAMESPACE
global:
  rbac:
    createAggregateClusterRoles: false
EOF

    # Install Prometheus with the new configuration
    helm install prometheus prometheus-community/kube-prometheus-stack \
        --namespace $NAMESPACE \
        --create-namespace \
        -f prometheus-values.yaml

    echo "Prometheus deployed successfully."

    # Clean up the temporary values file
    rm prometheus-values.yaml
}

# Function to install KEDA
install_or_upgrade_keda() {
    echo "Checking KEDA installation..."
    if kubectl get namespace keda >/dev/null 2>&1; then
        echo "KEDA is already installed. Upgrading..."
        helm repo add kedacore https://kedacore.github.io/charts
        helm repo update
        helm upgrade keda kedacore/keda --namespace keda
    else
        echo "Installing KEDA..."
        helm repo add kedacore https://kedacore.github.io/charts
        helm repo update
        helm install keda kedacore/keda --namespace keda --create-namespace
    fi
}

# Create namespace if it doesn't exist
kubectl create namespace $NAMESPACE --dry-run=client -o yaml | kubectl apply -f -

echo "Creating kafka-secrets..."
kubectl create secret generic kafka-secrets -n $NAMESPACE \
  --from-literal=apikey=$APIKEY \
  --from-literal=apisecret=$APISECRET \
  --from-literal=registry-apikey=$REGISTRY_APIKEY \
  --from-literal=registry-apisecret=$REGISTRY_APISECRET \
  --from-literal=sasl="plaintext" \
  --from-literal=tls="enable" \
  --from-literal=sasl-jaas-config="org.apache.kafka.common.security.plain.PlainLoginModule required username=\"$APIKEY\" password=\"$APISECRET\";" \
  --dry-run=client -o yaml | kubectl apply -f -


# Create kafka-config
echo "Creating kafka-config..."
kubectl create configmap kafka-config -n $NAMESPACE \
  --from-literal=broker-url=$BROKER \
  --from-literal=registry-url=$REGISTRY_URL \
  --dry-run=client -o yaml | kubectl apply -f -

# Create PostgreSQL Secret
kubectl create secret generic $PG_SECRET_NAME \
    --from-literal=POSTGRES_DB=$DB_NAME \
    --from-literal=POSTGRES_USER=$DB_USER \
    --from-literal=POSTGRES_PASSWORD=$DB_PASSWORD \
    -n $NAMESPACE \
    --dry-run=client -o yaml | kubectl apply -f -

# Create PostgreSQL PersistentVolumeClaim
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-pvc
  namespace: $NAMESPACE
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: $PG_STORAGE_CLASS
  resources:
    requests:
      storage: $PG_STORAGE_SIZE
EOF

# Create PostgreSQL Deployment
cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: $PG_DEPLOYMENT_NAME
  namespace: $NAMESPACE
spec:
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
        - name: postgres
          image: postgres:13
          ports:
            - containerPort: 5432
          envFrom:
            - secretRef:
                name: $PG_SECRET_NAME
          volumeMounts:
            - name: postgres-storage
              mountPath: /var/lib/postgresql/data
      volumes:
        - name: postgres-storage
          persistentVolumeClaim:
            claimName: postgres-pvc
EOF

# Create PostgreSQL Service
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Service
metadata:
  name: $PG_SERVICE_NAME
  namespace: $NAMESPACE
spec:
  selector:
    app: postgres
  ports:
    - protocol: TCP
      port: 5432
      targetPort: 5432
EOF

echo "Waiting for PostgreSQL pod to be ready..."
kubectl wait --for=condition=ready pod -l app=postgres -n $NAMESPACE --timeout=300s

echo "Waiting for PostgreSQL to be fully operational..."
sleep 15

# Get the pod name
PG_POD=$(kubectl get pods -n $NAMESPACE -l app=postgres -o jsonpath="{.items[0].metadata.name}")

# Copy the dump file to the pod
kubectl cp sql/inflect_prototype_3.sql $NAMESPACE/$PG_POD:/tmp/dump.sql

# Create the database if it doesn't exist, ignoring the error if it already exists
kubectl exec -n $NAMESPACE $PG_POD -- bash -c "PGPASSWORD=$DB_PASSWORD psql -U $DB_USER -c 'CREATE DATABASE $DB_NAME;'" || true

# Restore the dump
echo "Restoring the database dump..."
kubectl exec -n $NAMESPACE $PG_POD -- bash -c "PGPASSWORD=$DB_PASSWORD psql -U $DB_USER -d $DB_NAME < /tmp/dump.sql"

echo "PostgreSQL deployed and initialized with the provided dump."

# Deploy Prometheus
deploy_prometheus

# Install KEDA
# install_or_upgrade_keda

# Now proceed with pipeline deployment
PIPELINES=$(kubectl exec -n $NAMESPACE $PG_POD -- psql -U $DB_USER -d $DB_NAME -t -c "SELECT id FROM pipelines WHERE is_active = true")

if [ -z "$PIPELINES" ]; then
    echo "No active pipelines found."
    exit 0
fi

echo "Active pipelines: $PIPELINES"

for PIPELINE_ID in $PIPELINES
do
  PIPELINE_ID=$(echo $PIPELINE_ID | xargs)
  
  echo "Processing pipeline $PIPELINE_ID"
  
  # Replace placeholders in the deployment template
  sed "s/{{PIPELINE_ID}}/$PIPELINE_ID/g" configs/pipeline-deployment-template.yaml > deployments/pipeline-$PIPELINE_ID-deployment.yaml
  
  echo "Created deployment file for pipeline $PIPELINE_ID"
  
  # Apply the deployment
  kubectl apply -f deployments/pipeline-$PIPELINE_ID-deployment.yaml
  
  # Create and apply service file
  sed "s/{{PIPELINE_ID}}/$PIPELINE_ID/g" configs/templates/service-template.yaml > deployments/pipeline-$PIPELINE_ID-service.yaml
  kubectl apply -f deployments/pipeline-$PIPELINE_ID-service.yaml
  
  # Create and apply servicemonitor file
  sed "s/{{PIPELINE_ID}}/$PIPELINE_ID/g" configs/templates/servicemonitor-template.yaml > deployments/pipeline-$PIPELINE_ID-servicemonitor.yaml
  kubectl apply -f deployments/pipeline-$PIPELINE_ID-servicemonitor.yaml
  
# Query the database for the source topic name
SOURCE_TOPIC=$(kubectl exec -n $NAMESPACE $PG_POD -- psql -U $DB_USER -d $DB_NAME -t -c "SELECT t.topic_name FROM pipelines p JOIN topics t ON p.source_topic_id = t.id WHERE p.id = $PIPELINE_ID")
SOURCE_TOPIC=$(echo $SOURCE_TOPIC | xargs)  # Trim whitespace

# If SOURCE_TOPIC is empty, use a default value or exit with an error
if [ -z "$SOURCE_TOPIC" ]; then
    echo "Error: No source topic found for pipeline $PIPELINE_ID"
    exit 1
fi

  # Apply ScaledObject
  # sed "s/{{PIPELINE_ID}}/$PIPELINE_ID/g" configs/templates/scaledobject-template.yaml > deployments/pipeline-$PIPELINE_ID-scaledobject.yaml
  # kubectl apply -f deployments/pipeline-$PIPELINE_ID-scaledobject.yaml
  
  # Apply TriggerAuthentication
  # sed "s/{{PIPELINE_ID}}/$PIPELINE_ID/g" configs/templates/triggerauthentication-template.yaml > deployments/pipeline-$PIPELINE_ID-triggerauth.yaml
  # kubectl apply -f deployments/pipeline-$PIPELINE_ID-triggerauth.yaml

echo "Deployed pipeline $PIPELINE_ID with KEDA autoscaling using source topic: $SOURCE_TOPIC"
done

echo "Updating kafka-secrets..."
kubectl create secret generic kafka-scripts -n $NAMESPACE \
  --from-literal=apikey=$APIKEY \
  --from-literal=apisecret=$APISECRET \
  --from-literal=registry-apikey=$REGISTRY_APIKEY \
  --from-literal=registry-apisecret=$REGISTRY_APISECRET \
  --from-literal=sasl="plaintext" \
  --from-literal=tls="enable" \
  --from-literal=sasl-jaas-config="org.apache.kafka.common.security.plain.PlainLoginModule required username=\"$APIKEY\" password=\"$APISECRET\";" \
  --from-literal=bootstrap-servers="$BROKER" \
  --dry-run=client -o yaml | kubectl apply -f -

# Create ServiceAccount for partition-scaler
# kubectl create serviceaccount partition-scaler-sa -n $NAMESPACE --dry-run=client -o yaml | kubectl apply -f -

# Create Role for partition-scaler
# cat <<EOF | kubectl apply -f -
# apiVersion: rbac.authorization.k8s.io/v1
# kind: Role
# metadata:
#   namespace: $NAMESPACE
#   name: partition-scaler-role
# rules:
# - apiGroups: ["apps"]
#   resources: ["deployments"]
#   verbs: ["get", "list", "watch"]
# - apiGroups: [""]
#   resources: ["pods"]
#   verbs: ["get", "list", "watch"]
# EOF

# Create RoleBinding for partition-scaler
# kubectl create rolebinding partition-scaler-rolebinding \
#   --role=partition-scaler-role \
#   --serviceaccount=$NAMESPACE:partition-scaler-sa \
#   -n $NAMESPACE \
#   --dry-run=client -o yaml | kubectl apply -f -

# Deploy partition-scaler
# echo "Deploying partition-scaler..."
# cat <<EOF | kubectl apply -f -
# apiVersion: apps/v1
# kind: Deployment
# metadata:
#   name: partition-scaler
#   namespace: $NAMESPACE
# spec:
#   replicas: 1
#   selector:
#     matchLabels:
#       app: partition-scaler
#   template:
#     metadata:
#       labels:
#         app: partition-scaler
#     spec:
#       serviceAccountName: partition-scaler-sa
#       containers:
#       - name: partition-scaler
#         image: partition-scaler:latest
#         imagePullPolicy: Never
#         env:
#         - name: KAFKA_BOOTSTRAP_SERVERS
#           value: "$BROKER"
#         - name: KAFKA_SASL_USERNAME
#           valueFrom:
#             secretKeyRef:
#               name: kafka-secrets
#               key: apikey
#         - name: KAFKA_SASL_PASSWORD
#           valueFrom:
#             secretKeyRef:
#               name: kafka-secrets
#               key: apisecret
#         - name: NAMESPACE
#           valueFrom:
#             fieldRef:
#               fieldPath: metadata.namespace
# EOF

# Wait for partition-scaler deployment to be ready
# echo "Waiting for partition-scaler deployment to be ready..."
# kubectl rollout status deployment/partition-scaler -n $NAMESPACE

# echo "Partition-scaler deployed successfully."

kubectl delete deployment pipeline-11 -n inflect
kubectl delete deployment pipeline-12 -n inflect

echo "Deployment process completed."