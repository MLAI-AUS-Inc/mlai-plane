locals {
  name = "mlai-plane-${var.environment}"
  tags = [local.name, "mlai-plane"]
}

resource "digitalocean_project" "plane" {
  name        = local.name
  description = "MLAI Plane ${var.environment} resources managed by mlai-plane Terraform."
  purpose     = "Web Application"
  environment = var.environment == "production" ? "Production" : "Staging"
  is_default  = false

  lifecycle {
    prevent_destroy = true
  }
}

resource "digitalocean_project_resources" "plane" {
  project   = digitalocean_project.plane.id
  resources = [digitalocean_droplet.plane.urn]
}

resource "digitalocean_droplet" "plane" {
  name       = "${local.name}-01"
  image      = "ubuntu-24-04-x64"
  region     = var.region
  size       = var.size
  monitoring = true
  ipv6       = true
  backups    = var.enable_backups
  ssh_keys   = var.ssh_key_fingerprints
  user_data  = file("${path.module}/cloud-init.yml")
  tags       = local.tags

  lifecycle {
    prevent_destroy = true

    precondition {
      condition = var.allow_public_key_only_ssh || alltrue([
        for cidr in var.ssh_source_cidrs : !contains(["0.0.0.0/0", "::/0"], cidr)
      ])
      error_message = "Public SSH CIDRs require allow_public_key_only_ssh=true and key-only cloud-init."
    }

    precondition {
      condition     = var.environment != "production" || var.enable_backups
      error_message = "Production requires DigitalOcean Droplet backups."
    }
  }
}

resource "digitalocean_firewall" "plane" {
  name        = local.name
  droplet_ids = [digitalocean_droplet.plane.id]

  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = var.ssh_source_cidrs
  }

  # Plane has no public origin port. cloudflared reaches Cloudflare over these
  # outbound rules and proxies to the Compose network internally.
  outbound_rule {
    protocol              = "tcp"
    port_range            = "all"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "udp"
    port_range            = "all"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "icmp"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}
