variable "name" {
  description = "Name prefix for every resource, e.g. atlas-dev"
  type        = string
}

variable "vpc_cidr" {
  description = "VPC CIDR block. Must be a /16"
  type        = string

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0)) && endswith(var.vpc_cidr, "/16")
    error_message = "vpc_cidr must be a valid /16, e.g. 10.0.0.0/16."
  }
}

variable "azs" {
  description = "Availability zones. One public and one private subnet is created in each"
  type        = list(string)

  validation {
    condition     = length(var.azs) >= 2
    error_message = "At least two AZs are required for a multi-AZ deployment."
  }
}

variable "single_nat_gateway" {
  description = "true = one shared NAT gateway. false = one NAT gateway per AZ"
  type        = bool
}

variable "flow_log_retention_days" {
  description = "How long VPC flow logs are kept in CloudWatch"
  type        = number
}
