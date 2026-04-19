# Web Walk

Street View timelapse video generator. Pick a walking route (point A to point B) on the map and the app generates a smooth walk-through video from Google Street View images.

## Google API Key Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Go to **APIs & Services > Library**
4. Enable these two APIs:
   - **Directions API** — search for "Directions API" and click **Enable**
   - **Street View Static API** — search for "Street View Static API" and click **Enable**
5. Go to **APIs & Services > Credentials**
6. Click **Create Credentials > API Key**
7. Copy the generated API key
8. (Recommended) Click **Edit API key** and restrict it:
   - Under **API restrictions**, select **Restrict key**
   - Select only **Directions API** and **Street View Static API**
   - Click **Save**

## Running locally

```bash
export GOOGLE_API_KEY=your-api-key-here
docker-compose up --build
```

App will be available at `http://localhost:8080`

## Kubernetes

Add the API key to the `web-walk` secret:

```bash
kubectl create secret generic web-walk \
  --namespace web-walk \
  --from-literal=GOOGLE_API_KEY=your-api-key-here
```
