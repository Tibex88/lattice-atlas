import json
import importlib
import os
import pickle
import sys
from functools import lru_cache
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
DATA = ROOT / "data"

sys.path.insert(0, str(SRC))
from prog import BoundedLattice, DataStore, ResiduatedLattice  # noqa: E402
schema_module = importlib.import_module("schemas")


def _slug(label):
    return "".join(ch.lower() if ch.isalnum() else "_" for ch in label).strip("_")


LATTICE_PROPERTIES = { _slug(name): (name, fn) for name, fn in schema_module.lattice_properties.attributes }
RESIDUATED_PROPERTIES = { _slug(name): (name, fn) for name, fn in schema_module.residuated_properties.attributes }
SPECIAL_ALGEBRAS = {
    _slug(name): (name, base_names)
    for name, base_names in schema_module.special_algebras.attributes
}


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


def property_options(dataset):
    if dataset in {"lat", "extlat"}:
        return [{"key": key, "label": label, "kind": "property"} for key, (label, _) in LATTICE_PROPERTIES.items()]
    if dataset == "reslat":
        props = [{"key": key, "label": label, "kind": "property"} for key, (label, _) in RESIDUATED_PROPERTIES.items()]
        props += [{"key": key, "label": label, "kind": "algebra"} for key, (label, _) in SPECIAL_ALGEBRAS.items()]
        return props
    return []


def property_values(dataset, structure):
    values = {}
    if dataset in {"lat", "extlat"}:
        for key, (_, fn) in LATTICE_PROPERTIES.items():
            values[key] = bool(fn(structure))
    else:
        base = {}
        for key, (_, fn) in RESIDUATED_PROPERTIES.items():
            base[key] = bool(fn(structure))
            values[key] = base[key]
        label_to_key = {label: key for key, (label, _) in RESIDUATED_PROPERTIES.items()}
        for key, (_, base_names) in SPECIAL_ALGEBRAS.items():
            values[key] = all(base[label_to_key[name]] for name in base_names if name in label_to_key)
    return values


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
        "width": structure.width(),
        "height": structure.height(),
        "properties": property_values(dataset, structure),
    }


def parse_filters(params):
    def to_int(name):
        value = params.get(name, [""])[0]
        return int(value) if value else None

    return {
        "width_min": to_int("width_min"),
        "width_max": to_int("width_max"),
        "height_min": to_int("height_min"),
        "height_max": to_int("height_max"),
        "count_min": to_int("count_min"),
        "count_max": to_int("count_max"),
        "properties": tuple(params.get("prop", [])),
    }


def matches_filters(item, filters):
    if filters["width_min"] is not None and item["width"] < filters["width_min"]:
        return False
    if filters["width_max"] is not None and item["width"] > filters["width_max"]:
        return False
    if filters["height_min"] is not None and item["height"] < filters["height_min"]:
        return False
    if filters["height_max"] is not None and item["height"] > filters["height_max"]:
        return False
    if item["count"] is not None:
        if filters["count_min"] is not None and item["count"] < filters["count_min"]:
            return False
        if filters["count_max"] is not None and item["count"] > filters["count_max"]:
            return False
    if filters["properties"]:
        props = item.get("properties", {})
        for key in filters["properties"]:
            if not props.get(key, False):
                return False
    return True


