output "cluster_name" {
  description = "Cluster name"
  value       = module.eks.cluster_name
}

output "cluster_endpoint" {
  description = "Cluster API address"
  value       = module.eks.cluster_endpoint
}

output "cluster_version" {
  description = "Kubernetes version"
  value       = module.eks.cluster_version
}

output "node_security_group_id" {
  description = "Firewall on the worker nodes"
  value       = module.eks.node_security_group_id
}

output "node_asg_name" {
  description = "Worker nodes Auto Scaling group"
  value       = module.eks.eks_managed_node_groups["default"].node_group_autoscaling_group_names[0]
}