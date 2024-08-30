#!/bin/bash

source .env

NAMESPACE="inflect"

echo "Cleaning up resources in namespace $NAMESPACE"

echo "Deleting KEDA ScaledObjects"
kubectl delete scaledobjects --all -n $NAMESPACE || true

echo "Deleting KEDA TriggerAuthentications"
kubectl delete triggerauthentications --all -n $NAMESPACE || true

echo "Deleting Deployments"
kubectl delete deployments --all -n $NAMESPACE || true

echo "Deleting Services"
kubectl delete services --all -n $NAMESPACE || true

echo "Deleting PersistentVolumeClaims"
kubectl delete pvc --all -n $NAMESPACE || true

echo "Deleting Secrets"
kubectl delete secrets --all -n $NAMESPACE || true

echo "Deleting ConfigMaps"
kubectl delete configmaps --all -n $NAMESPACE || true

echo "Deleting ServiceMonitors"
kubectl delete servicemonitors --all -n $NAMESPACE || true

echo "Deleting HPAs"
kubectl delete hpa --all -n $NAMESPACE || true

echo "Deleting RoleBindings"
kubectl delete rolebinding partition-scaler-rolebinding -n $NAMESPACE || true

echo "Deleting Roles"
kubectl delete role partition-scaler-role -n $NAMESPACE || true

echo "Deleting ServiceAccounts"
kubectl delete serviceaccount partition-scaler-sa -n $NAMESPACE || true

echo "Uninstalling KEDA"
helm uninstall keda -n keda || true
kubectl delete namespace keda || true

echo "Cleanup completed."