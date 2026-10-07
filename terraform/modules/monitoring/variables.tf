variable "name" {
  description = "Name prefix"
  type        = string
}

variable "asg_name" {
  description = "Auto Scaling group of the EKS node group"
  type        = string
}

variable "alarm_email" {
  description = "Where alarm emails go"
  type        = string
  default     = ""
}

variable "cpu_threshold" {
  description = "Average node CPU percentage that triggers the alarm"
  type        = number

  validation {
    condition     = var.cpu_threshold > 0 && var.cpu_threshold <= 100
    error_message = "cpu_threshold must be between 1 and 100."
  }
}
