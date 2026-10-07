variable "cluster_name" {
  description = "EKS cluster name"
  type        = string
}

variable "kubernetes_version" {
  description = "Kubernetes minor version"
  type        = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  description = "Private subnets for the nodes and the control-plane network interfaces"
  type        = list(string)
}

variable "endpoint_public_access_cidrs" {
  description = "Who may reach the Kubernetes API over the internet"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "node_instance_type" {
  type = string
}

variable "node_min_size" {
  type = number
}

variable "node_max_size" {
  type = number
}

variable "node_desired_size" {
  type = number
}

variable "log_retention_days" {
  description = "Retention for control-plane and Container Insights log groups"
  type        = number
}

variable "enable_container_insights" {
  description = "Install the CloudWatch Observability add-on"
  type        = bool
  default     = true
}

variable "tags" {
  description = "Common tags. Applied to EC2 instances and EBS volumes, which provider default_tags do not reach"
  type        = map(string)
}
