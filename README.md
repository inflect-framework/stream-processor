### Setup Secrets & Configurations

1. Create a `postgres-secret.yaml` file with the following content, replacing `PLACEHOLDER_BASE64_PASSWORD` with the base64-encoded password:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: postgres-secret
type: Opaque
data:
  POSTGRES_PASSWORD: PLACEHOLDER_BASE64_PASSWORD
```

2. Create a `kafka-config.yaml` file with the following content:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: kafka-config
data:
  broker-url: your-kafka-broker-url
  registry-url: your-schema-registry-url
```

3. Create a `kafka-secrets.yaml` file with the following content, replacing `PLACEHOLDER_BASE64_VALUE` with the base64-encoded value:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: kafka-secrets
type: Opaque
data:
  apikey: PLACEHOLDER_BASE64_VALUE
  apisecret: PLACEHOLDER_BASE64_VALUE
  registry-apikey: PLACEHOLDER_BASE64_VALUE
  registry-apisecret: PLACEHOLDER_BASE64_VALUE
```

4. Create a `db-secrets.yaml` file with the following content, replacing `PLACEHOLDER_BASE64_VALUE` with the base64-encoded value:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: db-secrets
type: Opaque
data:
  url: PLACEHOLDER_BASE64_VALUE
```

5. Create a `prometheus-cr.yaml` file with the following content:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: Prometheus
metadata:
  name: prometheus-kube-prometheus-prometheus
  namespace: default
  labels:
    app: kube-prometheus-stack-prometheus
    app.kubernetes.io/instance: prometheus
    app.kubernetes.io/managed-by: Helm
    app.kubernetes.io/part-of: kube-prometheus-stack
    app.kubernetes.io/version: 61.3.1
    chart: kube-prometheus-stack-61.3.1
    heritage: Helm
    release: prometheus
spec:
  alerting:
    alertmanagers:
      - apiVersion: v2
        name: prometheus-kube-prometheus-alertmanager
        namespace: default
        pathPrefix: /
        port: http-web
  automountServiceAccountToken: true
  enableAdminAPI: false
  evaluationInterval: 30s
  externalUrl: http://prometheus-kube-prometheus-prometheus.default:9090
  hostNetwork: false
  image: quay.io/prometheus/prometheus:v2.53.1
  listenLocal: false
  logFormat: logfmt
  logLevel: info
  paused: false
  podMonitorNamespaceSelector: {}
  podMonitorSelector:
    matchLabels:
      release: prometheus
  portName: http-web
  probeNamespaceSelector: {}
  probeSelector:
    matchLabels:
      release: prometheus
  replicas: 1
  retention: 15d
  routePrefix: /
  ruleNamespaceSelector: {}
  ruleSelector:
    matchLabels:
      release: prometheus
  scrapeConfigNamespaceSelector: {}
  scrapeConfigSelector:
    matchLabels:
      release: prometheus
  scrapeInterval: 30s
  securityContext:
    fsGroup: 2000
    runAsGroup: 2000
    runAsNonRoot: true
    runAsUser: 1000
    seccompProfile:
      type: RuntimeDefault
  serviceAccountName: prometheus-kube-prometheus-prometheus
  serviceMonitorNamespaceSelector: {}
  serviceMonitorSelector:
    matchLabels:
      release: prometheus
  shards: 1
  storage:
    volumeClaimTemplate:
      spec:
        accessModes: ['ReadWriteOnce']
        resources:
          requests:
            storage: 50Gi # Adjust this value based on your needs
  tsdb:
    outOfOrderTimeWindow: 0s
  version: v2.53.1
  walCompression: true
```

### Deployment Steps

Run the following shell commands:

```bash
# Apply secrets and config maps
kubectl apply -f postgres-secret.yaml
kubectl apply -f kafka-config.yaml
kubectl apply -f kafka-secrets.yaml
kubectl apply -f db-secrets.yaml

# Deploy PostgreSQL
kubectl apply -f postgres-deployment.yaml

# Deploy service monitor for Prometheus
kubectl apply -f service-monitor-inflect.yaml

# Apply Prometheus configuration
kubectl apply -f prometheus-cr.yaml

# Deploy pipelines
./deploy-pipelines.sh
```

### Additional Notes

- Ensure that the `postgres-deployment.yaml` file exists and is correctly configured.
- The `deploy-pipelines.sh` script should handle the creation of pipeline-specific resources.
- To base64 encode values for secrets, use: `echo -n "your-value" | base64`
- The database URL in `db-secrets.yaml` should use the Kubernetes service name for PostgreSQL (e.g., `postgres://postgres:password@postgres:5432/inflect`), not localhost.
- The `KAFKAJS_NO_PARTITIONER_WARNING` environment variable is set directly in the pipeline deployment YAML and doesn't need to be in a secret.
