"""
Web Walk - Google Street View route video generator.

Usage: python walker.py <walk_id>

Reads walk config from MySQL database, downloads Street View images
along the multi-point route, and stitches them into a video.
"""

import base64
import hashlib
import hmac
import json
import math
import os
import shutil
import subprocess
import sys
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import mysql.connector
import requests

OUTPUT_DIR = os.environ.get("OUTPUT_DIR", "/data")
API_KEY = os.environ.get("GOOGLE_API_KEY", "")
SIGNING_SECRET = os.environ.get("GOOGLE_SIGNING_SECRET", "")

DB_CONFIG = {
    "host": os.environ.get("DB_HOST", "localhost"),
    "user": os.environ.get("DB_USER", "root"),
    "password": os.environ.get("DB_PASSWORD", ""),
    "database": os.environ.get("DB_NAME", "web_walk"),
    "port": int(os.environ.get("DB_PORT", "3306")),
}


def get_db():
    conn = mysql.connector.connect(**DB_CONFIG)
    return conn


def load_walk(walk_id):
    conn = get_db()
    cur = conn.cursor(dictionary=True)
    cur.execute("SELECT * FROM walks WHERE id = %s", (walk_id,))
    walk = cur.fetchone()
    if not walk:
        cur.close()
        conn.close()
        raise Exception(f"Walk {walk_id} not found")
    cur.execute(
        "SELECT * FROM walk_points WHERE walk_id = %s ORDER BY sort_order",
        (walk_id,),
    )
    points = cur.fetchall()
    cur.close()
    conn.close()
    return walk, points


def update_walk_status(walk_id, status, total_frames=0, downloaded_frames=0, error_message=None):
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """UPDATE walks SET status = %s, total_frames = %s, downloaded_frames = %s,
           error_message = %s, updated_at = NOW() WHERE id = %s""",
        (status, total_frames, downloaded_frames, error_message, walk_id),
    )
    conn.commit()
    cur.close()
    conn.close()


def log_message(walk_id, message, level="info"):
    """Log a message to both stdout and database."""
    prefix = f"[{walk_id}]"
    if level == "error":
        print(f"{prefix} ERROR: {message}", file=sys.stderr)
    else:
        print(f"{prefix} {message}")
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO walk_logs (walk_id, level, message) VALUES (%s, %s, %s)",
            (walk_id, level, message),
        )
        conn.commit()
        cur.close()
        conn.close()
    except Exception:
        pass  # Don't fail the walk if logging fails


def save_progress(walk_id, downloaded_frames):
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "UPDATE walks SET downloaded_frames = %s, updated_at = NOW() WHERE id = %s",
        (downloaded_frames, walk_id),
    )
    conn.commit()
    cur.close()
    conn.close()


# Google API pricing (per request)
API_COSTS = {
    "directions": 0.005,      # $5 per 1000 requests
    "streetview": 0.007,      # $7 per 1000 requests
}

# Daily cost limit in USD
DAILY_COST_LIMIT = float(os.environ.get("DAILY_COST_LIMIT", "50"))


def get_cost_last_24h():
    conn = get_db()
    cur = conn.cursor(dictionary=True)
    cur.execute(
        "SELECT COALESCE(SUM(cost_usd), 0) as total FROM api_usage WHERE created_at >= NOW() - INTERVAL 24 HOUR"
    )
    row = cur.fetchone()
    cur.close()
    conn.close()
    return row["total"]


def check_rate_limit(walk_id, needed=1, api_type="streetview"):
    used = get_cost_last_24h()
    est_cost = needed * API_COSTS.get(api_type, 0.007)
    if used + est_cost > DAILY_COST_LIMIT:
        msg = f"Daily cost limit reached (${used:.2f}/${DAILY_COST_LIMIT:.0f}). Wait 24 hours."
        update_walk_status(walk_id, "error", error_message=msg)
        raise Exception(msg)


def log_api_usage(walk_id, api_type, request_count=1):
    cost = API_COSTS.get(api_type, 0) * request_count
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO api_usage (walk_id, api_type, request_count, cost_usd) VALUES (%s, %s, %s, %s)",
        (walk_id, api_type, request_count, cost),
    )
    conn.commit()
    cur.close()
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


