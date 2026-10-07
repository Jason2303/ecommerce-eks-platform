# VPC, subnets, NAT, flow logs

locals {
  public_subnets  = [for i, az in var.azs : cidrsubnet(var.vpc_cidr, 8, i)]
  private_subnets = [for i, az in var.azs : cidrsubnet(var.vpc_cidr, 4, i + 1)]
}


module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 6.7"

  name = var.name
  cidr = var.vpc_cidr
  azs  = var.azs

  public_subnets       = local.public_subnets
  private_subnets      = local.private_subnets
  public_subnet_names  = [for az in var.azs : "${var.name}-public-${az}"]
  private_subnet_names = [for az in var.azs : "${var.name}-private-${az}"]

  # NAT
  enable_nat_gateway     = true
  single_nat_gateway     = var.single_nat_gateway
  one_nat_gateway_per_az = !var.single_nat_gateway

  # DNS
  enable_dns_support   = true
  enable_dns_hostnames = true

  # Where Kubernetes can put load balancers
  public_subnet_tags = {
    "kubernetes.io/role/elb" = "1"
  }
  private_subnet_tags = {
    "kubernetes.io/role/internal-elb" = "1"
  }

  # Flow logs
  enable_flow_log                                 = true
  create_flow_log_cloudwatch_log_group            = true
  create_flow_log_cloudwatch_iam_role             = true
  flow_log_max_aggregation_interval               = 60
  flow_log_cloudwatch_log_group_retention_in_days = var.flow_log_retention_days
}