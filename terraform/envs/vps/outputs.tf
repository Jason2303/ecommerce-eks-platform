output "public_ip" {
  description = "Elastic IP. Put this in DuckDNS"
  value       = aws_eip.vps.public_ip
}

output "ssh_command" {
  description = "Log in to the server"
  value       = "ssh ubuntu@${aws_eip.vps.public_ip}"
}

output "url" {
  description = "Public address of the shop"
  value       = "https://${var.domain}"
}
