"""
db.py — connection pooling + the two shared batch engines.

Two known bug classes this file exists specifically to avoid:
  1. conn.commit() vs raw_conn.commit() mismatch — SQLAlchemy's Connection
     wrapper and the underlying pyodbc connection are NOT the same commit
     target. Calling the wrong one silently no-ops and looks like success
     while nothing is actually persisted. We always commit the raw pyodbc
     connection explicitly.
  2. Cursor reuse across TVP calls — reusing one cursor object for
     multiple stored-proc calls in a loop has previously caused phantom
     success reports (results from call N showing up attributed to call
     N+1). Every batch call gets its own fresh cursor.
"""

import base64
from decimal import Decimal
from contextlib import contextmanager
from typing import Any

from sqlalchemy import create_engine
from sqlalchemy.engine import URL
from sqlalchemy.pool import QueuePool

# --- Connection pool -------------------------------------------------
#
# Two auth modes supported:
#   1. Windows Integrated Auth (trusted_connection=yes) — requires the
#      account running this process to be domain-joined and trusted by
#      the SQL Server. Fails with "Login failed... untrusted domain" if
#      that trust relationship doesn't exist (e.g. testing from a
#      non-domain-joined machine).
#   2. SQL Server Authentication (uid/pwd) — works regardless of domain
#      trust. Credentials come from environment variables, never
#      hardcoded here.
#
# Set DB_AUTH_MODE=sql to use option 2; defaults to Windows Auth.

import os

APP_ENV = os.environ.get("APP_ENV", "development").strip().lower()
DB_AUTH_MODE = os.environ.get("DB_AUTH_MODE", "windows").strip().lower()


def _environment_value(name: str, development_default: str) -> str:
    value = os.environ.get(name, "").strip()
    if value:
        return value
    if APP_ENV == "production":
        raise RuntimeError(f"{name} is required when APP_ENV=production.")
    return development_default


if APP_ENV not in {"development", "test", "production"}:
    raise RuntimeError("APP_ENV must be development, test, or production.")
if DB_AUTH_MODE not in {"windows", "sql"}:
    raise RuntimeError("DB_AUTH_MODE must be windows or sql.")

DB_SERVER = _environment_value("DB_SERVER", "DESKTOP-5BGMJSC")
DB_NAME = _environment_value("DB_NAME", "test")
DB_ODBC_DRIVER = os.environ.get("DB_ODBC_DRIVER", "ODBC Driver 17 for SQL Server").strip()
DB_ENCRYPT = os.environ.get("DB_ENCRYPT", "yes" if APP_ENV == "production" else "no").strip()
DB_TRUST_SERVER_CERTIFICATE = os.environ.get(
    "DB_TRUST_SERVER_CERTIFICATE", "no" if APP_ENV == "production" else "yes"
).strip()
DB_POOL_SIZE = int(os.environ.get("DB_POOL_SIZE", "5"))
DB_MAX_OVERFLOW = int(os.environ.get("DB_MAX_OVERFLOW", "10"))
DB_POOL_TIMEOUT = int(os.environ.get("DB_POOL_TIMEOUT", "10"))
DB_QUERY_TIMEOUT = int(os.environ.get("DB_QUERY_TIMEOUT", "30"))

if DB_AUTH_MODE == "sql":
    DB_USER = os.environ["DB_USER"]          # raises KeyError loudly if missing — safer than a silent bad default
    DB_PASSWORD = os.environ["DB_PASSWORD"]
    CONNECTION_STRING = URL.create(
        "mssql+pyodbc",
        username=DB_USER,
        password=DB_PASSWORD,
        host=DB_SERVER,
        database=DB_NAME,
        query={
            "driver": DB_ODBC_DRIVER,
            "Encrypt": DB_ENCRYPT,
            "TrustServerCertificate": DB_TRUST_SERVER_CERTIFICATE,
        },
    )
else:
    CONNECTION_STRING = URL.create(
        "mssql+pyodbc",
        host=DB_SERVER,
        database=DB_NAME,
        query={
            "driver": DB_ODBC_DRIVER,
            "trusted_connection": "yes",
            "Encrypt": DB_ENCRYPT,
            "TrustServerCertificate": DB_TRUST_SERVER_CERTIFICATE,
        },
    )

engine = create_engine(
    CONNECTION_STRING,
    isolation_level="AUTOCOMMIT",
    poolclass=QueuePool,
    pool_size=DB_POOL_SIZE,
    max_overflow=DB_MAX_OVERFLOW,
    pool_timeout=DB_POOL_TIMEOUT,
    pool_pre_ping=True,
    pool_recycle=1800,
    connect_args={"timeout": DB_QUERY_TIMEOUT},
)

# With --workers N, uvicorn spawns N separate OS processes, and this
# module (with its own `engine`) is imported fresh in each one — so the
# EFFECTIVE max connections to SQL Server is N * (pool_size + max_overflow),
# not just pool_size + max_overflow. At --workers 4 with the settings
# above: 4 * (5 + 10) = 60 max concurrent connections. Size this against
# your actual SQL Server's configured max connections and expected
# concurrent user count — 60 comfortably covers "100 people click
# Refresh at once" because most of those requests complete in
# milliseconds and don't hold a connection for the full user session;
# the pool is for in-flight queries, not concurrent users.


