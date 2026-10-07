variable "environment" {
  description = "Environment name."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging or prod."
  }
}

variable "region" {
  description = "AWS region for every resource in this environment"
  type        = string
  default     = "us-east-1"
}

variable "owner" {
  description = "Owner tag applied to every resource"
  type        = string
  default     = "jason"
}

variable "azs" {
  description = "Availability zones. One public and one private subnet is created in each"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

variable "vpc_cidr" {
  description = "VPC CIDR. Different CIDRs per environment so the VPCs never overlap"
  type        = string
}

variable "single_nat_gateway" {
  description = "true = one shared NAT gateway; false = one NAT gateway per AZ"
  type        = bool
}

variable "kubernetes_version" {
  description = "EKS Kubernetes minor version"
  type        = string
  default     = "1.34"
}

variable "endpoint_public_access_cidrs" {
  description = "CIDRs allowed to reach the Kubernetes API over the internet"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "node_instance_type" {
  description = "EC2 instance type for the worker nodes"
  type        = string
  default     = "t3.medium"
}

variable "node_min_size" {
  description = "Minimum number of worker nodes"
  type        = number
}

variable "node_max_size" {
  description = "Maximum number of worker nodes the node group can scale to"
  type        = number
}

variable "node_desired_size" {
  description = "Number of worker nodes at creation time"
  type        = number
}

variable "log_retention_days" {
  description = "CloudWatch retention for control-plane, Container Insights and VPC flow logs"
  type        = number
}

variable "enable_container_insights" {
  description = "Install the CloudWatch Observability add-on for node/Pod metrics and container logs"
  type        = bool
  default     = true
}

variable "cpu_alarm_threshold" {
  description = "Average worker-node CPU percentage that triggers the alarm email"
  type        = number
}

variable "alarm_email" {
  description = "Email for alarm notifications. Set with TF_VAR_alarm_email so the address is not committed to Git"
  type        = string
  default     = ""
}
