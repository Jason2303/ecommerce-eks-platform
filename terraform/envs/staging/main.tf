locals {
  name = "atlas-${var.environment}"

  common_tags = {
    Project     = "atlas-market"
    Environment = var.environment
    Owner       = var.owner
    ManagedBy   = "terraform"
    Repository  = "Jason2303/capstone-ecommerce"
  }
}

module "network" {
  source = "../../modules/network"

  name                    = local.name
  vpc_cidr                = var.vpc_cidr
  azs                     = var.azs
  single_nat_gateway      = var.single_nat_gateway
  flow_log_retention_days = var.log_retention_days
}

module "cluster" {
  source = "../../modules/cluster"

  cluster_name                 = local.name
  kubernetes_version           = var.kubernetes_version
  vpc_id                       = module.network.vpc_id
  subnet_ids                   = module.network.private_subnet_ids
  endpoint_public_access_cidrs = var.endpoint_public_access_cidrs

  node_instance_type = var.node_instance_type
  node_min_size      = var.node_min_size
  node_max_size      = var.node_max_size
  node_desired_size  = var.node_desired_size

  log_retention_days        = var.log_retention_days
  enable_container_insights = var.enable_container_insights
  tags                      = local.common_tags
}

module "monitoring" {
  source = "../../modules/monitoring"

  name          = local.name
  asg_name      = module.cluster.node_asg_name
  alarm_email   = var.alarm_email
  cpu_threshold = var.cpu_alarm_threshold
}
