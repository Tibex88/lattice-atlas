import json
import os
import pickle
import sys
from functools import lru_cache
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
DATA = SRC / "data"

sys.path.insert(0, str(SRC))
from prog import BoundedLattice, ResiduatedLattice  # noqa: E402


def hasse_edges(lattice):
    edges = []
    n = lattice.n
    for i in range(n):
        for j in range(i + 1, n):
            if lattice.leq(i, j) and not any(
                lattice.leq(i, k) and lattice.leq(k, j) for k in range(i + 1, j)
            ):
                edges.append([i, j])
    return edges


def dataset_path(dataset, n):
    return DATA / f"{dataset}{n}.db"


@lru_cache(maxsize=64)
def load_dataset(dataset, n):
    path = dataset_path(dataset, n)
    with path.open("rb") as f:
        return pickle.load(f)


def object_count(obj):
    return len(obj)


def entry_keys(dataset, n):
    obj = load_dataset(dataset, n)
    if isinstance(obj, set):
        items = sorted(obj)
        return [{"index": i, "encoding": enc.hex()} for i, enc in enumerate(items)]
    items = sorted(obj.items(), key=lambda item: item[0])
    return [{"index": i, "encoding": enc.hex(), "count": count} for i, (enc, count) in enumerate(items)]


def decode_entry(dataset, n, index):
    obj = load_dataset(dataset, n)
    if isinstance(obj, set):
        items = sorted(obj)
        enc = items[index]
        extra_count = None
    else:
        items = sorted(obj.items(), key=lambda item: item[0])
        enc, extra_count = items[index]
    if dataset == "reslat":
        structure = ResiduatedLattice.decode(enc, n)
        mult_table = structure._mult
    else:
        structure = BoundedLattice.decode(enc, n)
        mult_table = None
    return {
        "dataset": dataset,
        "n": n,
        "index": index,
        "encoding": enc.hex(),
        "count": extra_count,
        "order_matrix": structure._leq,
        "edges": hasse_edges(structure),
        "levels": [sum(1 for j in range(n) if structure.leq(j, i)) - 1 for i in range(n)],
        "mult_table": mult_table,
    }


def dataset_summary():
    rows = []
    for dataset in ("lat", "extlat", "reslat"):
        for n in range(1, 13):
            path = dataset_path(dataset, n)
            if not path.exists():
                continue
            obj = load_dataset(dataset, n)
            row = {
                "dataset": dataset,
                "n": n,
                "entries": object_count(obj),
                "file_bytes": path.stat().st_size,
            }
            if isinstance(obj, dict) and obj:
                row["max_count"] = max(obj.values())
            rows.append(row)
    return rows


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/summary":
            self.send_json(dataset_summary())
            return
        if parsed.path == "/api/items":
            params = parse_qs(parsed.query)
            dataset = params.get("dataset", ["lat"])[0]
            n = int(params.get("n", ["1"])[0])
            limit = int(params.get("limit", ["100"])[0])
            offset = int(params.get("offset", ["0"])[0])
            keys = entry_keys(dataset, n)
            payload = {
                "total": len(keys),
                "items": keys[offset : offset + limit],
            }
            self.send_json(payload)
            return
        if parsed.path == "/api/entry":
            params = parse_qs(parsed.query)
            dataset = params["dataset"][0]
            n = int(params["n"][0])
            index = int(params["index"][0])
            self.send_json(decode_entry(dataset, n, index))
            return
        if parsed.path == "/":
            self.path = "/index.html"
        return super().do_GET()

    def send_json(self, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        return


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Serving on http://127.0.0.1:{port}")
    server.serve_forever()
