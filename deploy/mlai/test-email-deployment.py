#!/usr/bin/env python3
"""Exercise the deploy renderer with fake secrets; no services, migrations, or network."""

import os
import json
from pathlib import Path
import subprocess
import tempfile
import textwrap


ROOT = Path(__file__).resolve().parents[2]
source = (ROOT / ".github/workflows/mlai-deploy.yml").read_text()
step = source.split("      - name: Render protected host environment\n", 1)[1].split("      - name:", 1)[0]
script = textwrap.dedent(step.split("        run: |\n", 1)[1])
environment = {"PATH": os.environ["PATH"]}
for key in (
    "PLANE_FRONTEND_IMAGE",
    "PLANE_ADMIN_IMAGE",
    "PLANE_SPACE_IMAGE",
    "PLANE_LIVE_IMAGE",
    "PLANE_BACKEND_IMAGE",
    "PLANE_PROXY_IMAGE",
    "APP_DOMAIN",
    "SECRET_KEY",
    "LIVE_SERVER_SECRET_KEY",
    "POSTGRES_PASSWORD",
    "RABBITMQ_PASSWORD",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "CLOUDFLARE_TUNNEL_TOKEN",
):
    environment[key] = "test-value"
environment.update(
    {
        "EMAIL_BACKEND": "plane.utils.cloudflare_email.EmailBackend",
        "CLOUDFLARE_EMAIL_ACCOUNT_ID": "a" * 32,
        "CLOUDFLARE_EMAIL_API_TOKEN": "test-email-token",
        "CLOUDFLARE_EMAIL_FROM": "no-reply@plane.example.com",
        "PLANE_TEST_EMAIL": "member@example.com",
    }
)

with tempfile.TemporaryDirectory(prefix="plane-email-deploy-") as directory:
    output = Path(directory) / ".env"
    test_script = script.replace("/tmp/mlai-plane.env", str(output))

    def run(overrides=None, cwd=ROOT):
        if output.exists():
            output.unlink()
        result = subprocess.run(
            ["bash", "-c", test_script],
            cwd=cwd,
            env={**environment, **(overrides or {})},
            capture_output=True,
            text=True,
        )
        assert "test-email-token" not in result.stdout + result.stderr
        return result

    result = run()
    assert result.returncode == 0, result.stderr
    rendered = dict(line.split("=", 1) for line in output.read_text().splitlines())
    for key in ("EMAIL_BACKEND", "CLOUDFLARE_EMAIL_ACCOUNT_ID", "CLOUDFLARE_EMAIL_API_TOKEN", "CLOUDFLARE_EMAIL_FROM"):
        assert rendered[key] == environment[key], key
    assert "PLANE_TEST_EMAIL" not in rendered
    assert rendered["PLANE_MIGRATION_APPROVAL"] == ""
    assert output.stat().st_mode & 0o777 == 0o600
    for key, value in (
        ("EMAIL_BACKEND", "not.a.Backend"),
        ("CLOUDFLARE_EMAIL_ACCOUNT_ID", ""),
        ("CLOUDFLARE_EMAIL_API_TOKEN", ""),
        ("CLOUDFLARE_EMAIL_API_TOKEN", "token\nINJECTED=value"),
        ("CLOUDFLARE_EMAIL_FROM", "sender@example.com\nINJECTED=value"),
        ("CLOUDFLARE_EMAIL_FROM", "sender$INJECTED@example.com"),
        ("PLANE_TEST_EMAIL", "test@example.com; touch /tmp/injected"),
    ):
        result = run({key: value})
        assert result.returncode != 0, key
        assert not output.exists(), key
    assert run(cwd=directory).returncode != 0, "Unsupported old release must fail closed"
    result = run(
        {"EMAIL_BACKEND": "django.core.mail.backends.smtp.EmailBackend", "PLANE_TEST_EMAIL": ""}, cwd=directory
    )
    assert result.returncode == 0, result.stderr
    rendered = dict(line.split("=", 1) for line in output.read_text().splitlines())
    assert rendered["CLOUDFLARE_EMAIL_API_TOKEN"] == "", "SMTP rollback must not pass the API token"

    # Exercise the real host command with a fake docker executable and lock utility.
    # Assert that it only execs in the running worker, never starts Compose services.
    bin_dir = Path(directory) / "bin"
    bin_dir.mkdir()
    command_log = Path(directory) / "docker-args.json"
    docker = bin_dir / "docker"
    docker.write_text(
        "#!/usr/bin/env python3\nimport json, os, sys\n"
        "from pathlib import Path\n"
        "Path(os.environ['TEST_COMMAND_LOG']).write_text(json.dumps(sys.argv[1:]))\n"
        "sys.exit(int(os.environ.get('TEST_DOCKER_EXIT', '0')))\n"
    )
    docker.chmod(0o755)
    flock = bin_dir / "flock"
    flock.write_text("#!/bin/sh\nexit 0\n")
    flock.chmod(0o755)
    host_env = {
        **os.environ,
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "PLANE_ENV_FILE": str(output),
        "PLANE_OPERATION_LOCK": str(Path(directory) / "operation.lock"),
        "TEST_COMMAND_LOG": str(command_log),
    }
    host_command = ["bash", str(ROOT / "deploy/mlai/run.sh"), "test-email", "member@example.com"]
    result = subprocess.run(host_command, env=host_env, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    args = json.loads(command_log.read_text())
    assert args[-7:] == ["exec", "-T", "worker", "python", "manage.py", "test_email", "member@example.com"]
    assert not any(action in args for action in ("up", "run", "migrator", "migration", "migrate"))
    result = subprocess.run(host_command, env={**host_env, "TEST_DOCKER_EXIT": "1"}, capture_output=True)
    assert result.returncode == 1, "Rejected test email must fail the workflow"

print("Email environment rendering, fail-closed validation, and SMTP rollback checks passed")
