#!/bin/bash
# Runs once on first boot. Installs everything the server needs.
set -euxo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get upgrade -y
apt-get install -y docker.io docker-compose-v2 nginx certbot python3-certbot-nginx git

# Let the ubuntu user run docker without sudo
usermod -aG docker ubuntu
systemctl enable --now docker nginx

# 2 GiB swap: the server has 2 GiB RAM and runs 6 containers
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# Marker so we can check setup has finished
touch /var/log/setup-done
