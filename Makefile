.PHONY: deploy cleanup

deploy:
	./scripts/deploy-pipelines.sh

cleanup:
	./scripts/cleanup.sh