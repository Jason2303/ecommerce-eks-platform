# AWS Provider
provider "aws" {
  region = var.region

  default_tags {
    tags = local.common_tags
  }
}
