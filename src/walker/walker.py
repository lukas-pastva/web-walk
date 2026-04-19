"""
Web Walk - Google Street View route video generator.

Usage: python walker.py <job_id>

Reads job config from /data/jobs/<job_id>.json, downloads Street View images
along the route, and stitches them into a timelapse video.
"""

import json
import math
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests

OUTPUT_DIR = os.environ.get("OUTPUT_DIR", "/data")
API_KEY = os.environ.get("GOOGLE_API_KEY", "")


def load_job(job_id):
    path = Path(OUTPUT_DIR) / "jobs" / f"{job_id}.json"
    with open(path) as f:
        return json.load(f)


def save_job(job):
    path = Path(OUTPUT_DIR) / "jobs" / f"{job['id']}.json"
    job["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    with open(path, "w") as f:
        json.dump(job, f, indent=2)


def decode_polyline(encoded):
    """Decode a Google Maps encoded polyline string into a list of (lat, lng)."""
    points = []
    index = 0
    lat = 0
    lng = 0
    while index < len(encoded):
        for attr in ("lat", "lng"):
            shift = 0
            result = 0
            while True:
                b = ord(encoded[index]) - 63
                index += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            value = ~(result >> 1) if (result & 1) else (result >> 1)
            if attr == "lat":
                lat += value
            else:
                lng += value
        points.append((lat / 1e5, lng / 1e5))
    return points


def haversine(lat1, lng1, lat2, lng2):
    """Distance in meters between two coordinates."""
    R = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def bearing(lat1, lng1, lat2, lng2):
    """Calculate bearing in degrees from point 1 to point 2."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lng2 - lng1)
    x = math.sin(dl) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def interpolate_points(polyline_points, interval_m=15):
    """Interpolate points along the polyline at given meter intervals."""
    result = [polyline_points[0]]
    remaining = interval_m

    for i in range(len(polyline_points) - 1):
        lat1, lng1 = polyline_points[i]
        lat2, lng2 = polyline_points[i + 1]
        seg_dist = haversine(lat1, lng1, lat2, lng2)

        if seg_dist == 0:
            continue

        covered = 0
        while covered + remaining <= seg_dist:
            covered += remaining
            frac = covered / seg_dist
            lat = lat1 + frac * (lat2 - lat1)
            lng = lng1 + frac * (lng2 - lng1)
            result.append((lat, lng))
            remaining = interval_m

        remaining -= seg_dist - covered

    return result


def get_directions(start_lat, start_lng, end_lat, end_lng):
    """Get route from Google Maps Directions API."""
    url = "https://maps.googleapis.com/maps/api/directions/json"
    params = {
        "origin": f"{start_lat},{start_lng}",
        "destination": f"{end_lat},{end_lng}",
        "mode": "walking",
        "key": API_KEY,
    }
    resp = requests.get(url, params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    if data["status"] != "OK":
        raise Exception(f"Directions API error: {data['status']}")
    return data["routes"][0]["overview_polyline"]["points"]


def download_streetview(lat, lng, heading, output_path):
    """Download a Street View image. Returns True if image was saved."""
    url = "https://maps.googleapis.com/maps/api/streetview"
    params = {
        "size": "640x640",
        "location": f"{lat},{lng}",
        "heading": f"{heading:.1f}",
        "fov": "90",
        "pitch": "0",
        "key": API_KEY,
    }
    resp = requests.get(url, params=params, timeout=30)
    if resp.status_code != 200:
        return False
    # Google returns a "no imagery" placeholder as a small image
    if len(resp.content) < 5000:
        return False
    with open(output_path, "wb") as f:
        f.write(resp.content)
    return True


def make_video(frames_dir, output_path):
    """Stitch frames into an MP4 video using FFmpeg."""
    cmd = [
        "ffmpeg", "-y",
        "-framerate", "24",
        "-i", str(frames_dir / "%06d.jpg"),
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "fast",
        "-crf", "23",
        str(output_path),
    ]
    subprocess.run(cmd, check=True, capture_output=True)


def main(job_id):
    job = load_job(job_id)
    job["status"] = "processing"
    save_job(job)

    frames_dir = Path(OUTPUT_DIR) / "frames" / job_id
    frames_dir.mkdir(parents=True, exist_ok=True)
    video_path = Path(OUTPUT_DIR) / "videos" / f"{job_id}.mp4"
    video_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        # 1. Get route
        print(f"[{job_id}] Getting directions...")
        encoded = get_directions(
            job["startLat"], job["startLng"],
            job["endLat"], job["endLng"]
        )
        polyline_points = decode_polyline(encoded)
        print(f"[{job_id}] Route has {len(polyline_points)} polyline points")

        # 2. Interpolate points
        points = interpolate_points(polyline_points, interval_m=15)
        print(f"[{job_id}] Interpolated to {len(points)} points")

        job["totalFrames"] = len(points)
        job["downloadedFrames"] = 0
        save_job(job)

        # 3. Download Street View images
        frame_num = 0

        def download_frame(args):
            idx, lat, lng, hdg, path = args
            return idx, download_streetview(lat, lng, hdg, path)

        tasks = []
        for i in range(len(points)):
            lat, lng = points[i]
            if i < len(points) - 1:
                hdg = bearing(lat, lng, points[i + 1][0], points[i + 1][1])
            else:
                hdg = bearing(points[i - 1][0], points[i - 1][1], lat, lng) if i > 0 else 0
            frame_path = frames_dir / f"{i:06d}.jpg"
            tasks.append((i, lat, lng, hdg, str(frame_path)))

        downloaded = 0
        with ThreadPoolExecutor(max_workers=5) as executor:
            futures = {executor.submit(download_frame, t): t for t in tasks}
            for future in as_completed(futures):
                idx, success = future.result()
                if success:
                    downloaded += 1
                job["downloadedFrames"] = downloaded
                if downloaded % 10 == 0:
                    save_job(job)

        save_job(job)
        print(f"[{job_id}] Downloaded {downloaded} frames")

        if downloaded == 0:
            raise Exception("No Street View images found along this route")

        # 4. Renumber frames sequentially (fill gaps from missing images)
        existing = sorted(frames_dir.glob("*.jpg"))
        for new_idx, old_path in enumerate(existing):
            new_path = frames_dir / f"{new_idx:06d}.jpg"
            if old_path != new_path:
                old_path.rename(new_path)
        # Remove any leftover files with higher numbers
        for f in frames_dir.glob("*.jpg"):
            if int(f.stem) >= len(existing):
                f.unlink()

        # 5. Make video
        print(f"[{job_id}] Creating video from {len(existing)} frames...")
        make_video(frames_dir, video_path)

        job["status"] = "done"
        job["totalFrames"] = len(existing)
        job["downloadedFrames"] = len(existing)
        save_job(job)
        print(f"[{job_id}] Done! Video: {video_path}")

    except Exception as e:
        print(f"[{job_id}] Error: {e}", file=sys.stderr)
        job["status"] = "error"
        job["errorMessage"] = str(e)
        save_job(job)
        sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python walker.py <job_id>", file=sys.stderr)
        sys.exit(1)
    main(sys.argv[1])
