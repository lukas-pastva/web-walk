"""
Web Walk - Google Street View route video generator.

Usage: python walker.py <walk_id>

Reads walk config from SQLite database, downloads Street View images
along the multi-point route, and stitches them into a video.
"""

import json
import math
import os
import sqlite3
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests

OUTPUT_DIR = os.environ.get("OUTPUT_DIR", "/data")
API_KEY = os.environ.get("GOOGLE_API_KEY", "")
DB_PATH = os.path.join(OUTPUT_DIR, "webwalk.db")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def load_walk(walk_id):
    conn = get_db()
    walk = conn.execute("SELECT * FROM walks WHERE id = ?", (walk_id,)).fetchone()
    if not walk:
        raise Exception(f"Walk {walk_id} not found")
    points = conn.execute(
        "SELECT * FROM walk_points WHERE walk_id = ? ORDER BY sort_order",
        (walk_id,),
    ).fetchall()
    conn.close()
    return dict(walk), [dict(p) for p in points]


def update_walk_status(walk_id, status, total_frames=0, downloaded_frames=0, error_message=None):
    conn = get_db()
    conn.execute(
        """UPDATE walks SET status = ?, total_frames = ?, downloaded_frames = ?,
           error_message = ?, updated_at = datetime('now') WHERE id = ?""",
        (status, total_frames, downloaded_frames, error_message, walk_id),
    )
    conn.commit()
    conn.close()


def save_progress(walk_id, downloaded_frames):
    conn = get_db()
    conn.execute(
        "UPDATE walks SET downloaded_frames = ?, updated_at = datetime('now') WHERE id = ?",
        (downloaded_frames, walk_id),
    )
    conn.commit()
    conn.close()


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


def get_multi_segment_route(points):
    """Get route through multiple waypoints, returns combined polyline points."""
    all_polyline_points = []

    for i in range(len(points) - 1):
        start = points[i]
        end = points[i + 1]
        print(f"  Segment {i+1}/{len(points)-1}: ({start['lat']},{start['lng']}) -> ({end['lat']},{end['lng']})")
        encoded = get_directions(start["lat"], start["lng"], end["lat"], end["lng"])
        segment_points = decode_polyline(encoded)

        # Skip first point of subsequent segments to avoid duplicates
        if all_polyline_points:
            segment_points = segment_points[1:]

        all_polyline_points.extend(segment_points)

    return all_polyline_points


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
    if len(resp.content) < 5000:
        return False
    with open(output_path, "wb") as f:
        f.write(resp.content)
    return True


def make_video(frames_dir, output_path, num_frames, duration_seconds):
    """Stitch frames into an MP4 video using FFmpeg with target duration."""
    # Calculate framerate to achieve target duration
    framerate = max(1, round(num_frames / max(1, duration_seconds)))
    # Clamp framerate to reasonable range
    framerate = min(framerate, 60)

    print(f"  Video: {num_frames} frames, {duration_seconds}s target, {framerate} fps")

    cmd = [
        "ffmpeg", "-y",
        "-framerate", str(framerate),
        "-i", str(frames_dir / "%06d.jpg"),
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "fast",
        "-crf", "23",
        str(output_path),
    ]
    subprocess.run(cmd, check=True, capture_output=True)


def main(walk_id):
    walk, points = load_walk(walk_id)

    if len(points) < 2:
        update_walk_status(walk_id, "error", error_message="At least 2 points required")
        sys.exit(1)

    duration_seconds = walk.get("duration_seconds", 60)
    update_walk_status(walk_id, "processing")

    frames_dir = Path(OUTPUT_DIR) / "frames" / walk_id
    frames_dir.mkdir(parents=True, exist_ok=True)
    video_path = Path(OUTPUT_DIR) / "videos" / f"{walk_id}.mp4"
    video_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        # 1. Get multi-segment route
        print(f"[{walk_id}] Getting directions for {len(points)} waypoints...")
        polyline_points = get_multi_segment_route(points)
        print(f"[{walk_id}] Route has {len(polyline_points)} polyline points")

        # 2. Interpolate points
        interpolated = interpolate_points(polyline_points, interval_m=15)
        print(f"[{walk_id}] Interpolated to {len(interpolated)} points")

        update_walk_status(walk_id, "processing", total_frames=len(interpolated))

        # 3. Download Street View images
        def download_frame(args):
            idx, lat, lng, hdg, path = args
            return idx, download_streetview(lat, lng, hdg, path)

        tasks = []
        for i in range(len(interpolated)):
            lat, lng = interpolated[i]
            if i < len(interpolated) - 1:
                hdg = bearing(lat, lng, interpolated[i + 1][0], interpolated[i + 1][1])
            else:
                hdg = bearing(interpolated[i - 1][0], interpolated[i - 1][1], lat, lng) if i > 0 else 0
            frame_path = frames_dir / f"{i:06d}.jpg"
            tasks.append((i, lat, lng, hdg, str(frame_path)))

        downloaded = 0
        with ThreadPoolExecutor(max_workers=5) as executor:
            futures = {executor.submit(download_frame, t): t for t in tasks}
            for future in as_completed(futures):
                idx, success = future.result()
                if success:
                    downloaded += 1
                if downloaded % 10 == 0:
                    save_progress(walk_id, downloaded)

        save_progress(walk_id, downloaded)
        print(f"[{walk_id}] Downloaded {downloaded} frames")

        if downloaded == 0:
            raise Exception("No Street View images found along this route")

        # 4. Renumber frames sequentially
        existing = sorted(frames_dir.glob("*.jpg"))
        for new_idx, old_path in enumerate(existing):
            new_path = frames_dir / f"{new_idx:06d}.jpg"
            if old_path != new_path:
                old_path.rename(new_path)
        for f in frames_dir.glob("*.jpg"):
            if int(f.stem) >= len(existing):
                f.unlink()

        # 5. Make video with target duration
        print(f"[{walk_id}] Creating video from {len(existing)} frames (target: {duration_seconds}s)...")
        make_video(frames_dir, video_path, len(existing), duration_seconds)

        update_walk_status(walk_id, "done", total_frames=len(existing), downloaded_frames=len(existing))
        print(f"[{walk_id}] Done! Video: {video_path}")

    except Exception as e:
        print(f"[{walk_id}] Error: {e}", file=sys.stderr)
        update_walk_status(walk_id, "error", error_message=str(e))
        sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python walker.py <walk_id>", file=sys.stderr)
        sys.exit(1)
    main(sys.argv[1])
