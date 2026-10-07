output "sns_topic_arn" {
  value = aws_sns_topic.alerts.arn
}

output "alarm_names" {
  value = [
    aws_cloudwatch_metric_alarm.node_cpu_high.alarm_name,
    aws_cloudwatch_metric_alarm.node_status_check.alarm_name,
  ]
}
