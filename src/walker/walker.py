"""
Web Walk - Google Street View route video generator.

This service will:
1. Accept a route (point A to point B)
2. Use Google Maps Directions API to get the route path
3. Capture Google Street View images along the route
4. Stitch them into a timelapse video using FFmpeg

Currently a placeholder - will be implemented with Google Street View API.
"""

import time
import sys


def main():
    print("Web Walk walker service started (placeholder)")
    print("Ready to process Street View routes when API is configured")
    # Keep alive - will be triggered by server API calls in the future
    while True:
        time.sleep(3600)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Walker service stopped")
        sys.exit(0)
