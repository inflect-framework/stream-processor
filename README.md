# Inflect Stream Processor Deployment Guide

This guide outlines the steps to deploy the Inflect Stream Processor on a Kubernetes cluster with Prometheus monitoring.

## Prerequisites

- Kubernetes cluster (e.g., Minikube for local development)
- kubectl configured to interact with your cluster
- Docker (for building images)
- Helm (for Prometheus stack installation)

## Step 1: Install Prometheus Stack

If not already installed:

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
helm install prometheus prometheus-community/kube-prometheus-stack
```

## Step 2: Prepare Configuration Files

### Create kafka-config.yaml

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: kafka-config
data:
  broker-url: your-broker-url
  registry-url: your-registry-url
```

### Create kafka-secrets.yaml

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: kafka-secrets
type: Opaque
stringData:
  apikey: 'your-api-key'
  apisecret: 'your-api-secret'
  registry-apikey: 'your-registry-api-key'
  registry-apisecret: 'your-registry-api-secret'
```

### Create postgres-secret.yaml

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: postgres-secret
type: Opaque
stringData:
  POSTGRES_PASSWORD: 'your-postgres-password'
```

### Create db-secrets.yaml

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: db-secrets
type: Opaque
stringData:
  url: 'postgres://postgres:your-postgres-password@postgres:5432/inflect'
```

## Step 3: Apply Configuration

```bash
kubectl apply -f kafka-config.yaml
kubectl apply -f kafka-secrets.yaml
kubectl apply -f postgres-secret.yaml
kubectl apply -f db-secrets.yaml
```

## Step 4: Deploy PostgreSQL

Ensure your postgres-deployment.yaml is up to date, then apply:

```bash
kubectl apply -f postgres-deployment.yaml
```

## Step 5: Deploy Service Monitor for Prometheus

Create service-monitor-inflect.yaml:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: inflect-monitor
  labels:
    release: prometheus
spec:
  selector:
    matchLabels:
      monitored: 'true'
  endpoints:
    - port: metrics
      interval: 15s # configure to your needs
```

Apply it:

```bash
kubectl apply -f service-monitor-inflect.yaml
```

## Step 6: Deploy Pipelines

Run:

```bash
./deploy-pipelines.sh
```

This script should:

1. Build the Inflect Docker Image
2. Query the database for active pipelines
3. Generate deployment and service YAML files for each pipeline
4. Apply these YAML files to create or update the deployments and services

## Step 7: Verify Deployment

Check the status of your pods:

```bash
kubectl get pods
```

You should see pods for each pipeline, PostgreSQL, and the Prometheus stack components all in a Running state.

## Troubleshooting

- If pods are not starting, check the logs:
  ```bash
  kubectl logs <pod-name>
  ```
- Ensure all secrets and config maps are correctly applied:
  ```bash
  kubectl get secrets
  kubectl get configmaps
  ```
- Verify network policies allow communication between components
- Check Prometheus targets to ensure metrics are being scraped correctly

## Cleanup

To remove the deployment:

```bash
kubectl delete -f <each-yaml-file>
helm uninstall prometheus
```

Replace `<each-yaml-file>` with the names of all the YAML files you applied.

Make sure to replace placeholder values (like "your-actual-api-key") with your actual configuration values before applying the YAML files.

If your configuration files are part of a version-control system repository, verify that your configs containing secrets are properly excluded.
