"""Vercel entrypoint for StudyBuddy's existing HTTP request handler."""

import threading
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from server import StudyBuddyHandler, initialize_database


_database_initialized = False
_database_initialization_lock = threading.Lock()


def ensure_database_initialized():
    global _database_initialized
    if _database_initialized:
        return
    with _database_initialization_lock:
        if not _database_initialized:
            initialize_database()
            _database_initialized = True


class handler(StudyBuddyHandler):
    """Restore the original endpoint path captured by the Vercel rewrite."""

    def restore_api_path(self):
        parsed = urlsplit(self.path)
        query = parse_qsl(parsed.query, keep_blank_values=True)
        route = next((value for key, value in query if key == "__studybuddy_route"), None)
        if route is None:
            return

        remaining_query = [(key, value) for key, value in query if key != "__studybuddy_route"]
        path = "/api/" + route.lstrip("/") if route else "/api"
        self.path = urlunsplit(("", "", path, urlencode(remaining_query, doseq=True), ""))

    def do_GET(self):
        self.restore_api_path()
        path = urlsplit(self.path).path
        if path in {"/api/auth/session", "/api/history"} or path.startswith("/api/history/"):
            ensure_database_initialized()
        super().do_GET()

    def do_POST(self):
        self.restore_api_path()
        path = urlsplit(self.path).path
        if path in {
            "/api/auth/register",
            "/api/auth/login",
            "/api/auth/logout",
            "/api/progress",
            "/api/extract-image",
            "/api/generate-lesson",
            "/api/generate-quiz",
            "/api/explain-part",
        }:
            ensure_database_initialized()
        super().do_POST()
