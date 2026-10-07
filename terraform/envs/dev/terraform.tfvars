environment         = "dev"
vpc_cidr            = "10.0.0.0/16"
single_nat_gateway  = true # one NAT: saves cost.
node_min_size       = 2
node_desired_size   = 2
node_max_size       = 3
log_retention_days  = 3
cpu_alarm_threshold = 85
