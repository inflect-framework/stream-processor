#!/bin/bash

set -e

source .env

NAMESPACE="inflect"

echo "Cleaning up resources in namespace $NAMESPACE"

kubectl delete deployments --all -n $NAMESPACE
kubectl delete services --all -n $NAMESPACE
kubectl delete pvc --all -n $NAMESPACE
kubectl delete secrets --all -n $NAMESPACE

echo "Cleanup completed."