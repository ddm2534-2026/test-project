#!/usr/bin/env bash
# Однократная настройка Google Cloud для загрузки цен Victory.
# Запускать в Cloud Shell (console.cloud.google.com → значок терминала) в проекте с подключённой оплатой:
#   bash setup_gcp.sh
# Ключи не создаёт: GitHub входит в Google Cloud через Workload Identity.
# В конце печатает две строки — их нужно передать (они не секретные).
set -euo pipefail
REPO="ddm2534-2026/test-project"
PROJECT="$(gcloud config get-value project)"
NUM="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
SA="gh-victory@${PROJECT}.iam.gserviceaccount.com"
RUNTIME="${NUM}-compute@developer.gserviceaccount.com"

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com iamcredentials.googleapis.com sts.googleapis.com

gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 || \
  gcloud iam service-accounts create gh-victory --display-name="GitHub: цены Victory"
for role in roles/run.admin roles/iam.serviceAccountUser roles/cloudbuild.builds.editor \
            roles/artifactregistry.admin roles/storage.admin roles/secretmanager.admin \
            roles/serviceusage.serviceUsageConsumer roles/logging.viewer; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" --role="$role" --condition=None -q >/dev/null
done
# от имени этого аккаунта собирается образ и работает задача
for role in roles/secretmanager.secretAccessor roles/cloudbuild.builds.builder roles/artifactregistry.writer \
            roles/logging.logWriter roles/storage.objectViewer; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$RUNTIME" --role="$role" --condition=None -q >/dev/null
done

gcloud iam workload-identity-pools describe github --location=global >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools create github --location=global --display-name="GitHub Actions"
gcloud iam workload-identity-pools providers describe github --workload-identity-pool=github --location=global >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools providers create-oidc github --location=global --workload-identity-pool=github \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
    --attribute-condition="assertion.repository=='${REPO}'"
gcloud iam service-accounts add-iam-policy-binding "$SA" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${NUM}/locations/global/workloadIdentityPools/github/attribute.repository/${REPO}" -q >/dev/null

echo
echo "Готово. Передай эти две строки:"
echo "GCP_WIF_PROVIDER=projects/${NUM}/locations/global/workloadIdentityPools/github/providers/github"
echo "GCP_SA=${SA}"
