# AWS Region
output "region" {
  description = "AWS region this environment is deployed in"
  value       = var.region
}

# Cluster Name
output "cluster_name" {
  description = "EKS cluster name"
  value       = module.cluster.cluster_name
}

# Cluster Version
output "cluster_version" {
  description = "Kubernetes version running on the control plane"
  value       = module.cluster.cluster_version
}

# VPC ID
output "vpc_id" {
  description = "ID of the VPC holding the cluster, subnets and NAT gateways"
  value       = module.network.vpc_id
}

# Public Subnet IDs
output "public_subnet_ids" {
  description = "Public subnets. Contains the NAT gateways and the internet-facing NLB"
  value       = module.network.public_subnet_ids
}

# Private Subnet IDs
output "private_subnet_ids" {
  description = "Private subnets. Contains the worker nodes and every Pod IP"
  value       = module.network.private_subnet_ids
}

# NAT Public IPs
output "nat_public_ips" {
  description = "Outbound IPs of the NAT gateways"
  value       = module.network.nat_public_ips
}

# SNS Topic
output "sns_topic_arn" {
  description = "SNS topic the CloudWatch alarms publish to. The email subscribers receive the alerts"
  value       = module.monitoring.sns_topic_arn
}

# Configuration for kubectl
output "configure_kubectl" {
  description = "Run this after apply to point kubectl at the cluster"
  value       = "aws eks update-kubeconfig --region ${var.region} --name ${module.cluster.cluster_name}"
}
