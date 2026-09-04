terraform {
  required_version = ">= 1.8.0"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.50"
    }
  }

  backend "s3" {}
}

provider "digitalocean" {
  token = var.digitalocean_token
}

