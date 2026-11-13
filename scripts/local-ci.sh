#!/usr/bin/env bash
# Local run of the CI pipeline (same stages as .github/workflows/ci.yml), for when
# GitHub-hosted runners are unavailable. Builds images straight into the kind cluster.
#
#   CONFIG_REPO_DIR=../atlas-market-gitops KIND_CLUSTER=argo-lab ./scripts/local-ci.sh
#   PUSH=1 ...   also push to Docker Hub (needs `docker login`)
set -euo pipefail
cd "$(dirname "$0")/.."

REG="${REGISTRY_USER:-atlas201}"
CLUSTER="${KIND_CLUSTER:-argo-lab}"
CONFIG_REPO_DIR="${CONFIG_REPO_DIR:?set CONFIG_REPO_DIR to your atlas-market-gitops clone}"
TAG="sha-$(git rev-parse --short=7 HEAD)"
SVC=ecommerce-application/services
start=$(date +%s)

echo "==> 1-2. lint + test"
for s in gateway product-service order-service; do
  (cd "$SVC/$s" && npm ci --no-audit --no-fund && npm run lint && npm test)
done

echo "==> 3-5. build, gates, scan, load ($TAG)"
for s in frontend gateway product-service order-service; do
  img="$REG/shop-$s:$TAG"
  docker build --build-arg APP_VERSION="$TAG" -t "$img" "$SVC/$s"
  user=$(docker image inspect "$img" --format '{{.Config.User}}')
  case "$user" in ""|0|root|0:*|root:*) echo "$s runs as root"; exit 1;; esac
  if [ "${SCAN:-1}" = "1" ]; then   # SCAN=0 to skip (e.g. offline)
    docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy:0.65.0 image \
      --quiet --severity CRITICAL --ignore-unfixed --exit-code 1 "$img" || { echo "CRITICAL CVEs in $s"; exit 1; }
  fi
  kind load docker-image "$img" --name "$CLUSTER"
  [ "${PUSH:-0}" = "1" ] && docker push "$img"
done

echo "==> 6. update config repo (staging)"
cd "$CONFIG_REPO_DIR"
git pull --ff-only
yq -i ".image.tag = \"$TAG\"" envs/staging/values.yaml
git commit -am "deploy(staging): atlas-market $TAG (local CI)"
git push
echo "Done in $(( $(date +%s) - start ))s. ArgoCD will auto-sync atlas-staging to $TAG."
