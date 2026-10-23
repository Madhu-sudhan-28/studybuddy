import base64
from contextlib import contextmanager
import hashlib
import hmac
import json
import os
import random
import re
import secrets
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parent
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_REQUEST_BYTES = MAX_IMAGE_BYTES * 4 // 3 + 1024 * 1024
MAX_LESSON_REQUEST_BYTES = 1024 * 1024
MAX_STUDY_TEXT_CHARS = 200_000
SUPPORTED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_QUIZ_TOPICS = 500
AI_MODEL = "qwen/qwen3.8-27b"
VISION_MODEL = "qwen/qwen3.8-27b"
AI_URL = "https://api.groq.com/openai/v1/chat/completions"
API_KEY_NAME = "GROQ_API_KEY"
MAX_REQUEST_OUTPUT_TOKENS = 6000
MAX_LESSON_OUTPUT_TOKENS = 1400
MAX_FOLLOW_UP_OUTPUT_TOKENS = 700
MAX_FOLLOW_UP_QUESTION_CHARS = 2000
MAX_IMAGE_OUTPUT_TOKENS = 1800
ENV_FILE = ROOT / ".env"
DATABASE_URL_NAME = "DATABASE_URL"
AUTH_COOKIE = "studybuddy_session"
SESSION_TTL_SECONDS = 30 * 24 * 60 * 60
MAX_PROGRESS_BYTES = 8 * 1024 * 1024
PASSWORD_ITERATIONS = 310_000


@contextmanager
def database_connection():
    database_url = os.environ.get(DATABASE_URL_NAME, "").strip()
    if not database_url:
        raise RuntimeError("DATABASE_URL is required. Set your Supabase PostgreSQL connection URI in .env.")
    try:
        import psycopg
        from psycopg.rows import dict_row
    except ImportError as error:
        raise RuntimeError("The PostgreSQL driver is missing. Install dependencies with: pip install -r requirements.txt") from error
    connection = psycopg.connect(database_url, row_factory=dict_row, connect_timeout=10)
    try:
        yield DatabaseConnection(connection)
    except Exception:
        connection.rollback()
        raise
    else:
        connection.commit()
    finally:
        connection.close()


def is_database_integrity_error(error):
    try:
        import psycopg
        return isinstance(error, psycopg.IntegrityError)
    except ImportError:
        return False


def is_database_connection_error(error):
    try:
        import psycopg
        return isinstance(error, psycopg.OperationalError)
    except ImportError:
        return False


class DatabaseConnection:
    """Adapt the server's parameter markers to PostgreSQL's DB-API syntax."""

    def __init__(self, connection):
        self.connection = connection

    def execute(self, query, parameters=()):
        return self.connection.execute(query.replace("?", "%s"), parameters)

    def executescript(self, script):
        for statement in script.split(";"):
            if statement.strip():
                self.execute(statement)

    def commit(self):
        return self.connection.commit()

    def rollback(self):
        return self.connection.rollback()

    def close(self):
        return self.connection.close()


def initialize_database():
    with database_connection() as connection:
        id_type = "BIGSERIAL PRIMARY KEY"
        user_id_type = "BIGINT"
        email_constraint = "TEXT NOT NULL UNIQUE"
        connection.executescript(f"""
            CREATE TABLE IF NOT EXISTS users (
                id {id_type},
                email {email_constraint},
                password_hash TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS login_sessions (
                token_hash TEXT PRIMARY KEY,
                user_id {user_id_type} NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS login_sessions_user_id ON login_sessions(user_id);
            CREATE TABLE IF NOT EXISTS study_progress (
                user_id {user_id_type} PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                progress_json TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS study_history (
                id {id_type},
                user_id {user_id_type} NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                plan_id TEXT NOT NULL,
                progress_json TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                UNIQUE(user_id, plan_id)
            );
            CREATE INDEX IF NOT EXISTS study_history_user_created ON study_history(user_id, created_at DESC);
        """)


def hash_password(password, salt=None):
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS)
    return salt.hex() + "$" + digest.hex()


def verify_password(password, stored):
    try:
        salt_hex, _ = stored.split("$", 1)
        return hmac.compare_digest(hash_password(password, bytes.fromhex(salt_hex)), stored)
    except (ValueError, TypeError):
        return False


def session_token_from(handler):
    for cookie in handler.headers.get("Cookie", "").split(";"):
        name, separator, value = cookie.strip().partition("=")
        if separator and name == AUTH_COOKIE:
            return value
    return ""


def authenticated_user(handler):
    token = session_token_from(handler)
    if not token:
        return None
    token_hash = hashlib.sha256(token.encode("ascii", errors="ignore")).hexdigest()
    now = int(time.time())
    with database_connection() as connection:
        connection.execute("DELETE FROM login_sessions WHERE expires_at <= ?", (now,))
        return connection.execute(
            "SELECT users.id, users.email FROM login_sessions JOIN users ON users.id = login_sessions.user_id "
            "WHERE token_hash = ? AND expires_at > ?", (token_hash, now),
        ).fetchone()


def set_session_cookie(handler, token, max_age=SESSION_TTL_SECONDS):
    secure = "; Secure" if handler.headers.get("X-Forwarded-Proto", "").split(",")[0].strip() == "https" else ""
    handler.send_header("Set-Cookie", f"{AUTH_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}{secure}")


def origin_is_same_site(handler):
    origin = handler.headers.get("Origin")
    host = handler.headers.get("Host", "")
    parsed = urllib.parse.urlsplit(origin or "")
    return parsed.scheme in {"http", "https"} and parsed.netloc.casefold() == host.casefold()


def lesson_detail_profile(minutes):
    return MAX_LESSON_OUTPUT_TOKENS


IMAGE_PROMPT = (
    "Inspect the entire image and decide whether its useful content is mainly printed text, visual material, "
    "or both. Return JSON only with exactly these keys: kind, text, visualExplanation. kind must be text, "
    "visual, mixed, or none. Use text for a syllabus, notes, or other mainly textual source: put a faithful "
    "transcription in text and leave visualExplanation empty. Preserve the actual printed title, headings, "
    "module/subsection hierarchy, bullets, wording, and reading order. For joined page fragments, scan every "
    "region and column, continue across page breaks, and include the lower part and final visible module. "
    "Do not repeat overlapping/cropped duplicates. Transcribe visible portions of cut-off lines and mark only "
    "missing words [cropped/unclear]; never guess them. Do not invent labels such as 'main content', "
    "'cropped content', or 'lower section', and omit obvious page numbers and repeated page headers/footers. "
    "Use visual for diagrams, flowcharts, charts, photos, people, or objects without substantial prose: put "
    "only visible labels/captions in text and explain the meaningful visual content in visualExplanation. "
    "Use mixed when both printed text and visual information matter: transcribe the printed content in text "
    "and explain the visual relationships separately in visualExplanation. For diagrams explain parts, arrows, "
    "sequence, branches, inputs, outputs, and relationships; for charts explain axes, units, trends, and "
    "comparisons; for scenes describe visible people, objects, actions, and spatial relationships. Explain a "
    "person's name or background only when readable source text provides it; otherwise do not guess identity, "
    "biography, private traits, or unseen context. Keep explanations factual, concise, and grounded in the image. "
    "Use none only for a blank or content-free image. Do not put commentary or an explanation in text."
)

