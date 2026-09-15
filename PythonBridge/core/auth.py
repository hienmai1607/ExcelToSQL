"""Request-scoped identity and authorization context.

Modes:
  local_windows (default): trust the Windows account running the local bridge;
  trusted_proxy: accept an identity only from a proxy that supplies the shared
    internal secret and X-Authenticated-User after Windows/JWT authentication;
  development_header: explicitly insecure local testing with X-User-Name.
"""

from dataclasses import dataclass
import getpass
import os
import secrets

from fastapi import Depends, Header, HTTPException

from db import get_raw_cursor


@dataclass(frozen=True)
class AccessContext:
    user_id: int
    username: str
    scopes: frozenset[str]

    @property
    def is_admin(self) -> bool:
        return "Admin" in self.scopes


def _presented_username(
    x_user_name: str | None,
    x_authenticated_user: str | None,
    x_proxy_secret: str | None,
) -> str:
    mode = os.environ.get("AUTH_MODE", "local_windows").strip().lower()
    if mode == "local_windows":
        return getpass.getuser().strip()
    if mode == "trusted_proxy":
        expected = os.environ.get("AUTH_PROXY_SECRET", "")
        if not expected or not x_proxy_secret or not secrets.compare_digest(x_proxy_secret, expected):
            raise HTTPException(status_code=401, detail="Trusted authentication proxy is required.")
        return (x_authenticated_user or "").strip().split("\\")[-1]
    if mode == "development_header":
        return (x_user_name or "").strip()
    raise HTTPException(status_code=500, detail="Server authentication mode is invalid.")


def get_access_context(
    x_user_name: str | None = Header(default=None),
    x_authenticated_user: str | None = Header(default=None),
    x_proxy_secret: str | None = Header(default=None),
) -> AccessContext:
    username = _presented_username(x_user_name, x_authenticated_user, x_proxy_secret)
    if not username:
        raise HTTPException(status_code=401, detail="Username is incorrect.")

    with get_raw_cursor() as cursor:
        cursor.execute(
            """
            SELECT u.ID,u.UserName,a.Scope
            FROM dbo.Users AS u
            LEFT JOIN dbo.UserAccess AS a ON a.UserID=u.ID
            WHERE u.UserName=? AND u.IsActive=1
            """,
            username,
        )
        rows = cursor.fetchall()
    if not rows:
        raise HTTPException(status_code=401, detail="Username is incorrect.")
    return AccessContext(
        user_id=int(rows[0][0]),
        username=str(rows[0][1]),
        scopes=frozenset(str(row[2]) for row in rows if row[2] is not None),
    )


def get_current_username(context: AccessContext = Depends(get_access_context)) -> str:
    return context.username


def get_is_admin(context: AccessContext = Depends(get_access_context)) -> bool:
    return context.is_admin


def get_user_scopes(context: AccessContext = Depends(get_access_context)) -> frozenset[str]:
    return context.scopes
