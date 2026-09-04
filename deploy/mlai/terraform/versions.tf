terraform {
  required_version = "= 1.12.2"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.50"
    }
  }

  backend "s3" {}
}

provider "digitalocean" {}
