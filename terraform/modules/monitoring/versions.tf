# Modules declare which providers they need, never how to configure them.
# Region and tags come from the calling environment's provider block.
terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.59"
    }
  }
}
