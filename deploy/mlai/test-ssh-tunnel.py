"""Exercise the workflow's SSH configuration without network access or secrets."""

import os
from pathlib import Path
import subprocess
import tempfile
import textwrap


workflow = Path(__file__).resolve().parents[2] / ".github/workflows/mlai-deploy.yml"
source = workflow.read_text()
step = source.split("      - name: Configure staging SSH through Cloudflare Access\n", 1)[1]
step = step.split("      - name:", 1)[0]
assert "if: inputs.environment == 'staging'" in step
script = textwrap.dedent(step.split("        run: |\n", 1)[1])
subprocess.run(["bash", "-n"], input=script, text=True, check=True)

with tempfile.TemporaryDirectory(prefix="plane-ssh-test-") as directory:
    config = Path(directory) / "config"
    test_script = script.replace("~/.ssh/config", str(config)).replace(
        'ssh "root@$PLANE_HOST" \'true\'',
        f'ssh -G -F {config} "root@$PLANE_HOST"',
    )
    environment = {
        "PATH": os.environ["PATH"],
        "PLANE_HOST": "192.0.2.1",
        "PLANE_SSH_ACCESS_HOST": "plane-ssh-staging.mlai.au",
        "TUNNEL_SERVICE_TOKEN_ID": "test-id",
        "TUNNEL_SERVICE_TOKEN_SECRET": "test-secret",
    }

    def run(overrides=None):
        return subprocess.run(
            ["bash", "-c", test_script],
            env={**environment, **(overrides or {})},
            capture_output=True,
            text=True,
        )

    result = run()
    assert result.returncode == 0, result.stderr
    for setting in (
        "hostname plane-ssh-staging.mlai.au",
        "hostkeyalias 192.0.2.1",
        "stricthostkeychecking true",
        "batchmode yes",
        "proxycommand /usr/local/bin/cloudflared access ssh --hostname %h",
    ):
        assert setting in result.stdout, setting
    assert "test-secret" not in config.read_text()
    assert config.stat().st_mode & 0o777 == 0o600
    for key, value in (
        ("PLANE_SSH_ACCESS_HOST", "wrong.mlai.au"),
        ("PLANE_HOST", "x\nHost *"),
        ("TUNNEL_SERVICE_TOKEN_ID", ""),
        ("TUNNEL_SERVICE_TOKEN_SECRET", ""),
    ):
        assert run({key: value}).returncode != 0, key

print("SSH tunnel configuration and rejection checks passed")
