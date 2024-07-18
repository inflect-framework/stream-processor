#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

# Check for required tools
command -v kubectl >/dev/null 2>&1 || { echo "kubectl is required but not installed. Aborting." >&2; exit 1; }

# Source the environment file
if [ ! -f .env ]; then
    echo ".env file not found. Please create one based on .env.example. Aborting." >&2;
    exit 1;
fi
source .env

# Validate environment variables
[[ -z "$DATABASE_URL" ]] && { echo "DATABASE_URL is not set in .env. Aborting." >&2; exit 1; }
[[ -z "$DUMP_FILE" ]] && { echo "DUMP_FILE is not set in .env. Aborting." >&2; exit 1; }
[[ -z "$APIKEY" ]] && { echo "APIKEY is not set in .env. Aborting." >&2; exit 1; }
[[ -z "$APISECRET" ]] && { echo "APISECRET is not set in .env. Aborting." >&2; exit 1; }
[[ -z "$BROKER" ]] && { echo "BROKER is not set in .env. Aborting." >&2; exit 1; }
[[ -z "$REGISTRY_APIKEY" ]] && { echo "REGISTRY_APIKEY is not set in .env. Aborting." >&2; exit 1; }
[[ -z "$REGISTRY_APISECRET" ]] && { echo "REGISTRY_APISECRET is not set in .env. Aborting." >&2; exit 1; }
[[ -z "$REGISTRY_URL" ]] && { echo "REGISTRY_URL is not set in .env. Aborting." >&2; exit 1; }

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
PG_STORAGE_CLASS="standard"  # adjust as needed
PG_STORAGE_SIZE="5Gi"        # adjust as needed

# Create namespace if it doesn't exist
kubectl create namespace $NAMESPACE --dry-run=client -o yaml | kubectl apply -f -

# Create kafka-secrets
echo "Creating kafka-secrets..."
kubectl create secret generic kafka-secrets -n $NAMESPACE \
  --from-literal=apikey=$APIKEY \
  --from-literal=apisecret=$APISECRET \
  --from-literal=registry-apikey=$REGISTRY_APIKEY \
  --from-literal=registry-apisecret=$REGISTRY_APISECRET \
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
sleep 30

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
  
  # Set default replicas to 3 since pipeline_scaling table doesn't exist
  REPLICAS=3
  
  echo "Number of replicas for pipeline $PIPELINE_ID: $REPLICAS"
  
  # Replace placeholders and create temporary deployment file
  sed "s/{{PIPELINE_ID}}/$PIPELINE_ID/g; s/replicas: 3/replicas: $REPLICAS/g" configs/pipeline-deployment-template.yaml > deployments/pipeline-$PIPELINE_ID-deployment.yaml
  
  echo "Created deployment file for pipeline $PIPELINE_ID"
  
  # Apply the deployment
  kubectl apply -f deployments/pipeline-$PIPELINE_ID-deployment.yaml
  
  # Create and apply service file
  sed "s/{{PIPELINE_ID}}/$PIPELINE_ID/g" configs/templates/service-template.yaml > deployments/pipeline-$PIPELINE_ID-service.yaml
  kubectl apply -f deployments/pipeline-$PIPELINE_ID-service.yaml
  
  # Create and apply servicemonitor file
  sed "s/{{PIPELINE_ID}}/$PIPELINE_ID/g" configs/templates/servicemonitor-template.yaml > deployments/pipeline-$PIPELINE_ID-servicemonitor.yaml
  kubectl apply -f deployments/pipeline-$PIPELINE_ID-servicemonitor.yaml
  
  echo "Deployed pipeline $PIPELINE_ID with $REPLICAS replicas and monitoring"
done

echo "Deployment process completed."
