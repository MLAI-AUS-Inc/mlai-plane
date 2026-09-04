variable "digitalocean_token" {
  description = "Scoped DigitalOcean API token supplied through TF_VAR_digitalocean_token."
  type        = string
  sensitive   = true
}

variable "environment" {
  description = "Plane environment represented by this state."
  type        = string
  default     = "staging"

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "region" {
  description = "DigitalOcean region nearest MLAI staff."
  type        = string
  default     = "syd1"
}

variable "size" {
  description = "Droplet size; Plane recommends 8 GB RAM for reliable self-hosting."
  type        = string
  default     = "s-4vcpu-8gb"
}

variable "ssh_key_fingerprints" {
  description = "Existing DigitalOcean SSH key fingerprints installed on the host."
  type        = list(string)

  validation {
    condition     = length(var.ssh_key_fingerprints) > 0
    error_message = "At least one operator SSH key fingerprint is required."
  }
}

variable "ssh_source_cidrs" {
  description = "CIDRs permitted to reach key-only SSH."
  type        = list(string)

  validation {
    condition     = length(var.ssh_source_cidrs) > 0
    error_message = "At least one SSH source CIDR is required."
  }
}

variable "allow_public_key_only_ssh" {
  description = "Explicit opt-in for public SSH CIDRs used by dynamic GitHub-hosted runners."
  type        = bool
  default     = false
}

variable "enable_backups" {
  description = "Enable DigitalOcean Droplet backups. Production should set this true."
  type        = bool
  default     = false
}

