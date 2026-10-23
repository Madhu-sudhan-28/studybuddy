"""Vercel entrypoint for StudyBuddy's existing HTTP request handler."""

from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from server import StudyBuddyHandler


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
        super().do_GET()

    def do_POST(self):
        self.restore_api_path()
        super().do_POST()
