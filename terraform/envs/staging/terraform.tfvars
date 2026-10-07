environment         = "staging"
vpc_cidr            = "10.1.0.0/16"
single_nat_gateway  = false
node_min_size       = 2
node_desired_size   = 2
node_max_size       = 3
log_retention_days  = 7
cpu_alarm_threshold = 80
