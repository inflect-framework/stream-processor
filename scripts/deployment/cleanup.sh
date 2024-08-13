#!/bin/bash

set -e

source .env

NAMESPACE="inflect"

echo "Cleaning up resources in namespace $NAMESPACE"

echo "Deleting KEDA ScaledObjects"
kubectl delete scaledobjects --all -n $NAMESPACE

echo "Deleting KEDA TriggerAuthentications"
kubectl delete triggerauthentications --all -n $NAMESPACE

echo "Deleting Deployments"
kubectl delete deployments --all -n $NAMESPACE

echo "Deleting Services"
kubectl delete services --all -n $NAMESPACE

echo "Deleting PersistentVolumeClaims"
kubectl delete pvc --all -n $NAMESPACE

echo "Deleting Secrets"
kubectl delete secrets --all -n $NAMESPACE

echo "Deleting ConfigMaps"
kubectl delete configmaps --all -n $NAMESPACE

echo "Deleting ServiceMonitors"
kubectl delete servicemonitors --all -n $NAMESPACE

echo "Deleting HPAs"
kubectl delete hpa --all -n $NAMESPACE

echo "Deleting RoleBindings"
kubectl delete rolebinding partition-scaler-rolebinding -n $NAMESPACE

echo "Deleting Roles"
kubectl delete role partition-scaler-role -n $NAMESPACE

echo "Deleting ServiceAccounts"
kubectl delete serviceaccount partition-scaler-sa -n $NAMESPACE

echo "Uninstalling KEDA"
helm uninstall keda -n keda
kubectl delete namespace keda

echo "Cleanup completed."