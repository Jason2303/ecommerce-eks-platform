locals {
  name = "${var.project}-vps"

  common_tags = {
    Project     = var.project
    Environment = "vps"
    ManagedBy   = "terraform"
  }
}

# Your current public IP, so only you can SSH in
data "http" "my_ip" {
  url = "https://checkip.amazonaws.com"
}

# Latest Ubuntu 24.04 image, published by Canonical
data "aws_ssm_parameter" "ubuntu" {
  name = "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
}

data "aws_availability_zones" "available" {
  state = "available"
}

# Network: one public subnet, no NAT (the server has its own public IP)
resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = local.name }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = local.name }
}

resource "aws_subnet" "public" {
  vpc_id            = aws_vpc.this.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, 1)
  availability_zone = data.aws_availability_zones.available.names[0]
  tags              = { Name = "${local.name}-public" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }

  tags = { Name = "${local.name}-public" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# Firewall: SSH from your IP only, web open to everyone
resource "aws_security_group" "vps" {
  name        = local.name
  description = "Atlas Market VPS"
  vpc_id      = aws_vpc.this.id

  ingress {
    description = "SSH from my IP"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["${chomp(data.http.my_ip.response_body)}/32"]
  }

  ingress {
    description = "HTTP (certbot check + redirect to HTTPS)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "All outbound (packages, Docker Hub, Lets Encrypt)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = local.name }
}

resource "aws_key_pair" "this" {
  key_name   = local.name
  public_key = file(pathexpand(var.ssh_public_key_path))
}

# The VPS
resource "aws_instance" "vps" {
  ami                    = data.aws_ssm_parameter.ubuntu.value
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.vps.id]
  key_name               = aws_key_pair.this.key_name
  # Strip Windows line endings, or bash on the server fails to run it
  user_data = replace(file("${path.module}/user-data.sh"), "\r\n", "\n")

  # IMDSv2 only
  metadata_options {
    http_tokens = "required"
  }

  root_block_device {
    volume_type = "gp3"
    volume_size = 20
    encrypted   = true
  }

  # Don't rebuild the server when Canonical publishes a newer image
  lifecycle {
    ignore_changes = [ami]
  }

  tags = { Name = local.name }
}

# Fixed public IP, so DNS keeps working after a stop/start
resource "aws_eip" "vps" {
  instance = aws_instance.vps.id
  domain   = "vpc"
  tags     = { Name = local.name }

  depends_on = [aws_internet_gateway.this]
}
