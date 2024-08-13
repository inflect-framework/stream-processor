.PHONY: deploy cleanup

deploy:
	./scripts/deployment/deploy-pipelines.sh

cleanup:
	./scripts/deployment/cleanup.sh