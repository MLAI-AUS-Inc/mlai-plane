#!/usr/bin/env python3
"""Reject committed deployment credentials and malformed secret templates."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Iterator


ROOT = Path(__file__).resolve().parents[2]
ENV_TEMPLATE = ROOT / "deploy/mlai/.env.example"

EXPECTED_ENV = {
    "SECRET_KEY": "replace-with-a-random-django-secret",
    "LIVE_SERVER_SECRET_KEY": "replace-with-an-independent-random-secret",
    "POSTGRES_PASSWORD": "replace-with-a-random-postgres-password",
    "RABBITMQ_PASSWORD": "replace-with-a-random-rabbitmq-password",
    "AWS_ACCESS_KEY_ID": "replace-with-a-random-minio-access-key",
    "AWS_SECRET_ACCESS_KEY": "replace-with-a-random-minio-secret-key",
    "CLOUDFLARE_TUNNEL_TOKEN": "replace-with-a-scoped-tunnel-token",
    "PLANE_MIGRATION_APPROVAL": "",
}

EXPECTED_WORKFLOW = {
    Path(".github/workflows/mlai-deploy.yml"): {
        "SECRET_KEY": "${{ secrets.PLANE_SECRET_KEY }}",
        "LIVE_SERVER_SECRET_KEY": "${{ secrets.PLANE_LIVE_SERVER_SECRET_KEY }}",
        "POSTGRES_PASSWORD": "${{ secrets.PLANE_POSTGRES_PASSWORD }}",
        "RABBITMQ_PASSWORD": "${{ secrets.PLANE_RABBITMQ_PASSWORD }}",
        "AWS_ACCESS_KEY_ID": "${{ secrets.PLANE_MINIO_ACCESS_KEY }}",
        "AWS_SECRET_ACCESS_KEY": "${{ secrets.PLANE_MINIO_SECRET_KEY }}",
        "CLOUDFLARE_TUNNEL_TOKEN": "${{ secrets.PLANE_CLOUDFLARE_TUNNEL_TOKEN }}",
    },
    Path(".github/workflows/mlai-infrastructure.yml"): {
        "DIGITALOCEAN_TOKEN": "${{ secrets.DIGITALOCEAN_TOKEN }}",
        "AWS_ACCESS_KEY_ID": "${{ secrets.TF_STATE_ACCESS_KEY_ID }}",
        "AWS_SECRET_ACCESS_KEY": "${{ secrets.TF_STATE_SECRET_ACCESS_KEY }}",
    },
}
EXPECTED_WORKFLOW_COUNTS = {
    Path(".github/workflows/mlai-infrastructure.yml"): 2,
}

SECRET_KEYS = set(EXPECTED_ENV) | {
    key for assignments in EXPECTED_WORKFLOW.values() for key in assignments
}
DOTENV_ASSIGNMENT = re.compile(
    rf"^\s*(?:export\s+)?({'|'.join(sorted(SECRET_KEYS))})=(.*)$"
)
TOKEN_SIGNATURES = (
    re.compile(r"\bdop_v1_[A-Za-z0-9_-]{20,}\b"),
    re.compile(r"\bdoo_v1_[A-Za-z0-9_-]{20,}\b"),
    re.compile(r"\bdor_v1_[A-Za-z0-9_-]{20,}\b"),
    re.compile(r"-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----"),
)


def deployment_sources() -> list[Path]:
    sources = [
        path
        for path in (ROOT / "deploy/mlai").rglob("*")
        if path.is_file()
        and ".terraform" not in path.parts
        and path.name != Path(__file__).name
    ]
    sources.extend((ROOT / ".github/workflows").glob("mlai-*.yml"))
    return sorted(set(sources))


def validate_env_template(errors: list[str]) -> None:
    assignments: dict[str, list[str]] = {key: [] for key in EXPECTED_ENV}
    for line in ENV_TEMPLATE.read_text(encoding="utf-8").splitlines():
        match = DOTENV_ASSIGNMENT.match(line)
        if match and match.group(1) in assignments:
            assignments[match.group(1)].append(match.group(2))

    for key, expected in EXPECTED_ENV.items():
        values = assignments[key]
        if values != [expected]:
            errors.append(
                f"{ENV_TEMPLATE.relative_to(ROOT)}: {key} must occur once with its exact placeholder"
            )


def load_yaml(path: Path) -> Any:
    """Parse YAML with Ruby's standard-library Psych implementation."""
    parser = r'''
require "json"
require "yaml"

document = YAML.safe_load(
  File.read(ARGV.fetch(0)),
  permitted_classes: [Symbol],
  aliases: true,
)
STDOUT.write(JSON.generate(document))
'''
    result = subprocess.run(
        ["ruby", "-e", parser, str(path)],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def values_for_key(node: Any, expected_key: str) -> Iterator[Any]:
    if isinstance(node, dict):
        for key, value in node.items():
            if str(key) == expected_key:
                yield value
            yield from values_for_key(value, expected_key)
    elif isinstance(node, list):
        for value in node:
            yield from values_for_key(value, expected_key)


def validate_yaml_assignments(errors: list[str]) -> None:
    compose_path = Path("deploy/mlai/compose.yml")
    documents = sorted(
        {compose_path}
        | {
            path.relative_to(ROOT)
            for path in (ROOT / ".github/workflows").glob("mlai-*.yml")
        }
    )
    parsed: dict[Path, Any] = {}

    for relative in documents:
        try:
            parsed[relative] = load_yaml(ROOT / relative)
        except (subprocess.CalledProcessError, json.JSONDecodeError) as error:
            errors.append(f"{relative}: cannot parse YAML structurally: {error}")

    if compose_path in parsed:
        for key in EXPECTED_ENV.keys() - {"PLANE_MIGRATION_APPROVAL"}:
            values = list(values_for_key(parsed[compose_path], key))
            if not values:
                continue
            if any(
                not isinstance(value, str) or not value.startswith(f"${{{key}:")
                for value in values
            ):
                errors.append(f"{compose_path}: every {key} value must reference its Compose variable")

    for relative in documents:
        if relative == compose_path or relative not in parsed:
            continue
        expected_assignments = EXPECTED_WORKFLOW.get(relative, {})
        expected_count = EXPECTED_WORKFLOW_COUNTS.get(relative, 1)
        for key in sorted(SECRET_KEYS):
            values = list(values_for_key(parsed[relative], key))
            if key not in expected_assignments:
                if values:
                    errors.append(f"{relative}: unexpected secret assignment for {key}")
                continue
            expected = expected_assignments[key]
            if values != [expected] * expected_count:
                errors.append(
                    f"{relative}: {key} must occur {expected_count} time(s) with its exact GitHub secret"
                )


def validate_source(path: Path, errors: list[str]) -> None:
    relative = path.relative_to(ROOT)
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return

    for signature in TOKEN_SIGNATURES:
        if signature.search(text):
            errors.append(f"{relative}: contains a credential signature")

    for line_number, line in enumerate(text.splitlines(), start=1):
        dotenv_match = DOTENV_ASSIGNMENT.match(line)
        if dotenv_match and path != ENV_TEMPLATE:
            errors.append(
                f"{relative}:{line_number}: secret dotenv assignments are only allowed in .env.example"
            )


def main() -> int:
    errors: list[str] = []
    validate_env_template(errors)
    validate_yaml_assignments(errors)
    for source in deployment_sources():
        validate_source(source, errors)

    if errors:
        print("Deployment credential validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print("Deployment credential templates are safe.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
