# EKS cluster, worker nodes, add-ons and their IAM roles

# IAM role: EBS driver (creates disks for Postgres DB)
module "ebs_csi_pod_identity" {
  source  = "terraform-aws-modules/eks-pod-identity/aws"
  version = "~> 2.9"

  name                      = "${var.cluster_name}-ebs-csi"
  attach_aws_ebs_csi_policy = true
}

# IAM role: CloudWatch agent (sends metrics and logs)
module "cloudwatch_pod_identity" {
  source  = "terraform-aws-modules/eks-pod-identity/aws"
  version = "~> 2.9"
  count   = var.enable_container_insights ? 1 : 0

  name                                       = "${var.cluster_name}-cloudwatch"
  attach_aws_cloudwatch_observability_policy = true
}

# EKS cluster + worker nodes
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 21.26"

  name               = var.cluster_name
  kubernetes_version = var.kubernetes_version

  vpc_id     = var.vpc_id
  subnet_ids = var.subnet_ids

  # API reachable from laptop and VPC
  endpoint_public_access       = true
  endpoint_private_access      = true
  endpoint_public_access_cidrs = var.endpoint_public_access_cidrs

  # Cluster admin
  enable_cluster_creator_admin_permissions = true

  # Control-plane logs
  enabled_log_types                      = ["api", "audit", "authenticator"]
  cloudwatch_log_group_retention_in_days = var.log_retention_days

  # Secrets encryption key
  kms_key_deletion_window_in_days = 7

  addons = {
    # Networking + NetworkPolicy enforcement
    vpc-cni = {
      before_compute = true
      configuration_values = jsonencode({
        enableNetworkPolicy = "true"
      })
    }

    # Gives add-ons their IAM roles
    eks-pod-identity-agent = {
      before_compute = true
    }

    kube-proxy = {}
    coredns    = {}

    # Creates EBS disks, tagged
    aws-ebs-csi-driver = {
      pod_identity_association = [{
        role_arn        = module.ebs_csi_pod_identity.iam_role_arn
        service_account = "ebs-csi-controller-sa"
      }]
      configuration_values = jsonencode({
        controller = {
          extraVolumeTags = var.tags
        }
      })
    }

    # Metrics for HPA
    metrics-server = {}
  }

  eks_managed_node_groups = {
    default = {
      ami_type       = "AL2023_x86_64_STANDARD"
      instance_types = [var.node_instance_type]

      min_size     = var.node_min_size
      max_size     = var.node_max_size
      desired_size = var.node_desired_size

      # Tags the EC2 instances
      launch_template_tags = var.tags
    }
  }
}

# Container Insights log groups 
resource "aws_cloudwatch_log_group" "container_insights" {
  for_each = var.enable_container_insights ? toset(["application", "dataplane", "host", "performance"]) : toset([])

  name              = "/aws/containerinsights/${var.cluster_name}/${each.key}"
  retention_in_days = var.log_retention_days
}

# CloudWatch add-on
resource "aws_eks_addon" "cloudwatch_observability" {
  count = var.enable_container_insights ? 1 : 0

  cluster_name = module.eks.cluster_name
  addon_name   = "amazon-cloudwatch-observability"
  configuration_values = jsonencode({
    manager = {
      applicationSignals = {
        autoMonitor = {
          monitorAllServices = false
        }
      }
    }
  })

  pod_identity_association {
    role_arn        = module.cloudwatch_pod_identity[0].iam_role_arn
    service_account = "cloudwatch-agent"
  }

  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"

  depends_on = [
    module.eks,
    aws_cloudwatch_log_group.container_insights,
  ]
}