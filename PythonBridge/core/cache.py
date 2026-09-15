"""
cache.py — a small in-memory TTL cache for shared master-data lookups.

Why: with --workers 4, every worker is a separate OS process with its
own memory, so this cache is per-process, not truly shared. Even so, it
cuts DB round-trips by up to ~Nx during a burst (100 people clicking
Refresh within the same few seconds mostly land on a warm cache instead
of each issuing a fresh query). For a fully shared cache across workers,
swap this for Redis — not necessary at this scale, but noted as the
next step if worker count grows significantly.

Market/Currency and the Customer/Opportunity dropdown datasets change
infrequently and are shared by many users, which is exactly the profile
that benefits most from caching. Paginated Product/Customer/Opportunity
grid reads remain uncached because their filters and pages vary.
"""

import time
import threading
from typing import Any, Callable

_lock = threading.Lock()
_store: dict[str, tuple[float, Any]] = {}


def cached(key: str, ttl_seconds: float, loader: Callable[[], Any]) -> Any:
    now = time.monotonic()
    with _lock:
        entry = _store.get(key)
        if entry is not None:
            expires_at, value = entry
            if now < expires_at:
                return value

    # Recompute outside the lock — worst case a few concurrent callers
    # all recompute once during the same expiry window, which is fine;
    # never worth serializing all requests behind a single DB call.
    value = loader()
    with _lock:
        _store[key] = (now + ttl_seconds, value)
    return value


def invalidate(key: str) -> None:
    with _lock:
        _store.pop(key, None)
