terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.59"
    }
    http = {
      source  = "hashicorp/http"
      version = "~> 3.5"
    }
  }

  # Same bucket as the other envs (from backend.hcl), own state key
  backend "s3" {
    key          = "vps/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = local.common_tags
  }
}
