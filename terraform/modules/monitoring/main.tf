# Email alerts + alarms on the worker nodes

# Topic the alarms send to
resource "aws_sns_topic" "alerts" {
  name = "${var.name}-alerts"
}

# Your email 
resource "aws_sns_topic_subscription" "email" {
  count = var.alarm_email == "" ? 0 : 1

  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

# Alarm: node CPU too high for 10 minutes
resource "aws_cloudwatch_metric_alarm" "node_cpu_high" {
  alarm_name        = "${var.name}-node-cpu-high"
  alarm_description = "Average CPU across EKS worker nodes above ${var.cpu_threshold}% for 10 minutes"

  namespace   = "AWS/EC2"
  metric_name = "CPUUtilization"
  dimensions = {
    AutoScalingGroupName = var.asg_name
  }

  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = var.cpu_threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

# Alarm triggered when node is unhealthy
resource "aws_cloudwatch_metric_alarm" "node_status_check" {
  alarm_name        = "${var.name}-node-status-check-failed"
  alarm_description = "At least one EKS worker node is failing EC2 status checks"

  namespace   = "AWS/EC2"
  metric_name = "StatusCheckFailed"
  dimensions = {
    AutoScalingGroupName = var.asg_name
  }

  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}