#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

if ! command -v docker >/dev/null 2>&1; then
	printf 'docker is required\n' >&2
	exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
	printf 'Docker Compose v2 is required\n' >&2
	exit 1
fi

if ! docker info >/dev/null 2>&1; then
	printf 'Docker is installed but the daemon is not reachable\n' >&2
	exit 1
fi

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