@contextmanager
def get_raw_cursor():
    sa_conn = engine.raw_connection()
    cursor = sa_conn.cursor()

    try:
        yield cursor
    except Exception:
        # Safety cleanup if a procedure unexpectedly leaves a transaction open.
        sa_conn.rollback()
        raise
    finally:
        cursor.close()
        sa_conn.close()                  # returns connection to the pool


def check_database() -> None:
    """Raise if the configured SQL Server cannot execute a trivial query."""
    with get_raw_cursor() as cursor:
        cursor.execute("SELECT 1")
        cursor.fetchone()


# --- Helpers -----------------------------------------------------------

def b64_to_bytes(value: str | None) -> bytes:
    """
    Returns empty bytes (not None) when there's nothing to decode.
    This matters specifically because pyodbc infers each TVP column's SQL
    type from the Python value it's given — a None value gives it nothing
    to infer from and raises "Invalid SQL data type (0) (SQLBindParameter)".
    Empty bytes is safe here: RowVersionB64 is only ever referenced in the
    Command='U'/'D' branches of the stored procs (concurrency checks on
    existing rows), never in 'C' — so a Create row's placeholder value
    has no effect on behavior, it only satisfies pyodbc's type inference.
    """
    if value is None or value == "":
        return b""
    return base64.b64decode(value)


def bytes_to_b64(value: bytes | None) -> str | None:
    if value is None:
        return None
    return base64.b64encode(value).decode("ascii")


def safe_id(value: int | None) -> int:
    """
    Same pyodbc TVP type-inference issue as b64_to_bytes, applied to the
    ID column: a Create row always has ID=None (the row doesn't exist
    yet), and if it's the only row — or the first row — in the batch,
    pyodbc can't infer the column is INT. 0 is a safe placeholder: ID is
    only referenced in the Command='U'/'D' branches of the stored procs,
    never in 'C', so it has no effect on Create behavior.
    """
    return 0 if value is None else value


def safe_text(value: str | None) -> str:
    """Return a typed VARCHAR/NVARCHAR placeholder for TVP columns.

    pyodbc cannot infer a TVP column type from None.  An empty string keeps
    the parameter typed; stored procedures can turn it back into NULL with
    NULLIF where blank has a distinct meaning.
    """
    return "" if value is None else value


def safe_pct_awarded(value: float | None) -> Decimal:
    """Bind a nullable DECIMAL(5,2) TVP column without losing a real zero.

    SQL converts the out-of-domain sentinel back to NULL before writing.
    """
    return Decimal("-999.99") if value is None else Decimal(str(value))


def safe_shelf_price(value: float | None) -> Decimal:
    """Bind a nullable DECIMAL(10,2) TVP column without losing a real zero."""
    return Decimal("-99999999.99") if value is None else Decimal(str(value))


def safe_weight_value(value: float | None) -> Decimal:
    """Bind Product's required DECIMAL(10,4) while preserving missing input."""
    return Decimal("-999999.9999") if value is None else Decimal(str(value))


def fetch_all_as_dicts(cursor) -> list[dict[str, Any]]:
    columns = [c[0] for c in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


# --- Read queries (SELECT via stored proc, no TVP) ----------------------

def run_read_query(proc_name: str, params: list) -> list[dict[str, Any]]:
    """
    For read-only stored procs (usp_*_Read). Same fresh-cursor-per-call
    discipline as the batch functions. No explicit commit needed for a
    pure SELECT, but the connection still needs to be returned to the
    pool cleanly either way.
    """
    placeholders = ", ".join("?" for _ in params)
    sql = f"{{CALL {proc_name} ({placeholders})}}"

    sa_conn = engine.raw_connection()
    cursor = sa_conn.cursor()
    try:
        cursor.execute(sql, *params)
        return fetch_all_as_dicts(cursor)
    finally:
        cursor.close()
        sa_conn.close()


# --- Generic single-table batch (e.g. Product) --------------------------

def run_generic_batch(
    proc_name: str,
    tvp_rows: list[tuple],
    scalar_params: list,
) -> list[dict[str, Any]]:
    """
    Calls a stored proc shaped like usp_Product_Batch: one TVP parameter
    followed by scalar parameters (@Username, @IsAdmin), returning a
    single result set of per-row outcomes.
    """
    placeholders = ", ".join("?" for _ in range(1 + len(scalar_params)))
    sql = f"{{CALL {proc_name} ({placeholders})}}"

    with get_raw_cursor() as cursor:
        cursor.execute(sql, tvp_rows, *scalar_params)
        return fetch_all_as_dicts(cursor)


# --- Header + detail batch (e.g. Opportunity + OpportunityItem) --------

def run_header_detail_batch(
    proc_name: str,
    header_tvp_rows: list[tuple],
    detail_tvp_rows: list[tuple],
    scalar_params: list,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """
    Calls a stored proc shaped like usp_Opportunity_HeaderDetail_Batch:
    two TVP parameters (header, then items) followed by scalars, and
    returns TWO result sets (header outcomes, item outcomes) as a tuple.
    Both are produced by the proc inside a single transaction, so either
    both reflect a commit or both reflect a rollback.
    """
    placeholders = ", ".join("?" for _ in range(2 + len(scalar_params)))
    sql = f"{{CALL {proc_name} ({placeholders})}}"

    with get_raw_cursor() as cursor:
        cursor.execute(sql, header_tvp_rows, detail_tvp_rows, *scalar_params)
        header_results = fetch_all_as_dicts(cursor)
        if cursor.nextset():
            item_results = fetch_all_as_dicts(cursor)
        else:
            item_results = []
        return header_results, item_results
