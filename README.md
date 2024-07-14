### Setup Secrets

Create a `postgres-secret.yaml` file with the following content, replacing `PLACEHOLDER_BASE64_PASSWORD` with the base64-encoded password:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: postgres-secret
type: Opaque
data:
  POSTGRES_PASSWORD: PLACEHOLDER_BASE64_PASSWORD
```