def get_directions(start_lat, start_lng, end_lat, end_lng, walk_id=None):
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
    log_api_usage(walk_id, "directions", 1)
    return data["routes"][0]["overview_polyline"]["points"]


def get_multi_segment_route(points, walk_id=None):
    """Get route through multiple waypoints, returns combined polyline points."""
    all_polyline_points = []

    for i in range(len(points) - 1):
        start = points[i]
        end = points[i + 1]
        log_message(walk_id, f"Routing segment {i+1}/{len(points)-1}: ({start['lat']:.5f},{start['lng']:.5f}) -> ({end['lat']:.5f},{end['lng']:.5f})")
        encoded = get_directions(start["lat"], start["lng"], end["lat"], end["lng"], walk_id)
        segment_points = decode_polyline(encoded)

        # Skip first point of subsequent segments to avoid duplicates
        if all_polyline_points:
            segment_points = segment_points[1:]

        all_polyline_points.extend(segment_points)

    return all_polyline_points


def sign_url(url_to_sign):
    """Sign a Google Maps API URL with the signing secret."""
    if not SIGNING_SECRET:
        return url_to_sign
    parsed = urllib.parse.urlparse(url_to_sign)
    url_to_sign_path = parsed.path + "?" + parsed.query
    decoded_key = base64.urlsafe_b64decode(SIGNING_SECRET)
    signature = hmac.new(decoded_key, url_to_sign_path.encode("utf-8"), hashlib.sha1)
    encoded_sig = base64.urlsafe_b64encode(signature.digest()).decode("utf-8")
    return url_to_sign + "&signature=" + encoded_sig


# Aspect ratio to image size mapping
ASPECT_SIZES_SIGNED = {
    "1:1": "2048x2048",
    "3:2": "2048x1365",
    "4:3": "2048x1536",
    "16:9": "2048x1152",
}
ASPECT_SIZES_UNSIGNED = {
    "1:1": "640x640",
    "3:2": "640x427",
    "4:3": "640x480",
    "16:9": "640x360",
}

# Default image size (may be overridden per walk)
IMAGE_SIZE = "2048x2048" if SIGNING_SECRET else "640x640"


def get_image_size(aspect_ratio="1:1"):
    """Get image size string for given aspect ratio."""
    if SIGNING_SECRET:
        return ASPECT_SIZES_SIGNED.get(aspect_ratio, ASPECT_SIZES_SIGNED["1:1"])
    return ASPECT_SIZES_UNSIGNED.get(aspect_ratio, ASPECT_SIZES_UNSIGNED["1:1"])


def cache_key_parts(lat, lng, heading, pitch, fov):
    """Round coordinates for cache lookup: ~1m precision for lat/lng, 1 degree for heading."""
    return (round(lat, 5), round(lng, 5), round(heading), round(pitch), round(fov))


def check_cache(lat, lng, heading, pitch, fov, image_size):
    """Check if image exists in cache. Returns file_path or None."""
    lat_k, lng_k, hdg_k, pitch_k, fov_k = cache_key_parts(lat, lng, heading, pitch, fov)
    try:
        conn = get_db()
        cur = conn.cursor(dictionary=True)
        cur.execute(
            """SELECT file_path FROM streetview_cache
               WHERE lat_key = %s AND lng_key = %s AND heading_key = %s
                 AND pitch = %s AND fov = %s AND size = %s""",
            (lat_k, lng_k, hdg_k, pitch_k, fov_k, image_size),
        )
        row = cur.fetchone()
        cur.close()
        conn.close()
        if row and os.path.exists(row["file_path"]):
            return row["file_path"]
    except Exception:
        pass
    return None


