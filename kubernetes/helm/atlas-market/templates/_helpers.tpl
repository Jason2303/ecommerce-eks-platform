{{/* Labels added to every object */}}
{{- define "atlas.labels" -}}
app.kubernetes.io/part-of: atlas-market
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{/* Pod-level security: non-root user, default seccomp profile */}}
{{- define "atlas.podSecurity" -}}
runAsNonRoot: true
runAsUser: {{ .uid }}
runAsGroup: {{ .uid }}
seccompProfile:
  type: RuntimeDefault
{{- end -}}

{{/* Container-level security: no privilege escalation, no Linux capabilities */}}
{{- define "atlas.containerSecurity" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: {{ .readOnly }}
capabilities:
  drop: ["ALL"]
{{- end -}}

{{/* Spread copies across AZs first, then across nodes */}}
{{- define "atlas.spread" -}}
- maxSkew: 1
  topologyKey: topology.kubernetes.io/zone
  whenUnsatisfiable: ScheduleAnyway
  labelSelector:
    matchLabels:
      app: {{ . }}
- maxSkew: 1
  topologyKey: kubernetes.io/hostname
  whenUnsatisfiable: ScheduleAnyway
  labelSelector:
    matchLabels:
      app: {{ . }}
{{- end -}}

{{/* DNS egress rule, used by every NetworkPolicy */}}
{{- define "atlas.dnsEgress" -}}
- to:
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: kube-system
      podSelector:
        matchLabels:
          k8s-app: kube-dns
  ports:
    - protocol: UDP
      port: 53
    - protocol: TCP
      port: 53
{{- end -}}
