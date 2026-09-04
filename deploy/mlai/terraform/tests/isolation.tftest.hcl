mock_provider "digitalocean" {}

variables {
  ssh_key_fingerprints = ["test-fingerprint"]
  ssh_source_cidrs     = ["192.0.2.1/32"]
}

run "staging_isolation" {
  command = plan

  assert {
    condition     = digitalocean_project.plane.name == "mlai-plane-staging" && digitalocean_project.plane.environment == "Staging" && !digitalocean_project.plane.is_default
    error_message = "Staging must own a dedicated, non-default project."
  }

  assert {
    condition     = length(digitalocean_firewall.plane.droplet_ids) == 1 && length(coalesce(digitalocean_firewall.plane.tags, toset([]))) == 0
    error_message = "Firewall must attach to one explicit Droplet and never shared tags."
  }

  assert {
    condition     = length(digitalocean_project_resources.plane.resources) == 1
    error_message = "Project assignment must include only the Plane Droplet."
  }
}

run "production_isolation" {
  command = plan

  variables {
    environment    = "production"
    enable_backups = true
  }

  assert {
    condition     = digitalocean_project.plane.name == "mlai-plane-production" && digitalocean_project.plane.environment == "Production" && !digitalocean_project.plane.is_default
    error_message = "Production must own a dedicated, non-default project."
  }

  assert {
    condition     = length(digitalocean_firewall.plane.droplet_ids) == 1 && length(coalesce(digitalocean_firewall.plane.tags, toset([]))) == 0
    error_message = "Production firewall must not attach through tags."
  }
}