def save_to_cache(lat, lng, heading, pitch, fov, image_size, file_path):
    """Save image info to cache DB."""
    lat_k, lng_k, hdg_k, pitch_k, fov_k = cache_key_parts(lat, lng, heading, pitch, fov)
    try:
        file_size = os.path.getsize(file_path)
        conn = get_db()
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO streetview_cache (lat_key, lng_key, heading_key, pitch, fov, size, file_path, file_size)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
               ON DUPLICATE KEY UPDATE file_path = %s, file_size = %s""",
            (lat_k, lng_k, hdg_k, pitch_k, fov_k, image_size, file_path, file_size, file_path, file_size),
        )
        conn.commit()
        cur.close()
        conn.close()
    except Exception:
        pass


CACHE_DIR = os.path.join(OUTPUT_DIR, "cache", "streetview")


def download_streetview(lat, lng, heading, output_path, walk_id=None, pitch=0, fov=90, image_size=None):
    """Download a Street View image. Uses cache if available. Returns (True, from_cache) or (False, False)."""
    if image_size is None:
        image_size = IMAGE_SIZE

    # Check cache first
    cached = check_cache(lat, lng, heading, pitch, fov, image_size)
    if cached:
        shutil.copy2(cached, output_path)
        return True, True

    base_url = "https://maps.googleapis.com/maps/api/streetview"
    params = {
        "size": image_size,
        "location": f"{lat},{lng}",
        "heading": f"{heading:.1f}",
        "fov": str(fov),
        "pitch": str(pitch),
        "key": API_KEY,
    }
    url = base_url + "?" + urllib.parse.urlencode(params)
    url = sign_url(url)
    resp = requests.get(url, timeout=30)
    if resp.status_code != 200:
        return False, False
    if len(resp.content) < 5000:
        return False, False
    with open(output_path, "wb") as f:
        f.write(resp.content)

    # Save to persistent cache
    os.makedirs(CACHE_DIR, exist_ok=True)
    lat_k, lng_k, hdg_k, pitch_k, fov_k = cache_key_parts(lat, lng, heading, pitch, fov)
    cache_filename = f"{lat_k}_{lng_k}_{hdg_k}_{pitch_k}_{fov_k}_{image_size}.jpg"
    cache_path = os.path.join(CACHE_DIR, cache_filename)
    shutil.copy2(output_path, cache_path)
    save_to_cache(lat, lng, heading, pitch, fov, image_size, cache_path)

    return True, False


def get_crop_filter(aspect_ratio):
    """Get FFmpeg crop filter for the given aspect ratio. Crops from center, removes black borders."""
    ratios = {
        "1:1": (1, 1),
        "3:2": (3, 2),
        "4:3": (4, 3),
        "16:9": (16, 9),
    }
    if aspect_ratio not in ratios or aspect_ratio == "1:1":
        return None
    w_ratio, h_ratio = ratios[aspect_ratio]
    # Crop to largest centered rectangle of desired aspect ratio
    return f"crop=min(iw\\,ih*{w_ratio}/{h_ratio}):min(ih\\,iw*{h_ratio}/{w_ratio})"


def make_video(frames_dir, output_path, num_frames, duration_seconds, aspect_ratio="1:1"):
    """Stitch frames into an MP4 video using FFmpeg with target duration."""
    framerate = max(1, round(num_frames / max(1, duration_seconds)))
    framerate = min(framerate, 60)

    print(f"  Video: {num_frames} frames, {duration_seconds}s target, {framerate} fps, aspect={aspect_ratio}")

    crop_filter = get_crop_filter(aspect_ratio)
    vf_filters = []
    if crop_filter:
        vf_filters.append(crop_filter)

    cmd = [
        "ffmpeg", "-y",
        "-framerate", str(framerate),
        "-i", str(frames_dir / "%06d.jpg"),
    ]
    if vf_filters:
        cmd += ["-vf", ",".join(vf_filters)]
    cmd += [
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "slow",
        "-crf", "0",
        str(output_path),
    ]
    subprocess.run(cmd, check=True, capture_output=True)


def main(walk_id):
    walk, points = load_walk(walk_id)

    if len(points) < 2:
        update_walk_status(walk_id, "error", error_message="At least 2 points required")
        sys.exit(1)

    duration_seconds = walk.get("duration_seconds", 60)
    heading_offset = walk.get("heading_offset", 0)
    walk_pitch = walk.get("pitch", 0)
    walk_fov = walk.get("fov", 90)
    walk_aspect = walk.get("aspect_ratio", "1:1")
    walk_image_size = get_image_size(walk_aspect)

    log_message(walk_id, f"Starting walk processing: {walk.get('name', 'Untitled')}")
    log_message(walk_id, f"Settings: duration={duration_seconds}s, heading_offset={heading_offset}, pitch={walk_pitch}, fov={walk_fov}, aspect={walk_aspect}")
    log_message(walk_id, f"Image size: {walk_image_size} ({'signed URLs' if SIGNING_SECRET else 'unsigned'})")
    log_message(walk_id, f"Waypoints: {len(points)}")
    update_walk_status(walk_id, "processing")

    frames_dir = Path(OUTPUT_DIR) / "frames" / walk_id
    frames_dir.mkdir(parents=True, exist_ok=True)
    video_path = Path(OUTPUT_DIR) / "videos" / f"{walk_id}.mp4"
    video_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        # 1. Get multi-segment route
        log_message(walk_id, f"Getting directions for {len(points)} waypoints...")
        check_rate_limit(walk_id, len(points) - 1, "directions")
        polyline_points = get_multi_segment_route(points, walk_id)
        log_message(walk_id, f"Route has {len(polyline_points)} polyline points")

        # 2. Interpolate points
        interpolated = interpolate_points(polyline_points, interval_m=15)
        log_message(walk_id, f"Interpolated to {len(interpolated)} points (every 15m)")

        update_walk_status(walk_id, "processing", total_frames=len(interpolated))
        log_message(walk_id, f"Total frames to download: {len(interpolated)}")

        # Check rate limit before downloading all frames
        check_rate_limit(walk_id, len(interpolated), "streetview")
        log_message(walk_id, "Rate limit check passed, starting downloads...")

        # 3. Download Street View images (with cache)
        def download_frame(args):
            idx, lat, lng, hdg, path = args
            success, from_cache = download_streetview(lat, lng, hdg, path, walk_id, walk_pitch, walk_fov, walk_image_size)
            return idx, success, from_cache

        tasks = []
        for i in range(len(interpolated)):
            lat, lng = interpolated[i]
            if i < len(interpolated) - 1:
                hdg = bearing(lat, lng, interpolated[i + 1][0], interpolated[i + 1][1])
            else:
                hdg = bearing(interpolated[i - 1][0], interpolated[i - 1][1], lat, lng) if i > 0 else 0
            hdg = (hdg + heading_offset) % 360
            frame_path = frames_dir / f"{i:06d}.jpg"
            tasks.append((i, lat, lng, hdg, str(frame_path)))

        downloaded = 0
        from_cache = 0
        failed = 0
        with ThreadPoolExecutor(max_workers=5) as executor:
            futures = {executor.submit(download_frame, t): t for t in tasks}
            for future in as_completed(futures):
                idx, success, cached = future.result()
                if success:
                    downloaded += 1
                    if cached:
                        from_cache += 1
                else:
                    failed += 1
                total_done = downloaded + failed
                if total_done % 10 == 0 or total_done == len(tasks):
                    save_progress(walk_id, downloaded)
                    log_message(walk_id, f"Progress: {downloaded} downloaded ({from_cache} cached), {failed} failed / {len(tasks)} total ({int(total_done/len(tasks)*100)}%)")

        save_progress(walk_id, downloaded)
        new_downloads = downloaded - from_cache
        if new_downloads > 0:
            log_api_usage(walk_id, "streetview", new_downloads)
        log_message(walk_id, f"Download complete: {downloaded} frames OK ({from_cache} from cache, {new_downloads} new), {failed} failed")

        if downloaded == 0:
            raise Exception("No Street View images found along this route")

        # 4. Renumber frames sequentially
        log_message(walk_id, "Renumbering frames sequentially...")
        existing = sorted(frames_dir.glob("*.jpg"))
        for new_idx, old_path in enumerate(existing):
            new_path = frames_dir / f"{new_idx:06d}.jpg"
            if old_path != new_path:
                old_path.rename(new_path)
        for f in frames_dir.glob("*.jpg"):
            if int(f.stem) >= len(existing):
                f.unlink()

        # 5. Make video with target duration
        framerate = max(1, min(60, round(len(existing) / max(1, duration_seconds))))
        log_message(walk_id, f"Creating video: {len(existing)} frames, {duration_seconds}s target, {framerate} fps")
        make_video(frames_dir, video_path, len(existing), duration_seconds, walk_aspect)

        update_walk_status(walk_id, "done", total_frames=len(existing), downloaded_frames=len(existing))
        log_message(walk_id, f"Done! Video saved: {video_path}")

    except Exception as e:
        log_message(walk_id, f"Error: {e}", level="error")
        update_walk_status(walk_id, "error", error_message=str(e))
        sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python walker.py <walk_id>", file=sys.stderr)
        sys.exit(1)
    main(sys.argv[1])
