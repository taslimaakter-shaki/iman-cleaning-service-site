# Iman Gemini Estimator Cloud Run Service

This service runs on Google Cloud Run and uses Vertex AI Gemini with Application Default Credentials.

It does not use Gemini API keys.

## Google Cloud Setup

Project used so far:

- `concise-option-493515-d2`

Enable APIs:

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com aiplatform.googleapis.com
```

Create a service account:

```bash
gcloud iam service-accounts create iman-ai-estimator \
  --display-name="Iman AI Estimator"
```

Grant Vertex AI access:

```bash
gcloud projects add-iam-policy-binding concise-option-493515-d2 \
  --member="serviceAccount:iman-ai-estimator@concise-option-493515-d2.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"
```

Deploy from this folder:

```bash
gcloud run deploy iman-gemini-estimator \
  --source . \
  --region us-central1 \
  --service-account iman-ai-estimator@concise-option-493515-d2.iam.gserviceaccount.com \
  --allow-unauthenticated \
  --set-env-vars GOOGLE_CLOUD_LOCATION=us-central1,GEMINI_MODEL=gemini-1.5-flash-002,IMAN_AI_SERVICE_TOKEN=change-this-long-secret
```

Copy the Cloud Run service URL after deploy.

## Vercel Setup

Add these environment variables to the Vercel project:

- `GEMINI_ESTIMATOR_URL`: Cloud Run service URL
- `IMAN_AI_SERVICE_TOKEN`: same long secret used in Cloud Run

Then redeploy Vercel.

## Test

```bash
curl -X POST "$GEMINI_ESTIMATOR_URL/estimate" \
  -H "Content-Type: application/json" \
  -H "x-iman-ai-token: change-this-long-secret" \
  --data '{"service":"Deep Cleaning","bedrooms":2,"bathrooms":1,"sqft":850,"clutter":"Medium","images":[]}'
```
