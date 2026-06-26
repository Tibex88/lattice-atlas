import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from time import perf_counter
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

from dashboard.analytics import (
    appendix_tables,
    cooccurrence_matrix,
    dataset_summary,
    extlat_rankings,
    filter_bounds,
    level_metrics,
    reslat_family,
    width_height_distribution,
)
from dashboard.blueprint_search import blueprint_search, parse_blueprint_search
from dashboard.config import WEB
from dashboard.datasets import (
    decode_entry,
    optional_json_int,
    optional_json_string,
    parse_dataset,
    parse_dataset_value,
    parse_filters,
    parse_int,
    property_options,
    query_items,
    require_json_int,
    require_json_string,
)
from dashboard.errors import ERRORS, LOGGER, NotFoundError, RequestError
from dashboard.storage import STORE


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB), **kwargs)

    def send_response(self, code, message=None):
        self._status_code = code
        super().send_response(code, message)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def parse_json_body(self):
        raw_length = self.headers.get("Content-Length")
        if raw_length in (None, ""):
            raise RequestError("missing request body")
        try:
            length = int(raw_length)
        except ValueError as exc:
            raise RequestError("invalid Content-Length header") from exc
        body = self.rfile.read(length)
        try:
            payload = json.loads(body.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise RequestError("request body is not valid JSON") from exc
        if not isinstance(payload, dict):
            raise RequestError("request body must be a JSON object")
        return payload

    def route_get(self, parsed):
        if parsed.path == "/api/summary":
            self.send_json(dataset_summary())
            return
        params = parse_qs(parsed.query)
        if parsed.path == "/api/filter-options":
            dataset = parse_dataset(params)
            self.send_json({"dataset": dataset, "properties": property_options(dataset)})
            return
        if parsed.path == "/api/filter-bounds":
            dataset = parse_dataset(params)
            n = parse_int(params, "n", default=1)
            self.send_json(filter_bounds(dataset, n))
            return
        if parsed.path == "/api/level-metrics":
            n = parse_int(params, "n", default=1)
            self.send_json(level_metrics(n))
            return
        if parsed.path == "/api/width-height":
            dataset = parse_dataset(params)
            n = parse_int(params, "n", default=1)
            self.send_json(width_height_distribution(dataset, n))
            return
        if parsed.path == "/api/extlat-rankings":
            n = parse_int(params, "n", default=1)
            limit = parse_int(params, "limit", default=12)
            self.send_json(extlat_rankings(n, limit))
            return
        if parsed.path == "/api/cooccurrence":
            dataset = parse_dataset(params)
            n = parse_int(params, "n", default=1)
            self.send_json(cooccurrence_matrix(dataset, n))
            return
        if parsed.path == "/api/appendix-tables":
            dataset = parse_dataset(params)
            n = parse_int(params, "n", default=1)
            self.send_json(appendix_tables(dataset, n))
            return
        if parsed.path == "/api/reslat-family":
            n = parse_int(params, "n")
            index = parse_int(params, "index")
            limit = parse_int(params, "limit", default=12)
            self.send_json(reslat_family(n, index, limit))
            return
        if parsed.path == "/api/items":
            dataset = parse_dataset(params)
            n = parse_int(params, "n", default=1)
            limit = parse_int(params, "limit", default=100)
            offset = parse_int(params, "offset", default=0)
            filters = parse_filters(params)
            self.send_json(query_items(dataset, n, filters, limit, offset))
            return
        if parsed.path == "/api/entry":
            dataset = parse_dataset(params, default=None)
            n = parse_int(params, "n")
            index = parse_int(params, "index")
            self.send_json(decode_entry(dataset, n, index))
            return
        if parsed.path == "/api/blueprint-search":
            filters = parse_blueprint_search(params)
            filters["dataset"] = parse_dataset(params)
            self.send_json(blueprint_search(filters))
            return
        if parsed.path == "/api/storage":
            self.send_json(STORE.status())
            return
        if parsed.path == "/api/blueprints":
            self.send_json({"items": STORE.list_blueprints()})
            return
        if parsed.path == "/api/sessions":
            self.send_json({"items": STORE.list_sessions()})
            return
        if parsed.path == "/":
            self.path = "/index.html"
        super().do_GET()

    def route_post(self, parsed):
        payload = self.parse_json_body()
        if parsed.path == "/api/blueprints":
            dataset = parse_dataset_value(require_json_string(payload, "dataset"))
            n = require_json_int(payload, "n")
            index = require_json_int(payload, "index")
            title = optional_json_string(payload, "title")
            notes = optional_json_string(payload, "notes")
            tags = payload.get("tags", [])
            self.send_json(
                STORE.save_blueprint(dataset, n, index, title=title, notes=notes, tags=tags),
                status=201,
            )
            return
        if parsed.path == "/api/sessions":
            session_id = optional_json_int(payload, "id")
            name = require_json_string(payload, "name")
            notes = optional_json_string(payload, "notes")
            state = payload.get("state")
            self.send_json(STORE.save_session(name, state, notes=notes, session_id=session_id), status=201)
            return
        raise NotFoundError(f"unsupported POST route: {parsed.path}")

    def route_delete(self, parsed):
        params = parse_qs(parsed.query)
        if parsed.path == "/api/blueprints":
            blueprint_id = parse_int(params, "id")
            self.send_json(STORE.delete_blueprint(blueprint_id))
            return
        if parsed.path == "/api/sessions":
            session_id = parse_int(params, "id")
            self.send_json(STORE.delete_session(session_id))
            return
        raise NotFoundError(f"unsupported DELETE route: {parsed.path}")

    def handle_api_request(self, method, route_fn):
        parsed = urlparse(self.path)
        request_id = uuid4().hex[:8]
        started = perf_counter()
        self._status_code = 200
        LOGGER.info(
            "request.started",
            request_id=request_id,
            method=method,
            path=parsed.path,
            query=parsed.query or None,
        )
        try:
            route_fn(parsed)
        except Exception as exc:
            app_error = ERRORS.capture(exc, request_id=request_id, path=parsed.path, query=parsed.query)
            self.send_json(
                {
                    "error": {
                        "kind": app_error.kind,
                        "message": app_error.public_message,
                        "request_id": request_id,
                    }
                },
                status=app_error.status,
            )
        finally:
            LOGGER.info(
                "request.completed",
                request_id=request_id,
                method=method,
                path=parsed.path,
                status=self._status_code,
                duration_ms=round((perf_counter() - started) * 1000, 2),
            )

    def do_GET(self):
        self.handle_api_request("GET", self.route_get)

    def do_POST(self):
        self.handle_api_request("POST", self.route_post)

    def do_DELETE(self):
        self.handle_api_request("DELETE", self.route_delete)

    def send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        return


class AppServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    port = int(os.environ.get("PORT", "8000"))
    try:
        server = AppServer(("127.0.0.1", port), Handler)
    except OSError as exc:
        LOGGER.error("server.bind_failed", port=port, message=str(exc))
        raise SystemExit(1) from exc
    LOGGER.info("server.started", host="127.0.0.1", port=port)
    print(f"Serving on http://127.0.0.1:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        LOGGER.info("server.stopping", reason="keyboard_interrupt")
    finally:
        server.server_close()
        LOGGER.info("server.stopped", host="127.0.0.1", port=port)
