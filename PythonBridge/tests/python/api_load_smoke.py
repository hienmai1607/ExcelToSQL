"""Small dependency-free concurrency smoke test for a running bridge API."""

from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import os
from statistics import mean
from time import perf_counter
from urllib.request import Request, urlopen


BASE_URL = os.environ.get("BRIDGE_TEST_URL", "http://127.0.0.1:8001")
REQUESTS = int(os.environ.get("BRIDGE_TEST_REQUESTS", "100"))
WORKERS = int(os.environ.get("BRIDGE_TEST_WORKERS", "40"))


def fetch(_: int) -> float:
    request = Request(
        f"{BASE_URL}/api/opportunity/lookups",
        headers={"X-User-Name": "Admin"},
    )
    started = perf_counter()
    with urlopen(request, timeout=15) as response:
        body = json.load(response)
        assert response.status == 200
        assert response.headers["X-Bridge-Contract"] == "2"
        assert "products" in body and "customers" in body
    return perf_counter() - started


started = perf_counter()
latencies: list[float] = []
errors: list[str] = []
with ThreadPoolExecutor(max_workers=WORKERS) as executor:
    futures = [executor.submit(fetch, index) for index in range(REQUESTS)]
    for future in as_completed(futures):
        try:
            latencies.append(future.result())
        except Exception as exc:  # report the complete burst; do not stop early
            errors.append(repr(exc))

elapsed = perf_counter() - started
ordered = sorted(latencies)
p95 = ordered[max(0, int(len(ordered) * 0.95) - 1)] if ordered else 0
print(
    f"requests={REQUESTS} workers={WORKERS} ok={len(latencies)} "
    f"errors={len(errors)} elapsed_s={elapsed:.3f} "
    f"avg_ms={mean(latencies) * 1000 if latencies else 0:.1f} "
    f"p95_ms={p95 * 1000:.1f}"
)
if errors:
    print(errors[:5])
    raise SystemExit(1)
