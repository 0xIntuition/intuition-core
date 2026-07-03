#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

for service in postgres-kg timescale redis; do
	container_id=$(docker compose -f "$ROOT_DIR/docker-compose.datastores.yml" ps -q "$service")
	if [ -z "$container_id" ]; then
		printf '%s is not running\n' "$service" >&2
		exit 1
	fi

	status=$(docker inspect -f '{{.State.Health.Status}}' "$container_id")
	if [ "$status" != "healthy" ]; then
		printf '%s is %s\n' "$service" "$status" >&2
		exit 1
	fi
done