def clean_image_study_text(text):
    cleaned = text
    cleaned = re.sub(r"[ \t]+\n", "\n", cleaned)
    cleaned = re.sub(r"\n[ \t]+", "\n", cleaned)
    cleaned = re.sub(r"\n{2,}", "\n", cleaned)
    return re.sub(r"[ \t]{2,}", " ", cleaned).strip()


def load_local_env():
    if not ENV_FILE.exists():
        return
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        entry = line.strip()
        if not entry or entry.startswith("#") or "=" not in entry:
            continue
        name, value = entry.split("=", 1)
        name = name.strip()
        value = value.strip().strip("'\"")
        if name in {API_KEY_NAME, DATABASE_URL_NAME} and value:
            if name != API_KEY_NAME or value != "paste-your-groq-api-key-here":
                os.environ.setdefault(name, value)


def get_api_key():
    return os.environ.get(API_KEY_NAME, "").strip()


def send_json(handler, status, payload, headers=None):
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    for name, value in (headers or {}).items():
        handler.send_header(name, value)
    handler.end_headers()
    try:
        handler.wfile.write(body)
    except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
        return


class AIProviderError(RuntimeError):
    def __init__(self, message, status):
        super().__init__(message)
        self.status = status


def request_ai(messages, api_key, purpose, max_tokens, response_format=None, model=AI_MODEL, reasoning_effort=None):
    payload = {
        "model": model,
        "messages": messages,
        "stream": False,
        "max_completion_tokens": min(max_tokens, MAX_REQUEST_OUTPUT_TOKENS),
        "temperature": 1,
        "top_p": 1,
        "frequency_penalty": 0,
        "presence_penalty": 0,
    }
    if response_format:
        payload["response_format"] = response_format
    if reasoning_effort:
        payload["reasoning_effort"] = reasoning_effort
    request = urllib.request.Request(
        AI_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as error:
        try:
            details = json.loads(error.read()).get("error", {}).get("message", "")
        except (json.JSONDecodeError, AttributeError):
            details = ""
        raise AIProviderError(details or f"Groq {purpose} failed (HTTP {error.code}).", error.code) from error
    except TimeoutError as error:
        raise AIProviderError(
            "Groq took too long to respond. Its model service may be busy; please try again.",
            504,
        ) from error
    except urllib.error.URLError as error:
        if isinstance(error.reason, TimeoutError):
            raise AIProviderError(
                "Groq took too long to respond. Its model service may be busy; please try again.",
                504,
            ) from error
        raise RuntimeError("Could not reach Groq. Check your internet connection and try again.") from error
    except json.JSONDecodeError as error:
        raise RuntimeError("Groq returned an unreadable response. Please try again.") from error


def get_ai_text(model_response, purpose):
    if not isinstance(model_response, dict):
        raise RuntimeError(f"Groq returned an invalid response for {purpose}. Please try again.")
    try:
        choices = model_response.get("choices", [])
        content = choices[0].get("message", {}).get("content", "") if choices else ""
        if isinstance(content, list):
            text = "\n".join(
                part.get("text", "")
                for part in content
                if isinstance(part, dict) and isinstance(part.get("text"), str)
            ).strip()
        else:
            text = content.strip() if isinstance(content, str) else ""
    except (AttributeError, IndexError, TypeError):
        text = ""
    if not text:
        error = model_response.get("error") or {}
        if error.get("message"):
            raise RuntimeError(error["message"])
        raise RuntimeError(f"Groq did not return {purpose}. Please try again.")
    return text


def parse_lesson_json(text):
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned, flags=re.IGNORECASE)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start < 0 or end <= start:
            raise
        return json.loads(cleaned[start : end + 1])


def validate_lesson_visual(visual):
    if visual is None:
        return None, None
    if not isinstance(visual, dict) or not isinstance(visual.get("title"), str) or not visual["title"].strip():
        return None, "The lesson is ready, but its visual guide was incomplete and has been omitted."
    if visual.get("kind") == "flowchart":
        steps = visual.get("steps")
        if isinstance(steps, list) and 3 <= len(steps) <= 7 and all(
            isinstance(step, dict)
            and isinstance(step.get("title"), str)
            and step["title"].strip()
            and isinstance(step.get("detail"), str)
            and step["detail"].strip()
            for step in steps
        ):
            return visual, None
        return None, "The lesson is ready, but its flowchart was incomplete and has been omitted."
    if visual.get("kind") == "concept-map":
        center = visual.get("center")
        branches = visual.get("branches")
        if (
            isinstance(center, dict)
            and isinstance(center.get("title"), str)
            and center["title"].strip()
            and isinstance(center.get("detail"), str)
            and center["detail"].strip()
            and isinstance(branches, list)
            and 3 <= len(branches) <= 6
            and all(
                isinstance(branch, dict)
                and all(
                    isinstance(branch.get(field), str) and branch[field].strip()
                    for field in ("title", "relation", "detail")
                )
                for branch in branches
            )
        ):
            return visual, None
        return None, "The lesson is ready, but its concept map was incomplete and has been omitted."
    return None, "The lesson is ready, but it returned a visual format StudyBuddy cannot display, so the visual guide was omitted."


class StudyBuddyHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        request_path = urllib.parse.urlsplit(self.path).path
        decoded_path = urllib.parse.unquote(request_path).replace("\\", "/")
        if any(
            part.casefold() == ".env"
            or part.casefold().endswith((".sqlite", ".sqlite3", ".sqlite3-wal", ".sqlite3-shm", ".db"))
            for part in decoded_path.split("/")
        ):
            send_json(self, 404, {"error": "Not found."})
            return
        if request_path == "/api/auth/session":
            user = authenticated_user(self)
            progress = None
            with database_connection() as connection:
                has_accounts = connection.execute("SELECT EXISTS(SELECT 1 FROM users) AS present").fetchone()["present"]
                if user:
                    row = connection.execute("SELECT progress_json FROM study_progress WHERE user_id = ?", (user["id"],)).fetchone()
                if user and row:
                    try:
                        progress = json.loads(row["progress_json"])
                    except json.JSONDecodeError:
                        progress = None
            send_json(self, 200, {"authenticated": bool(user), "hasAccounts": has_accounts, "user": {"email": user["email"]} if user else None, "progress": progress})
            return
        if request_path == "/api/history":
            user = authenticated_user(self)
            if not user:
                send_json(self, 401, {"error": "Sign in to view your study history."})
                return
            with database_connection() as connection:
                rows = connection.execute(
                    "SELECT id, progress_json, created_at FROM study_history WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50",
                    (user["id"],),
                ).fetchall()
            items = []
            for row in rows:
                try:
                    progress = json.loads(row["progress_json"])
                except json.JSONDecodeError:
                    continue
                topics = progress.get("topics") if isinstance(progress.get("topics"), list) else []
                first_title = topics[0].get("title") if topics and isinstance(topics[0], dict) else ""
                material = progress.get("material") if isinstance(progress.get("material"), str) else ""
                title = first_title or next((line.strip() for line in material.splitlines() if line.strip()), "Study plan")
                items.append({"id": row["id"], "title": title[:100], "createdAt": row["created_at"]})
            send_json(self, 200, {"items": items})
            return
        history_match = re.fullmatch(r"/api/history/(\d+)", request_path)
        if history_match:
            user = authenticated_user(self)
            if not user:
                send_json(self, 401, {"error": "Sign in to view your study history."})
                return
            with database_connection() as connection:
                row = connection.execute(
                    "SELECT progress_json FROM study_history WHERE id = ? AND user_id = ?",
                    (int(history_match.group(1)), user["id"]),
                ).fetchone()
            if not row:
                send_json(self, 404, {"error": "That saved study plan could not be found."})
                return
            try:
                send_json(self, 200, {"progress": json.loads(row["progress_json"])})
            except json.JSONDecodeError:
                send_json(self, 500, {"error": "That saved study plan could not be read."})
            return
        if request_path == "/api/status":
            configured = bool(get_api_key())
            send_json(
                self,
                200,
                {
                    "provider": "groq",
                    "visionAvailable": configured,
                    "aiAvailable": configured,
                    "aiConfigured": configured,
                },
            )
            return
        super().do_GET()

    def read_json_body(self, max_bytes=MAX_PROGRESS_BYTES):
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ValueError("The request size is invalid.")
        if content_length <= 0 or content_length > max_bytes:
            raise ValueError("The request is empty or too large.")
        try:
            payload = json.loads(self.rfile.read(content_length))
        except json.JSONDecodeError as error:
            raise ValueError("The request data is invalid.") from error
        if not isinstance(payload, dict):
            raise ValueError("The request data is invalid.")
        return payload

    def register_account(self):
        try:
            payload = self.read_json_body(4096)
            raw_email = payload.get("email", "")
            email = raw_email.strip().casefold() if isinstance(raw_email, str) else ""
            password = payload.get("password", "")
            if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or len(email) > 254:
                raise ValueError("Enter a valid email address.")
            if not isinstance(password, str) or len(password) < 10 or len(password) > 256:
                raise ValueError("Use a password between 10 and 256 characters.")
            now = int(time.time())
            with database_connection() as connection:
                cursor = connection.execute(
                    "INSERT INTO users(email, password_hash, created_at) VALUES (?, ?, ?) RETURNING id",
                    (email, hash_password(password), now),
                )
                user_id = cursor.fetchone()["id"]
                token = secrets.token_urlsafe(32)
                connection.execute(
                    "INSERT INTO login_sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)",
                    (hashlib.sha256(token.encode()).hexdigest(), user_id, now + SESSION_TTL_SECONDS),
                )
            send_json(self, 201, {"user": {"email": email}}, {"Set-Cookie": self.session_cookie_value(token)})
        except Exception as error:
            if is_database_integrity_error(error):
                send_json(self, 409, {"error": "An account with that email already exists. Sign in instead."})
            elif isinstance(error, ValueError):
                send_json(self, 400, {"error": str(error)})
            elif is_database_connection_error(error):
                print("Account registration could not connect to the database.", file=sys.stderr)
                send_json(self, 503, {"error": "StudyBuddy can't reach its database right now. Please try again shortly."})
            else:
                raise

    def session_cookie_value(self, token, max_age=SESSION_TTL_SECONDS):
        secure = "; Secure" if self.headers.get("X-Forwarded-Proto", "").split(",")[0].strip() == "https" else ""
        return f"{AUTH_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}{secure}"

    def login_account(self):
        try:
            payload = self.read_json_body(4096)
            raw_email = payload.get("email", "")
            email = raw_email.strip().casefold() if isinstance(raw_email, str) else ""
            password = payload.get("password", "")
            if not isinstance(password, str) or len(password) > 256:
                raise ValueError("Enter your email and password.")
            with database_connection() as connection:
                user = connection.execute("SELECT id, email, password_hash FROM users WHERE email = ?", (email,)).fetchone()
                if not user:
                    send_json(self, 401, {"error": "No account was found for that email. Check the address or create an account."})
                    return
                if not verify_password(password, user["password_hash"]):
                    send_json(self, 401, {"error": "That password is incorrect. Please try again."})
                    return
                now = int(time.time())
                token = secrets.token_urlsafe(32)
                connection.execute(
                    "INSERT INTO login_sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)",
                    (hashlib.sha256(token.encode()).hexdigest(), user["id"], now + SESSION_TTL_SECONDS),
                )
            send_json(self, 200, {"user": {"email": user["email"]}}, {"Set-Cookie": self.session_cookie_value(token)})
        except Exception as error:
            if isinstance(error, ValueError):
                send_json(self, 400, {"error": str(error)})
            elif is_database_connection_error(error):
                print("Account sign-in could not connect to the database.", file=sys.stderr)
                send_json(self, 503, {"error": "StudyBuddy can't reach its database right now. Please try again shortly."})
            else:
                raise

    def logout_account(self):
        token = session_token_from(self)
        if token:
            token_hash = hashlib.sha256(token.encode("ascii", errors="ignore")).hexdigest()
            with database_connection() as connection:
                connection.execute("DELETE FROM login_sessions WHERE token_hash = ?", (token_hash,))
        send_json(self, 200, {"ok": True}, {"Set-Cookie": self.session_cookie_value("", 0)})

    def save_progress(self):
        user = authenticated_user(self)
        if not user:
            send_json(self, 401, {"error": "Sign in to save your progress."})
            return
        try:
            payload = self.read_json_body()
            progress = payload.get("progress")
            if not isinstance(progress, dict):
                raise ValueError("The study progress is invalid.")
            progress_json = json.dumps(progress, separators=(",", ":"))
            if len(progress_json.encode("utf-8")) > MAX_PROGRESS_BYTES:
                raise ValueError("This study plan is too large to save.")
            now = int(time.time())
            saved_at = progress.get("savedAt")
            if not isinstance(saved_at, int) or saved_at < 0:
                saved_at = int(time.time() * 1000)
            with database_connection() as connection:
                previous = connection.execute(
                    "SELECT progress_json, updated_at FROM study_progress WHERE user_id = ?",
                    (user["id"],),
                ).fetchone()
                archived = False
                if previous and saved_at >= previous["updated_at"]:
                    try:
                        previous_progress = json.loads(previous["progress_json"])
                    except json.JSONDecodeError:
                        previous_progress = {}
                    previous_plan_id = previous_progress.get("planId")
                    next_plan_id = progress.get("planId")
                    if previous_plan_id and next_plan_id and previous_plan_id != next_plan_id:
                        connection.execute(
                            "INSERT INTO study_history(user_id, plan_id, progress_json, created_at) VALUES (?, ?, ?, ?) "
                            "ON CONFLICT(user_id, plan_id) DO UPDATE SET progress_json=excluded.progress_json, created_at=excluded.created_at",
                            (user["id"], previous_plan_id, previous["progress_json"], now),
                        )
                        archived = True
                connection.execute(
                    "INSERT INTO study_progress(user_id, progress_json, updated_at) VALUES (?, ?, ?) "
                    "ON CONFLICT(user_id) DO UPDATE SET progress_json=excluded.progress_json, updated_at=excluded.updated_at "
                    "WHERE excluded.updated_at >= study_progress.updated_at",
                    (user["id"], progress_json, saved_at),
                )
                connection.execute(
                    "UPDATE login_sessions SET expires_at = ? WHERE token_hash = ?",
                    (now + SESSION_TTL_SECONDS, hashlib.sha256(session_token_from(self).encode("ascii", errors="ignore")).hexdigest()),
                )
            send_json(self, 200, {"ok": True, "archived": archived})
        except ValueError as error:
            send_json(self, 400, {"error": str(error)})

    def do_POST(self):
        path = urllib.parse.urlsplit(self.path).path
        if path in {"/api/auth/register", "/api/auth/login", "/api/auth/logout", "/api/progress"}:
            if not origin_is_same_site(self):
                send_json(self, 403, {"error": "This request must come from the StudyBuddy site."})
                return
            if path == "/api/auth/register":
                self.register_account()
            elif path == "/api/auth/login":
                self.login_account()
            elif path == "/api/auth/logout":
                self.logout_account()
            else:
                self.save_progress()
            return
        if path not in {"/api/extract-image", "/api/generate-lesson", "/api/generate-quiz", "/api/explain-part"}:
            send_json(self, 404, {"error": "Endpoint not found."})
            return

        origin = self.headers.get("Origin")
        host = self.headers.get("Host", "")
        parsed_origin = urllib.parse.urlsplit(origin or "")
        if not origin_is_same_site(self):
            send_json(self, 403, {"error": "This request must come from the StudyBuddy site."})
            return
        if not authenticated_user(self):
            send_json(self, 401, {"error": "Sign in to use StudyBuddy's study tools."})
            return

        api_key = get_api_key()
        if not api_key:
            send_json(
                self,
                503,
                {
                    "error": "Groq is not configured. Add GROQ_API_KEY=your-key to the .env file, then restart StudyBuddy."
                },
            )
            return

        if path == "/api/generate-lesson":
            self.generate_lesson(api_key)
            return
        if path == "/api/generate-quiz":
            self.generate_quiz(api_key)
            return
        if path == "/api/explain-part":
            self.explain_part(api_key)
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            send_json(self, 400, {"error": "The image request size is invalid."})
            return
        if content_length <= 0 or content_length > MAX_REQUEST_BYTES:
            send_json(self, 413, {"error": "That image is too large. Choose an image under 10 MB."})
            return

        try:
            request_data = json.loads(self.rfile.read(content_length))
            data_url = request_data.get("image", "")
            match = re.fullmatch(
                r"data:(image/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})",
                data_url,
            )
            if not match:
                raise ValueError("Choose a supported image file.")
            image_type, encoded_image = match.groups()
            if image_type not in SUPPORTED_IMAGE_TYPES:
                raise ValueError(
                    "This image format could not be converted by your browser. Try PNG, JPEG, WebP, or GIF."
                )
            image_bytes = base64.b64decode(encoded_image, validate=True)
            if not image_bytes or len(image_bytes) > MAX_IMAGE_BYTES:
                raise ValueError("Choose an image under 10 MB.")
        except (json.JSONDecodeError, AttributeError, TypeError, ValueError) as error:
            send_json(self, 400, {"error": str(error) or "The image request is invalid."})
            return

        encoded_image = base64.b64encode(image_bytes).decode("ascii")
        image_data_url = f"data:{image_type};base64,{encoded_image}"
        content = [
            {"type": "text", "text": IMAGE_PROMPT},
            {"type": "image_url", "image_url": {"url": image_data_url, "detail": "high"}},
        ]
        try:
            model_response = request_ai(
                [{"role": "user", "content": content}],
                api_key,
                "image analysis",
                MAX_IMAGE_OUTPUT_TOKENS,
                response_format={"type": "json_object"},
                model=VISION_MODEL,
            )
            analysis = json.loads(get_ai_text(model_response, "image analysis"))
            kind = analysis.get("kind") if isinstance(analysis, dict) else None
            if kind not in {"text", "visual", "mixed", "none"}:
                raise ValueError("The image analysis was incomplete. Please try again.")
            text = clean_image_study_text(analysis.get("text", "")) if isinstance(analysis.get("text"), str) else ""
            visual_explanation = clean_image_study_text(analysis.get("visualExplanation", "")) if isinstance(analysis.get("visualExplanation"), str) else ""
        except RuntimeError as error:
            print(f"Groq image analysis failed: {error}", file=sys.stderr)
            status = error.status if isinstance(error, AIProviderError) else 502
            send_json(self, status, {"error": str(error)})
            return
        except (json.JSONDecodeError, AttributeError, TypeError, ValueError) as error:
            print(f"Image analysis returned an incomplete result: {error}", file=sys.stderr)
            send_json(self, 502, {"error": "The image could not be understood. Please try again."})
            return

        if kind == "none" or (not text and not visual_explanation):
            send_json(self, 200, {"kind": "none", "text": "", "visualExplanation": ""})
            return
        send_json(self, 200, {"kind": kind, "text": text, "visualExplanation": visual_explanation})

    def generate_quiz(self, api_key):
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            send_json(self, 400, {"error": "The quiz request size is invalid."})
            return
        if content_length <= 0 or content_length > MAX_LESSON_REQUEST_BYTES:
            send_json(self, 413, {"error": "The quiz material is too large. Create a plan with fewer or smaller topics."})
            return
        try:
            request_data = json.loads(self.rfile.read(content_length))
            topics = request_data.get("topics")
            if not isinstance(topics, list) or not 1 <= len(topics) <= MAX_QUIZ_TOPICS:
                raise ValueError(f"The quiz needs between 1 and {MAX_QUIZ_TOPICS} learned topics.")
            quiz_mode = request_data.get("mode", "initial")
            if quiz_mode not in {"initial", "revision", "single", "problem"}:
                raise ValueError("The quiz mode is invalid.")
            expected_count = len(topics) + 1 if quiz_mode == "initial" else 1 if quiz_mode in {"single", "problem"} else request_data.get("questionCount")
            if (
                isinstance(expected_count, bool)
                or not isinstance(expected_count, int)
                or not 1 <= expected_count <= MAX_QUIZ_TOPICS + (1 if quiz_mode == "initial" else 0)
                or (quiz_mode == "revision" and expected_count != len(topics))
                or (quiz_mode in {"single", "problem"} and (len(topics) != 1 or request_data.get("questionCount") != 1))
                or (quiz_mode == "initial" and request_data.get("questionCount") != expected_count)
            ):
                raise ValueError("The follow-up quiz must have one question for each reviewed topic.")
            quiz_topics = []
            for index, item in enumerate(topics):
                if not isinstance(item, dict) or not isinstance(item.get("title"), str):
                    raise ValueError("A quiz topic is invalid. Rebuild your study plan.")
                source_index = item.get("topicIndex", index)
                if isinstance(source_index, bool) or not isinstance(source_index, int) or not 0 <= source_index < MAX_QUIZ_TOPICS:
                    raise ValueError("A quiz topic index is invalid. Rebuild your study plan.")
                lesson = item.get("lesson")
                if not isinstance(lesson, dict):
                    if quiz_mode not in {"single", "problem", "revision"} or not isinstance(item.get("content"), str) or not item["content"].strip():
                        raise ValueError("Complete each lesson before starting the quiz.")
                    lesson = {}
                sections = lesson.get("detailedSections", [])
                if not sections and isinstance(item.get("content"), str) and item["content"].strip():
                    sections = [{"heading": "Topic notes", "content": item["content"][:400]}]
                key_points = lesson.get("keyPoints", [])
                key_terms = lesson.get("keyTerms", [])
                if not isinstance(sections, list) or not isinstance(key_points, list) or not isinstance(key_terms, list):
                    raise ValueError("A lesson is incomplete. Reopen the lesson before starting the quiz.")
                quiz_topics.append({
                    "topicIndex": source_index,
                    "title": item["title"][:120],
                    "explanation": str(lesson.get("explanation", "") or item.get("content", ""))[:500],
                    "sections": [
                        {
                            "heading": str(section.get("heading", ""))[:100],
                            "content": str(section.get("content", ""))[:400],
                        }
                        for section in sections[:3]
                        if isinstance(section, dict)
                    ],
                    "keyPoints": [str(point)[:180] for point in key_points[:4]],
                    "keyTerms": [
                        {"term": str(term.get("term", ""))[:80], "definition": str(term.get("definition", ""))[:160]}
                        for term in key_terms[:4]
                        if isinstance(term, dict)
                    ],
                    "workedExample": str(lesson.get("workedExample", ""))[:400],
                })
            if quiz_mode == "revision" and len({topic["topicIndex"] for topic in quiz_topics}) != len(quiz_topics):
                raise ValueError("A follow-up quiz cannot repeat a reviewed topic.")
        except (json.JSONDecodeError, AttributeError, TypeError, ValueError) as error:
            send_json(self, 400, {"error": str(error) or "The quiz request is invalid."})
            return

        if quiz_mode == "revision":
            prompt = (
                "Write a focused follow-up quiz using only the supplied lesson summaries for topics "
                "the learner just reviewed. Return exactly one new multiple-choice question for each "
                "supplied topic in the current batch, in topic order, with no applied problem. This quiz checks whether the "
                "learner understood the explanations, so test the underlying concept with a fresh question "
                "that is not copied from an earlier quiz question. Assign each question the zero-based "
                "topicIndex shown in its supplied lesson. "
            )
        elif quiz_mode == "single":
            prompt = (
                "Write exactly one useful multiple-choice question from the one supplied lesson. Test its "
                "main idea or an important detail and assign the supplied zero-based topicIndex. "
            )
        elif quiz_mode == "problem":
            prompt = "Write exactly one applied scenario question based only on the one supplied lesson. "
        else:
            prompt = (
                "Write a useful exam-style assessment using only the supplied StudyBuddy lesson summaries. "
                "Write one multiple-choice question for every supplied topic in the current batch, in topic order. "
            )
        if quiz_mode in {"revision", "single"}:
            prompt += (
                "Write a direct, specific question about the lesson's concepts, facts, mechanisms, examples, "
                "or trade-offs. Never use meta-questions or generic filler. Give four distinct options: exactly "
                "one correct answer and three plausible distractors grounded in the lesson. Keep the question "
                "under 24 words, each option under 14 words, and the explanation to one clear sentence under "
                "24 words. The app shuffles the correct-option position. "
            )
        elif quiz_mode == "initial":
            prompt += (
                "For each lesson question, write a direct, specific question under 24 words with four distinct "
                "options: exactly one correct answer and three plausible distractors. Keep each option under 14 "
                "words and each explanation under 24 words. The final applied scenario is also multiple choice, "
                "with a scenario prompt under 45 words and an explanation showing the key steps in under 45 words. "
                "Never use meta-questions or generic filler. The app shuffles the correct-option position. "
            )
        elif quiz_mode == "problem":
            prompt += (
                "Make the scenario concrete and specific. Give four distinct options: exactly one correct answer "
                "and three plausible distractors grounded in the lesson. Keep the scenario prompt under 45 words, "
                "each option under 14 words, and the explanation with key steps under 45 words. "
                "The app shuffles the correct-option position. "
            )
        if quiz_mode in {"initial", "problem"}:
            prompt += (
                "For the applied scenario question, create a numerical calculation with enough data and a worked "
                "solution if these lessons support a meaningful calculation (for example, scheduling waiting time); "
                "otherwise test a concrete multi-step application. It must remain multiple choice, with one correct "
                "answer and three distinct plausible distractors. Do not invent formulas or facts outside the lessons. "
                "Keep the scenario prompt under 45 words and explain the correct answer with the key steps in "
                "under 45 words. "
            )
        questions = []
        batch_size = 1 if quiz_mode in {"single", "revision", "problem"} else 5
        try:
            for start in range(0, len(quiz_topics), batch_size):
                topic_batch = quiz_topics[start : start + batch_size]
                has_applied_problem = quiz_mode == "problem" or (quiz_mode == "initial" and start + batch_size >= len(quiz_topics))
                batch_expected_count = 1 if quiz_mode == "problem" else len(topic_batch) + (1 if has_applied_problem else 0)
                if quiz_mode in {"revision", "single"}:
                    batch_schema = (
                        "Return only compact JSON with this schema and no extra keys:\n"
                        "{\"questions\":[{\"type\":\"mcq\",\"topicIndex\":0,\"prompt\":\"...\","
                        "\"options\":[\"...\",\"...\",\"...\",\"...\"],\"answerIndex\":0,\"explanation\":\"...\"}]}\n"
                        f"Include exactly {len(topic_batch)} questions, one for each topic in the batch, in order.\n"
                    )
                elif quiz_mode == "problem":
                    batch_schema = (
                        "Return only compact JSON with this schema and no extra keys:\n"
                        "{\"questions\":[{\"type\":\"mcq\",\"applied\":true,\"topicIndex\":0,\"prompt\":\"...\","
                        "\"options\":[\"...\",\"...\",\"...\",\"...\"],\"answerIndex\":0,\"explanation\":\"...\"}]}\n"
                        "Include exactly one applied scenario as a multiple-choice question.\n"
                    )
                else:
                    batch_schema = (
                        "Return only compact JSON with this schema and no extra keys:\n"
                        "{\"questions\":[{\"type\":\"mcq\",\"topicIndex\":0,\"prompt\":\"...\","
                        "\"options\":[\"...\",\"...\",\"...\",\"...\"],\"answerIndex\":0,\"explanation\":\"...\"}"
                        + (",{\"type\":\"mcq\",\"applied\":true,\"topicIndex\":0,\"prompt\":\"...\",\"options\":[\"...\",\"...\",\"...\",\"...\"],\"answerIndex\":0,\"explanation\":\"...\"}" if has_applied_problem else "")
                        + "]}\n"
                        f"Include exactly {len(topic_batch)} mcq questions, one for every topic in order. "
                        + ("Then include exactly one applied scenario multiple-choice question as the last question. " if has_applied_problem else "Do not include an applied scenario question. ")
                    )
                batch_prompt = (
                    prompt
                    + "Return compact JSON. Keep every question and answer concise so the full batch fits.\n"
                    + batch_schema
                    + f"Topics:\n{json.dumps(topic_batch, ensure_ascii=False)}"
                )
                response = request_ai(
                    [{"role": "user", "content": batch_prompt}],
                    api_key,
                    "quiz generation",
                    min(max(batch_expected_count * 180, 320 if has_applied_problem else 240), MAX_REQUEST_OUTPUT_TOKENS),
                    {"type": "json_object"},
                    reasoning_effort="none",
                )
                choices = response.get("choices", []) if isinstance(response, dict) else []
                finish_reason = choices[0].get("finish_reason") if choices and isinstance(choices[0], dict) else None
                if finish_reason in {"length", "max_tokens"}:
                    raise ValueError(f"Groq ran out of response tokens in quiz batch {start // batch_size + 1}. Please retry.")
                batch_quiz = parse_lesson_json(get_ai_text(response, "quiz"))
                batch_questions = batch_quiz.get("questions") if isinstance(batch_quiz, dict) else None
                if not isinstance(batch_questions, list) or len(batch_questions) != batch_expected_count:
                    count = len(batch_questions) if isinstance(batch_questions, list) else 0
                    raise ValueError(f"Groq returned {count} of {batch_expected_count} questions in quiz batch {start // batch_size + 1}. Please retry.")
                questions.extend(batch_questions)
            mcq_count = 0
            problem_count = 0
            normalized = []
            correct_position_offset = random.randrange(4)
            expected_topic_indices = [topic["topicIndex"] for topic in quiz_topics]
            topic_titles = {topic["topicIndex"]: topic["title"] for topic in quiz_topics}
            for question in questions:
                if not isinstance(question, dict):
                    raise ValueError("Groq returned an invalid quiz question. Please try again.")
                topic_index = question.get("topicIndex")
                if isinstance(topic_index, bool) or not isinstance(topic_index, int) or topic_index not in expected_topic_indices:
                    raise ValueError("Groq returned an invalid quiz topic. Please try again.")
                question_type = question.get("type")
                prompt_text = question.get("prompt")
                if not isinstance(prompt_text, str) or not prompt_text.strip():
                    raise ValueError("Groq returned an empty quiz question. Please try again.")
                if question_type == "mcq":
                    options = question.get("options")
                    answer_index = question.get("answerIndex")
                    explanation = question.get("explanation")
                    if (
                        not isinstance(options, list)
                        or len(options) != 4
                        or any(not isinstance(option, str) or not option.strip() for option in options)
                        or len({re.sub(r"[^a-z0-9]+", " ", option.casefold()).strip() for option in options if isinstance(option, str)}) != 4
                        or isinstance(answer_index, bool)
                        or not isinstance(answer_index, int)
                        or not 0 <= answer_index < len(options)
                        or not isinstance(explanation, str)
                        or not explanation.strip()
                    ):
                        raise ValueError("Groq returned an incomplete or repetitive multiple-choice question. Please retry.")
                    normalized_prompt = re.sub(r"[^a-z0-9]+", " ", prompt_text.casefold()).strip()
                    if (
                        len(prompt_text.split()) < 5
                        or re.search(r"\bhow does question \d+\b|\bwhat does question \d+\b|\bthis question tests\b", normalized_prompt)
                    ):
                        raise ValueError("Groq returned a generic or incomplete quiz question. Please retry.")
                    if any(
                        existing["type"] == "mcq"
                        and re.sub(r"[^a-z0-9]+", " ", existing["prompt"].casefold()).strip() == normalized_prompt
                        for existing in normalized
                    ):
                        raise ValueError("Groq repeated a multiple-choice question. Please retry.")
                    mcq_count += 1
                    normalized_options = [option.strip() for option in options]
                    correct_option = normalized_options.pop(answer_index)
                    correct_position = (mcq_count - 1 + correct_position_offset) % 4
                    normalized_options.insert(correct_position, correct_option)
                    normalized.append({
                        "type": "mcq",
                        "applied": bool(question.get("applied")) or quiz_mode == "problem" or (quiz_mode == "initial" and mcq_count == len(quiz_topics) + 1),
                        "topicIndex": topic_index,
                        "topicTitle": topic_titles[topic_index],
                        "prompt": prompt_text.strip(),
                        "options": normalized_options,
                        "answerIndex": correct_position,
                        "explanation": explanation.strip(),
                    })
                elif question_type == "problem":
                    answer = question.get("answer")
                    solution = question.get("solution")
                    if (
                        not isinstance(answer, str)
                        or not answer.strip()
                        or not isinstance(solution, str)
                        or not solution.strip()
                    ):
                        raise ValueError("Groq returned an incomplete applied problem. Please retry.")
                    problem_count += 1
                    normalized.append({
                        "type": "problem",
                        "topicIndex": topic_index,
                        "topicTitle": topic_titles[topic_index],
                        "prompt": prompt_text.strip(),
                        "answer": answer.strip(),
                        "solution": solution.strip(),
                    })
                else:
                    raise ValueError("Groq returned an unsupported question type. Please retry.")
            if quiz_mode == "initial":
                valid_mix = (
                    mcq_count == len(quiz_topics) + 1
                    and problem_count == 0
                    and [question["type"] for question in normalized] == ["mcq"] * (len(quiz_topics) + 1)
                    and [question["topicIndex"] for question in normalized[:-1]] == expected_topic_indices
                    and normalized[-1].get("applied") is True
                )
            elif quiz_mode == "problem":
                valid_mix = (
                    mcq_count == 1
                    and problem_count == 0
                    and len(normalized) == 1
                    and normalized[0]["type"] == "mcq"
                    and normalized[0].get("applied") is True
                )
            else:
                valid_mix = (
                    mcq_count == expected_count
                    and problem_count == 0
                    and [question["type"] for question in normalized] == ["mcq"] * expected_count
                    and [question["topicIndex"] for question in normalized] == expected_topic_indices
                )
            if not valid_mix:
                raise ValueError("Groq returned the wrong number or mix of quiz questions. Please retry.")
        except (json.JSONDecodeError, AttributeError, TypeError, ValueError, RuntimeError) as error:
            message = str(error) or "Groq returned an unreadable quiz. Please retry."
            print(f"Groq quiz generation failed: {message}", file=sys.stderr)
            status = error.status if isinstance(error, AIProviderError) else 502
            send_json(self, status, {"error": message})
            return
        send_json(self, 200, {"questions": normalized})

    def generate_lesson(self, api_key):
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            send_json(self, 400, {"error": "The lesson request size is invalid."})
            return
        if content_length <= 0 or content_length > MAX_LESSON_REQUEST_BYTES:
            send_json(self, 413, {"error": "The study material is too large to create a lesson. Try a smaller selection."})
            return

        try:
            request_data = json.loads(self.rfile.read(content_length))
            material = request_data.get("material", "")
            topic = request_data.get("topic", "")
            memory_style = request_data.get("memoryStyle", "")
            minutes = request_data.get("minutes", 15)
            if not isinstance(material, str) or not material.strip() or len(material) > MAX_STUDY_TEXT_CHARS:
                raise ValueError("Add study material under 200,000 characters.")
            if not isinstance(topic, str) or not topic.strip() or len(topic) > 5000:
                raise ValueError("The selected topic is invalid. Please rebuild your study plan.")
            if not isinstance(memory_style, str) or len(memory_style) > 80:
                raise ValueError("The learning preference is invalid. Please rebuild your study plan.")
            if not isinstance(minutes, int) or not 2 <= minutes <= 720:
                raise ValueError("The lesson time is invalid. Please rebuild your study plan.")
        except (json.JSONDecodeError, AttributeError, TypeError, ValueError) as error:
            send_json(self, 400, {"error": str(error) or "The lesson request is invalid."})
            return

        output_tokens = lesson_detail_profile(minutes)
        target_words = 200

        def lesson_prompt(word_limit, compact=False, very_compact=False):
            structure = (
                "Use 3 or 4 short bullets: explain the main idea, give a tiny example, and state the key point. "
                "Skip secondary details. "
                if very_compact else
                "Use 5 or 6 short bullets: explain the central idea and key terms, show how it works "
                "with an example, and end with what to remember. "
                if compact else
                "Use 8 to 10 clear, informative bullets. Explain the central idea and essential terms, "
                "connect the steps or causes clearly, walk through one relevant worked example step by step, "
                "and finish with a short recap and a quick self-check question. Blend a plain-language explanation, "
                "key terms, step-by-step reasoning where useful, and a real-world connection or analogy when it clarifies the idea. "
                "Do not skip a step needed to understand the topic. "
            )
            return (
                "Teach only the selected topic to a beginner in a concise but detailed lesson. "
                f"Write about {word_limit} words (never exceed the limit). {structure}"
                "Ignore document metadata such as department or school headers, institution names, addresses, contact details, "
                "page numbers, file labels, and copyright lines. Do not repeat or teach that metadata; focus on useful study content. "
                "Format the entire answer as markdown bullet points: every non-empty line must start with '- '. "
                "Do not add unbulleted headings or paragraphs. Each bullet must explain one idea in one or two "
                "short, complete sentences and stay under 25 words. Split long steps and examples across multiple "
                "bullets. Do not put a whole paragraph inside one bullet. Prefer clear, natural wording and explain "
                "technical words on first use. Include only details that help the learner understand this topic. "
                "Treat the notes as the factual source; do not add unsupported course facts. "
                f"{('For this shorter fallback, set visual to null.' if compact else 'Include a visual only when it would make the idea easier to understand: use a flowchart for a process or sequence, or a concept map for connected ideas. For other topics set visual to null. ')}"
                "Return one valid JSON object only, with keys content and visual. The content value must be the "
                "bullet-point lesson as a string. A flowchart visual must have kind=flowchart, a title, and 3-7 "
                "steps with title and detail. A concept map must have kind=concept-map, a title, a center with "
                "title and detail, and 3-6 branches with title, relation, and detail. Do not return image URLs "
                "or markdown fences. "
                f"Planned study time: {minutes} minutes.\n\nTopic: {topic}\nSource:\n{material}"
            )
        try:
            lesson_content = ""
            lesson_was_truncated = False
            for attempt in range(3):
                compact = attempt >= 1
                very_compact = attempt == 2
                word_limit = 75 if very_compact else 120 if compact else target_words
                token_limit = max(400, output_tokens // 3) if very_compact else max(650, output_tokens // 2) if compact else output_tokens
                response = request_ai(
                    [{"role": "user", "content": lesson_prompt(word_limit, compact, very_compact)}],
                    api_key,
                    "lesson generation",
                    token_limit,
                    response_format={"type": "json_object"},
                    reasoning_effort="none",
                )
                choices = response.get("choices", []) if isinstance(response, dict) else []
                finish_reason = choices[0].get("finish_reason") if choices and isinstance(choices[0], dict) else None
                lesson_content = get_ai_text(response, "lesson content").strip()
                lesson_was_truncated = finish_reason in {"length", "max_tokens"}
                if not lesson_was_truncated:
                    break
                if attempt < 2:
                    print("Groq lesson reached its token limit; retrying with a shorter lesson.", file=sys.stderr)
            if lesson_was_truncated:
                raise ValueError("The tutor reached its response limit after automatically trying shorter versions. Please retry this lesson.")
            if not lesson_content:
                raise ValueError("Groq returned an empty lesson. Please try again.")
            lesson_data = parse_lesson_json(lesson_content)
            if not isinstance(lesson_data, dict) or not isinstance(lesson_data.get("content"), str) or not lesson_data["content"].strip():
                raise ValueError("Groq returned an incomplete lesson. Please try again.")
            lesson_content = lesson_data["content"].strip()
            visual, visual_warning = validate_lesson_visual(lesson_data.get("visual"))
        except (AttributeError, TypeError, ValueError, RuntimeError) as error:
            message = str(error) or "Groq returned an unreadable lesson. Please retry."
            print(f"Groq lesson generation failed: {message}", file=sys.stderr)
            status = error.status if isinstance(error, AIProviderError) else 502
            send_json(self, status, {"error": message})
            return
        send_json(
            self,
            200,
            {
                "lesson": {
                    "content": lesson_content,
                    "truncated": lesson_was_truncated,
                    "explanation": lesson_content,
                    "detailedSections": [{"heading": "Lesson", "content": lesson_content}],
                    "materialConnection": "",
                    "workedExample": "",
                    "keyTerms": [],
                    "keyPoints": [],
                    "commonMistakes": [],
                    "recap": [],
                    "retrievalQuestion": "",
                    "answer": "",
                    "visual": visual,
                    "visualWarning": visual_warning or "",
                }
            },
        )

    def explain_part(self, api_key):
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            send_json(self, 400, {"error": "The follow-up request size is invalid."})
            return
        if content_length <= 0 or content_length > MAX_LESSON_REQUEST_BYTES:
            send_json(self, 413, {"error": "The follow-up request is too large. Please shorten your question."})
            return

        try:
            request_data = json.loads(self.rfile.read(content_length))
            material = request_data.get("material", "")
            topic = request_data.get("topic", "")
            question = request_data.get("question", "")
            if not isinstance(material, str) or not material.strip() or len(material) > MAX_STUDY_TEXT_CHARS:
                raise ValueError("The study material for this topic is invalid.")
            if not isinstance(topic, str) or not topic.strip() or len(topic) > 5000:
                raise ValueError("The selected topic is invalid. Please reopen the lesson.")
            if not isinstance(question, str) or not 1 <= len(question.strip()) <= MAX_FOLLOW_UP_QUESTION_CHARS:
                raise ValueError(f"The follow-up question must be 1-{MAX_FOLLOW_UP_QUESTION_CHARS} characters.")
        except (json.JSONDecodeError, AttributeError, TypeError, ValueError) as error:
            send_json(self, 400, {"error": str(error) or "The follow-up request is invalid."})
            return

        prompt = (
            "You are a patient subject tutor. Answer the learner's specific question about this study topic "
            "in clear, beginner-friendly detail, as a helpful ChatGPT-style explanation. Define necessary "
            "terms, explain the reasoning step by step, and include a worked example or analogy when it helps. "
            "Stay focused on the requested point, use the source as the primary reference, and do "
            "not invent details that are not supported. If the source does not contain enough information, "
            "say so plainly and distinguish any standard background you add. Aim for 150-250 words when the "
            "question needs that much explanation; be shorter for a simple question and do not repeat the whole "
            "lesson. Use short paragraphs and plain text only.\n\n"
            f"Topic:\n{topic}\n\n"
            f"Study material:\n{material}\n\n"
            f"Learner's question:\n{question.strip()}"
        )
        try:
            response = request_ai(
                [{"role": "user", "content": prompt}],
                api_key,
                "follow-up explanation",
                MAX_FOLLOW_UP_OUTPUT_TOKENS,
            )
            explanation = get_ai_text(response, "follow-up explanation").strip()
            if not explanation:
                raise ValueError("Groq returned an empty explanation. Please try again.")
        except (AttributeError, TypeError, ValueError, RuntimeError) as error:
            message = str(error) or "Groq could not explain that part. Please try again."
            print(f"Groq follow-up explanation failed: {message}", file=sys.stderr)
            status = error.status if isinstance(error, AIProviderError) else 502
            send_json(self, status, {"error": message})
            return
        send_json(self, 200, {"explanation": explanation})


# Vercel's Python runtime looks for a top-level handler class.
handler = StudyBuddyHandler


def main():
    if sys.stdout is None or sys.stderr is None:
        log_file = (Path(tempfile.gettempdir()) / "studybuddy-server.log").open("a", encoding="utf-8")
        if sys.stdout is None:
            sys.stdout = log_file
        if sys.stderr is None:
            sys.stderr = log_file
    load_local_env()
    initialize_database()
    host = os.environ.get("STUDYBUDDY_HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer((host, port), StudyBuddyHandler)
    print(f"StudyBuddy is running at http://{host}:{port}")
    if not get_api_key():
        print("Groq is not configured. Add a GROQ_API_KEY to .env and restart.")
    if host == "127.0.0.1":
        threading.Timer(1, webbrowser.open, args=(f"http://127.0.0.1:{port}",)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping StudyBuddy.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
