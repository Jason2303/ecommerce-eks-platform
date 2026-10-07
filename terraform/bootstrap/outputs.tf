# State FIle Bucket name for each environment
output "state_bucket_name" {
  description = "Paste this into the bucket line of every envs/<env>/backend.tf"
  value       = aws_s3_bucket.state.bucket
}
