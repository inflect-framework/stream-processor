#!/bin/bash
set -e
set -x

PIPELINES=$(kubectl exec postgres-7cc9464979-pz67r -- psql -U postgres -d inflect -t -c "SELECT id FROM pipelines WHERE is_active = true")

if [ -z "$PIPELINES" ]; then
    echo "No active pipelines found."
    exit 0
fi

echo "Active pipelines: $PIPELINES"

for PIPELINE_ID in $PIPELINES
do
  PIPELINE_ID=$(echo $PIPELINE_ID | xargs)
  
  echo "Processing pipeline $PIPELINE_ID"
  
  REPLICAS=$(kubectl exec postgres-7cc9464979-pz67r -- psql -U postgres -d inflect -t -c "SELECT replicas FROM pipeline_scaling WHERE pipeline_id = $PIPELINE_ID" | xargs)
  REPLICAS=${REPLICAS:-3}
  
  echo "Number of replicas for pipeline $PIPELINE_ID: $REPLICAS"
  
  sed "s/{PIPELINE_ID}/$PIPELINE_ID/g; s/replicas: 3/replicas: $REPLICAS/g" pipeline-deployment-template.yaml > pipeline-$PIPELINE_ID-deployment.yaml
  
  echo "Created deployment file for pipeline $PIPELINE_ID"
  
  kubectl apply -f pipeline-$PIPELINE_ID-deployment.yaml
  
  echo "Deployed pipeline $PIPELINE_ID with $REPLICAS replicas"
done

echo "Deployment process completed."