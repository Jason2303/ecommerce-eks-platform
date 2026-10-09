variable "region" {
  description = "AWS region for the VPS"
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Project name, used in resource names and tags"
  type        = string
  default     = "atlas"
}

variable "instance_type" {
  description = "EC2 size. t3.small (2 vCPU, 2 GiB) fits the 6 containers with swap"
  type        = string
  default     = "t3.small"
}

variable "vpc_cidr" {
  description = "VPC range. 10.3 so it never overlaps dev (10.0), staging (10.1) or prod (10.2)"
  type        = string
  default     = "10.3.0.0/16"
}

variable "ssh_public_key_path" {
  description = "Public key that is allowed to SSH in as ubuntu"
  type        = string
  default     = "~/.ssh/id_ed25519.pub"
}

variable "domain" {
  description = "Public hostname that points to the Elastic IP"
  type        = string
  default     = "atlasmarket.duckdns.org"
}
