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

## URL Signing (High-Res 2048x2048 Images)

Without URL signing, Street View images are limited to 640x640. With a signing secret, the app automatically downloads 2048x2048 images at **no extra cost**.

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Go to **APIs & Services > Credentials**
3. Find the **URL signing secret** section (or go to [Maps Platform > Keys & Credentials](https://console.cloud.google.com/google/maps-apis/credentials))
4. Click **Show Secret** next to your API key to reveal the signing secret
5. If there is no signing secret, click **Regenerate Secret** to create one
6. Copy the secret (it looks like a base64 string, e.g. `vNIXE0xscrmjlyV-12Nj_BvUPaw=`)
7. Set it as `GOOGLE_SIGNING_SECRET` environment variable

**Note:** The signing secret is different from the API key. The API key identifies your project, the signing secret authenticates the request. Both are needed for high-res images.

## Running locally

```bash
export GOOGLE_API_KEY=your-api-key-here
export GOOGLE_SIGNING_SECRET=your-signing-secret-here  # optional, for 2048x2048 images
docker-compose up --build
```

App will be available at `http://localhost:8080`

## Kubernetes

Add the credentials to the `web-walk` secret:

```bash
kubectl create secret generic web-walk \
  --namespace web-walk \
  --from-literal=GOOGLE_API_KEY=your-api-key-here \
  --from-literal=GOOGLE_SIGNING_SECRET=your-signing-secret-here \
  --from-literal=MARIADB_DATABASE=web_walk \
  --from-literal=MARIADB_USER=walk \
  --from-literal=MARIADB_PASSWORD=your-db-password
```

If the secret already exists, patch it:

```bash
kubectl -n web-walk patch secret web-walk -p '{"stringData":{
  "GOOGLE_SIGNING_SECRET": "your-signing-secret-here"
}}'
```
