#!/bin/bash
set -e
set -x

echo "Current user: $(whoami)"
echo "KUBECONFIG: $KUBECONFIG"
echo "Kubectl version: $(kubectl version --client)"
echo "Cluster info: $(kubectl cluster-info)"

echo "Connecting to Minikube Docker environment"
eval $(minikube docker-env)

echo "Building Docker image"
docker build -t inflect:latest .

echo "Verifying image build"
docker images | grep inflect

wait_for_pod() {
  echo "Waiting for pod $1 to be ready..."
  while [[ $(kubectl get pods $1 -o 'jsonpath={..status.conditions[?(@.type=="Ready")].status}') != "True" ]]; do
    echo "Waiting for pod $1 to be ready..."
    sleep 5
  done
  echo "Pod $1 is ready."
}

force_deployment_update() {
  local pipeline_id=$1
  echo "Forcing update for deployment pipeline-$pipeline_id"
  kubectl patch deployment pipeline-$pipeline_id -p \
    "{\"spec\":{\"template\":{\"metadata\":{\"annotations\":{\"kubectl.kubernetes.io/restartedAt\":\"$(date +'%Y-%m-%dT%H:%M:%S%z')\"}}}}}"
}

NAMESPACE=$(kubectl get pods --all-namespaces | grep postgres | awk '{print $1}')
POSTGRES_POD=$(kubectl get pod -n $NAMESPACE -l app=postgres -o jsonpath="{.items[0].metadata.name}")

# Wait for the pod to be ready
wait_for_pod $POSTGRES_POD

# Now execute the SQL command
PIPELINES=$(kubectl exec $POSTGRES_POD -- psql -U postgres -d inflect -t -c "SELECT id FROM pipelines WHERE is_active = true")
if [ -z "$PIPELINES" ]; then
  echo "No active pipelines found."
  exit 0
fi

echo "Active pipelines: $PIPELINES"

for PIPELINE_ID in $PIPELINES
do
  PIPELINE_ID=$(echo $PIPELINE_ID | xargs)
  echo "Processing pipeline $PIPELINE_ID"
  REPLICAS=$(kubectl exec $POSTGRES_POD -- psql -U postgres -d inflect -t -c "SELECT replicas FROM pipeline_scaling WHERE pipeline_id = $PIPELINE_ID" | xargs)
  REPLICAS=${REPLICAS:-3}
  echo "Number of replicas for pipeline $PIPELINE_ID: $REPLICAS"
  sed "s/{PIPELINE_ID}/$PIPELINE_ID/g; s/replicas: 3/replicas: $REPLICAS/g" pipeline-deployment-template.yaml > pipeline-$PIPELINE_ID-deployment.yaml
  echo "Created deployment file for pipeline $PIPELINE_ID"
  kubectl apply -f pipeline-$PIPELINE_ID-deployment.yaml
  force_deployment_update $PIPELINE_ID
  
  echo "Deleting existing pods for pipeline $PIPELINE_ID"
  kubectl delete pods -l app=pipeline-$PIPELINE_ID --force --grace-period=0
  
  echo "Waiting for new pods to be created"
  sleep 10
  
  echo "Checking pod status for pipeline $PIPELINE_ID"
  kubectl get pods -l app=pipeline-$PIPELINE_ID
  echo "Events for pipeline $PIPELINE_ID pods:"
  kubectl describe pod -l app=pipeline-$PIPELINE_ID | sed -n '/Events:/,$p'
  echo "Deployed pipeline $PIPELINE_ID with $REPLICAS replicas"
done

echo "Deployment process completed."