def query_items(dataset, n, filters, limit, offset):
    obj = load_dataset(dataset, n)
    raw_items = sorted(obj) if isinstance(obj, set) else sorted(obj.items(), key=lambda item: item[0])
    items = []
    for index, raw in enumerate(raw_items):
        if isinstance(obj, set):
            enc = raw
            count = None
        else:
            enc, count = raw
        if dataset == "reslat":
            structure = ResiduatedLattice.decode(enc, n)
        else:
            structure = BoundedLattice.decode(enc, n)
        item = {
            "index": index,
            "encoding": enc.hex(),
            "count": count,
            "width": structure.width(),
            "height": structure.height(),
            "properties": property_values(dataset, structure),
        }
        if matches_filters(item, filters):
            items.append(item)
    return {
        "total": len(items),
        "items": items[offset : offset + limit],
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


@lru_cache(maxsize=1)
def dataset_summary_map():
    return {(row["dataset"], row["n"]): row for row in dataset_summary()}


@lru_cache(maxsize=32)
def level_metrics(n):
    summary = dataset_summary_map()
    lat = summary.get(("lat", n), {}).get("entries", 0)
    reslat = summary.get(("reslat", n), {}).get("entries", 0)
    max_expansions = summary.get(("extlat", n), {}).get("max_count", 0)
    reducts = sum(1 for count in load_dataset("extlat", n).values() if count > 0)
    return {
        "n": n,
        "lattices": lat,
        "reducts": reducts,
        "residuated_lattices": reslat,
        "max_expansions": max_expansions,
        "reduct_ratio": (reducts / lat) if lat else 0,
        "expansions_per_reduct": (reslat / reducts) if reducts else 0,
    }


@lru_cache(maxsize=32)
def width_height_distribution(dataset, n):
    family = {
        "lat": "lattices - width and height",
        "reslat": "residuated lattices - width and height",
    }.get(dataset)
    if not family:
        return {"dataset": dataset, "n": n, "cells": [], "widths": [], "heights": []}
    ds = DataStore()
    context = ds.load_context(family, str(n))
    cells = []
    widths = {}
    heights = {}
    for (height, width), count in context.distribution.items():
        cells.append({"height": height, "width": width, "count": count})
        widths[width] = widths.get(width, 0) + count
        heights[height] = heights.get(height, 0) + count
    cells.sort(key=lambda cell: (cell["height"], cell["width"]))
    return {
        "dataset": dataset,
        "n": n,
        "cells": cells,
        "widths": [{"value": k, "count": widths[k]} for k in sorted(widths)],
        "heights": [{"value": k, "count": heights[k]} for k in sorted(heights)],
    }


@lru_cache(maxsize=32)
def extlat_rankings(n, limit=12):
    obj = load_dataset("extlat", n)
    items = sorted(obj.items(), key=lambda item: (-item[1], item[0]))[:limit]
    rows = []
    for enc, count in items:
        lattice = BoundedLattice.decode(enc, n)
        rows.append(
            {
                "encoding": enc.hex(),
                "count": count,
                "width": lattice.width(),
                "height": lattice.height(),
            }
        )
    return {"n": n, "items": rows}


@lru_cache(maxsize=32)
def filter_bounds(dataset, n):
    dist = width_height_distribution("lat" if dataset == "extlat" else dataset, n)
    width_values = [item["value"] for item in dist["widths"]]
    height_values = [item["value"] for item in dist["heights"]]
    result = {
        "dataset": dataset,
        "n": n,
        "width_min": min(width_values) if width_values else 1,
        "width_max": max(width_values) if width_values else n,
        "height_min": min(height_values) if height_values else 1,
        "height_max": max(height_values) if height_values else n,
    }
    if dataset == "extlat":
        counts = list(load_dataset("extlat", n).values())
        result["count_min"] = min(counts) if counts else 0
        result["count_max"] = max(counts) if counts else 0
    return result


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
        if parsed.path == "/api/filter-options":
            params = parse_qs(parsed.query)
            dataset = params.get("dataset", ["lat"])[0]
            self.send_json({"dataset": dataset, "properties": property_options(dataset)})
            return
        if parsed.path == "/api/filter-bounds":
            params = parse_qs(parsed.query)
            dataset = params.get("dataset", ["lat"])[0]
            n = int(params.get("n", ["1"])[0])
            self.send_json(filter_bounds(dataset, n))
            return
        if parsed.path == "/api/level-metrics":
            params = parse_qs(parsed.query)
            n = int(params.get("n", ["1"])[0])
            self.send_json(level_metrics(n))
            return
        if parsed.path == "/api/width-height":
            params = parse_qs(parsed.query)
            dataset = params.get("dataset", ["lat"])[0]
            n = int(params.get("n", ["1"])[0])
            self.send_json(width_height_distribution(dataset, n))
            return
        if parsed.path == "/api/extlat-rankings":
            params = parse_qs(parsed.query)
            n = int(params.get("n", ["1"])[0])
            limit = int(params.get("limit", ["12"])[0])
            self.send_json(extlat_rankings(n, limit))
            return
        if parsed.path == "/api/items":
            params = parse_qs(parsed.query)
            dataset = params.get("dataset", ["lat"])[0]
            n = int(params.get("n", ["1"])[0])
            limit = int(params.get("limit", ["100"])[0])
            offset = int(params.get("offset", ["0"])[0])
            filters = parse_filters(params)
            self.send_json(query_items(dataset, n, filters, limit, offset))
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
