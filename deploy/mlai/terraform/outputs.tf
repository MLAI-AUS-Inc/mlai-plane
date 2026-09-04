output "droplet_ipv4" {
  description = "Public SSH address. Plane itself is reachable only through the Cloudflare Tunnel."
  value       = digitalocean_droplet.plane.ipv4_address
}

output "droplet_ipv6" {
  description = "Optional public IPv6 SSH address after verification."
  value       = digitalocean_droplet.plane.ipv6_address
}

output "droplet_private_ipv4" {
  description = "Private VPC address for future MLAI service-to-service traffic."
  value       = digitalocean_droplet.plane.ipv4_address_private
}
output "project_id" {
  description = "Dedicated DigitalOcean project for this Plane environment."
  value       = digitalocean_project.plane.id
}

