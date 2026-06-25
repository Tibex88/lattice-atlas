import json
import importlib
import logging
import os
import pickle
import sys
import tempfile
from bisect import bisect_left, bisect_right
from functools import lru_cache
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from time import perf_counter
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
DATA = ROOT / "data"
CACHE = ROOT / "artifacts" / "metadata-cache"
CACHE_VERSION = 2

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
PROPERTY_DESCRIPTIONS = {
    "modular": "Satisfies the modular law, a structural condition weaker than distributivity.",
    "distributive": "Meet and join distribute over each other throughout the lattice.",
    "complemented": "Every element has at least one complement relative to bottom and top.",
    "boolean": "A distributive complemented lattice; equivalently a finite Boolean algebra here.",
    "relatively_complemented": "Every interval behaves like a complemented lattice.",
    "pseudo_complemented": "Each element has a greatest pseudocomplement with respect to bottom.",
    "relatively_pseudo_complemented": "Each interval supports relative pseudocomplements, giving implication-like behavior.",
    "prelinear": "For any two elements, one implication dominates the other; this is the MTL-style comparability law.",
    "pi1": "Satisfies the first Pi condition used in the paper's residuated-lattice classifications.",
    "pi2": "Satisfies the second Pi condition used in the paper's residuated-lattice classifications.",
    "strict": "Satisfies the strictness condition tracked in the source property definitions.",
    "weak_nilpotent_minimum": "Obeys the weak nilpotent minimum law.",
    "divisible": "Satisfies divisibility, linking multiplication and implication tightly.",
    "involutive": "Double negation returns the original element.",
    "idempotent": "Multiplying an element by itself gives the same element.",
    "mtl": "Prelinear residuated lattice.",
    "smtl": "Prelinear residuated lattice also satisfying pi2.",
    "wnm": "Prelinear residuated lattice satisfying weak nilpotent minimum.",
    "bl": "Prelinear and divisible residuated lattice.",
    "sbl": "BL algebra that also satisfies pi2.",
    "imtl": "Prelinear involutive residuated lattice.",
    "heyting": "Divisible and idempotent residuated lattice; the Heyting-algebra case.",
    "g": "Prelinear, divisible, and idempotent residuated lattice.",
    "nm": "Prelinear involutive residuated lattice with weak nilpotent minimum.",
    "mv": "Divisible involutive residuated lattice; the MV-algebra case.",
    "pi": "Prelinear divisible residuated lattice satisfying both pi1 and pi2.",
    "pimtl": "Prelinear residuated lattice satisfying both pi1 and pi2.",
}

VALID_DATASETS = {"lat", "extlat", "reslat"}


class AppError(Exception):
    def __init__(self, message, *, kind="runtime", status=500, public_message=None, details=None):
        super().__init__(message)
        self.kind = kind
        self.status = status
        self.public_message = public_message or message
        self.details = details or {}


class RequestError(AppError):
    def __init__(self, message, *, details=None):
        super().__init__(message, kind="request", status=400, details=details)


class NotFoundError(AppError):
    def __init__(self, message, *, details=None):
        super().__init__(message, kind="request", status=404, details=details)


class DataError(AppError):
    def __init__(self, message, *, details=None):
        super().__init__(
            message,
            kind="data",
            status=500,
            public_message="Dataset could not be loaded.",
            details=details,
        )


class RuntimeFault(AppError):
    def __init__(self, message="unexpected server error", *, details=None):
        super().__init__(
            message,
            kind="runtime",
            status=500,
            public_message="Unexpected server error.",
            details=details,
        )


class AppLogger:
    _instance = None

    def __init__(self):
        logger = logging.getLogger("residuals")
        logger.setLevel(logging.INFO)
        logger.propagate = False
        if not logger.handlers:
            handler = logging.StreamHandler()
            handler.setFormatter(
                logging.Formatter(
                    "%(asctime)s | %(levelname)-7s | %(message)s",
                    datefmt="%Y-%m-%d %H:%M:%S",
                )
            )
            logger.addHandler(handler)
        self._logger = logger

    @classmethod
    def get(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def _emit(self, level, event, **fields):
        details = " ".join(
            f"{key}={json.dumps(value, default=str)}"
            for key, value in fields.items()
            if value is not None
        )
        message = event if not details else f"{event} | {details}"
        getattr(self._logger, level)(message)

    def info(self, event, **fields):
        self._emit("info", event, **fields)

    def warning(self, event, **fields):
        self._emit("warning", event, **fields)

    def error(self, event, **fields):
        self._emit("error", event, **fields)

    def exception(self, event, **fields):
        self._emit("exception", event, **fields)


class ErrorHub:
    _instance = None

    @classmethod
    def get(cls):
        if cls._instance is None:
            cls._instance = cls(AppLogger.get())
        return cls._instance

    def __init__(self, logger):
        self.logger = logger

    def normalize(self, error):
        if isinstance(error, AppError):
            return error
        if isinstance(error, FileNotFoundError):
            return DataError(str(error))
        if isinstance(error, (pickle.UnpicklingError, EOFError)):
            return DataError("dataset file is unreadable")
        if isinstance(error, KeyError):
            return RequestError(f"missing parameter: {error.args[0]}")
        if isinstance(error, ValueError):
            return RequestError(str(error))
        if isinstance(error, IndexError):
            return NotFoundError(str(error))
        return RuntimeFault(details={"type": type(error).__name__})

    def capture(self, error, *, request_id, path, query):
        app_error = self.normalize(error)
        fields = {
            "request_id": request_id,
            "path": path,
            "query": query or None,
            "kind": app_error.kind,
            "status": app_error.status,
            "message": str(app_error),
            "details": app_error.details or None,
        }
        if app_error.status >= 500:
            self.logger.exception("request.failed", **fields)
        else:
            self.logger.warning("request.rejected", **fields)
        return app_error


LOGGER = AppLogger.get()
ERRORS = ErrorHub.get()


def parse_dataset(params, name="dataset", default="lat"):
    dataset = params.get(name, [default])[0]
    if dataset not in VALID_DATASETS:
        raise RequestError(f"invalid dataset: {dataset}", details={"allowed": sorted(VALID_DATASETS)})
    return dataset


def parse_int(params, name, *, default=None):
    raw = params.get(name, [None])[0]
    if raw in (None, ""):
        if default is None:
            raise RequestError(f"missing integer parameter: {name}")
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise RequestError(f"invalid integer parameter: {name}={raw}") from exc


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


def metadata_cache_path(dataset, n):
    return CACHE / f"{dataset}{n}.items.pkl"


def property_cache_path(dataset, n):
    return CACHE / f"{dataset}{n}.props.pkl"


@lru_cache(maxsize=64)
def load_dataset(dataset, n):
    path = dataset_path(dataset, n)
    try:
        with path.open("rb") as f:
            return pickle.load(f)
    except FileNotFoundError as exc:
        raise DataError(f"missing dataset file: {path.name}", details={"path": str(path)}) from exc
    except (pickle.UnpicklingError, EOFError) as exc:
        raise DataError(f"invalid dataset file: {path.name}", details={"path": str(path)}) from exc


def object_count(obj):
    return len(obj)


def lattice_encoding_nbytes(n):
    upper_triangle_size = n * (n + 1) // 2
    return upper_triangle_size // 8 + (1 if upper_triangle_size % 8 else 0)


def base_encoding_from_reslat(encoding, n):
    return encoding[: lattice_encoding_nbytes(n)]


def dataset_property_keys(dataset):
    if dataset in {"lat", "extlat"}:
        return tuple(LATTICE_PROPERTIES.keys())
    return tuple(RESIDUATED_PROPERTIES.keys()) + tuple(SPECIAL_ALGEBRAS.keys())


def structural_dataset(dataset):
    return "lat" if dataset == "extlat" else dataset


def property_options(dataset):
    if dataset in {"lat", "extlat"}:
        return [
            {
                "key": key,
                "label": label,
                "kind": "property",
                "description": PROPERTY_DESCRIPTIONS.get(key, f"{label} property."),
            }
            for key, (label, _) in LATTICE_PROPERTIES.items()
        ]
    if dataset == "reslat":
        props = [
            {
                "key": key,
                "label": label,
                "kind": "property",
                "description": PROPERTY_DESCRIPTIONS.get(key, f"{label} property."),
            }
            for key, (label, _) in RESIDUATED_PROPERTIES.items()
        ]
        props += [
            {
                "key": key,
                "label": label,
                "kind": "algebra",
                "description": PROPERTY_DESCRIPTIONS.get(key, f"{label} class."),
            }
            for key, (label, _) in SPECIAL_ALGEBRAS.items()
        ]
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


def property_results(dataset, values):
    return [
        {
            "key": option["key"],
            "label": option["label"],
            "kind": option["kind"],
            "description": option["description"],
            "value": bool(values.get(option["key"], False)),
        }
        for option in property_options(dataset)
    ]


def property_mask(dataset, structure):
    values = property_values(dataset, structure)
    mask = 0
    for bit, key in enumerate(dataset_property_keys(dataset)):
        if values.get(key, False):
            mask |= 1 << bit
    return mask


def entry_keys(dataset, n):
    items = ordered_dataset_items(dataset, n)
    return [
        {"index": i, "encoding": enc.hex(), **({"count": count} if count is not None else {})}
        for i, (enc, count) in enumerate(items)
    ]


@lru_cache(maxsize=64)
def ordered_dataset_items(dataset, n):
    obj = load_dataset(dataset, n)
    if isinstance(obj, set):
        return tuple((enc, None) for enc in sorted(obj))
    return tuple((enc, count) for enc, count in sorted(obj.items(), key=lambda item: item[0]))


def decode_entry(dataset, n, index):
    items = ordered_dataset_items(dataset, n)
    if index < 0 or index >= len(items):
        raise NotFoundError(
            f"index {index} out of range for {dataset}{n} ({len(items)} entries)",
            details={"dataset": dataset, "n": n, "index": index, "total": len(items)},
        )
    enc, extra_count = items[index]
    if dataset == "reslat":
        structure = ResiduatedLattice.decode(enc, n)
        mult_table = structure._mult
        arrow_table = structure._arrow
        negation = [structure.neg(i) for i in range(n)]
    else:
        structure = BoundedLattice.decode(enc, n)
        mult_table = None
        arrow_table = None
        negation = None
    values = property_values(dataset, structure)
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
        "arrow_table": arrow_table,
        "negation": negation,
        "width": structure.width(),
        "height": structure.height(),
        "properties": values,
        "property_items": property_results(dataset, values),
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


def filters_active(filters):
    return any(
        filters[key] is not None
        for key in ("width_min", "width_max", "height_min", "height_max", "count_min", "count_max")
    ) or bool(filters["properties"])


def property_filter_mask(dataset, filters):
    selected = set(filters["properties"])
    mask = 0
    for bit, key in enumerate(dataset_property_keys(dataset)):
        if key in selected:
            mask |= 1 << bit
    return mask


def decode_structure(dataset, n, enc):
    if dataset == "reslat":
        return ResiduatedLattice.decode(enc, n)
    return BoundedLattice.decode(enc, n)


def build_metadata_row(dataset, n, index, enc, count):
    structure = decode_structure(dataset, n, enc)
    return (
        index,
        enc.hex(),
        count,
        structure.width(),
        structure.height(),
    )


def decode_page_item(dataset, n, index, enc, count):
    structure = decode_structure(dataset, n, enc)
    return {
        "index": index,
        "encoding": enc.hex(),
        "count": count,
        "width": structure.width(),
        "height": structure.height(),
    }


def write_metadata_cache(path, payload):
    CACHE.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("wb", dir=CACHE, delete=False) as tmp:
        pickle.dump(payload, tmp, protocol=pickle.HIGHEST_PROTOCOL)
        tmp_path = Path(tmp.name)
    tmp_path.replace(path)


@lru_cache(maxsize=16)
def dataset_metadata(dataset, n):
    source = dataset_path(dataset, n)
    cache_path = metadata_cache_path(dataset, n)
    source_stat = source.stat()
    if cache_path.exists():
        try:
            with cache_path.open("rb") as fh:
                cached = pickle.load(fh)
            if (
                cached.get("version") == CACHE_VERSION
                and
                cached.get("source_mtime_ns") == source_stat.st_mtime_ns
                and cached.get("source_size") == source_stat.st_size
            ):
                LOGGER.info("items.metadata_cache.hit", dataset=dataset, n=n, path=str(cache_path))
                return cached["rows"]
        except Exception:
            LOGGER.warning("items.metadata_cache.invalid", dataset=dataset, n=n, path=str(cache_path))

    LOGGER.info("items.metadata_cache.building", dataset=dataset, n=n)
    rows = tuple(
        build_metadata_row(dataset, n, index, enc, count)
        for index, (enc, count) in enumerate(ordered_dataset_items(dataset, n))
    )
    write_metadata_cache(
        cache_path,
        {
            "version": CACHE_VERSION,
            "dataset": dataset,
            "n": n,
            "source_mtime_ns": source_stat.st_mtime_ns,
            "source_size": source_stat.st_size,
            "rows": rows,
        },
    )
    LOGGER.info("items.metadata_cache.built", dataset=dataset, n=n, rows=len(rows), path=str(cache_path))
    return rows


@lru_cache(maxsize=16)
def dataset_property_masks(dataset, n):
    source = dataset_path(dataset, n)
    cache_path = property_cache_path(dataset, n)
    source_stat = source.stat()
    if cache_path.exists():
        try:
            with cache_path.open("rb") as fh:
                cached = pickle.load(fh)
            if (
                cached.get("version") == CACHE_VERSION
                and
                cached.get("source_mtime_ns") == source_stat.st_mtime_ns
                and cached.get("source_size") == source_stat.st_size
            ):
                LOGGER.info("items.property_cache.hit", dataset=dataset, n=n, path=str(cache_path))
                return cached["masks"]
        except Exception:
            LOGGER.warning("items.property_cache.invalid", dataset=dataset, n=n, path=str(cache_path))

    LOGGER.info("items.property_cache.building", dataset=dataset, n=n)
    masks = tuple(
        property_mask(dataset, decode_structure(dataset, n, enc))
        for enc, _ in ordered_dataset_items(dataset, n)
    )
    write_metadata_cache(
        cache_path,
        {
            "version": CACHE_VERSION,
            "dataset": dataset,
            "n": n,
            "source_mtime_ns": source_stat.st_mtime_ns,
            "source_size": source_stat.st_size,
            "masks": masks,
        },
    )
    LOGGER.info("items.property_cache.built", dataset=dataset, n=n, rows=len(masks), path=str(cache_path))
    return masks


def matches_metadata_row(row, filters):
    _, _, count, width, height = row
    if filters["width_min"] is not None and width < filters["width_min"]:
        return False
    if filters["width_max"] is not None and width > filters["width_max"]:
        return False
    if filters["height_min"] is not None and height < filters["height_min"]:
        return False
    if filters["height_max"] is not None and height > filters["height_max"]:
        return False
    if count is not None:
        if filters["count_min"] is not None and count < filters["count_min"]:
            return False
        if filters["count_max"] is not None and count > filters["count_max"]:
            return False
    return True


def query_items(dataset, n, filters, limit, offset):
    ordered = ordered_dataset_items(dataset, n)
    if not filters_active(filters):
        page = [
            decode_page_item(dataset, n, index, enc, count)
            for index, (enc, count) in enumerate(ordered[offset : offset + limit], start=offset)
        ]
        return {"total": len(ordered), "items": page}

    required_mask = property_filter_mask(dataset, filters)
    rows = dataset_metadata(dataset, n)
    if required_mask:
        prop_masks = dataset_property_masks(dataset, n)
        matched_rows = [
            row
            for row, mask in zip(rows, prop_masks)
            if matches_metadata_row(row, filters) and (mask & required_mask) == required_mask
        ]
    else:
        matched_rows = [row for row in rows if matches_metadata_row(row, filters)]
    page = [
        {
            "index": index,
            "encoding": encoding,
            "count": count,
            "width": width,
            "height": height,
        }
        for index, encoding, count, width, height in matched_rows[offset : offset + limit]
    ]
    return {"total": len(matched_rows), "items": page}


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
                row["reducts"] = sum(1 for count in obj.values() if count > 0)
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
    reducts = summary.get(("extlat", n), {}).get("reducts", 0)
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


@lru_cache(maxsize=64)
def property_count_tables(dataset, n):
    options = property_options(dataset)
    if not options:
        return []
    structural = structural_dataset(dataset)
    keys = dataset_property_keys(structural)
    masks = dataset_property_masks(structural, n)
    key_to_bit = {key: bit for bit, key in enumerate(keys)}
    total = len(masks)
    groups = []
    for kind in ("property", "algebra"):
        rows = []
        for option in options:
            if option["kind"] != kind:
                continue
            bit = key_to_bit.get(option["key"])
            if bit is None:
                continue
            mask = 1 << bit
            count = sum(1 for value in masks if value & mask)
            rows.append(
                {
                    "key": option["key"],
                    "label": option["label"],
                    "description": option["description"],
                    "count": count,
                    "ratio": (count / total) if total else 0,
                }
            )
        if rows:
            rows.sort(key=lambda row: (-row["count"], row["label"].lower()))
            groups.append(
                {
                    "kind": kind,
                    "title": "Property Counts" if kind == "property" else "Algebra Class Counts",
                    "total": total,
                    "rows": rows,
                }
            )
    return groups


@lru_cache(maxsize=64)
def appendix_dimensions(dataset, n):
    dist = width_height_distribution(structural_dataset(dataset), n)
    width_values = [item["value"] for item in dist["widths"]]
    height_values = [item["value"] for item in dist["heights"]]
    cell_map = {(cell["height"], cell["width"]): cell["count"] for cell in dist["cells"]}
    rows = []
    for height in height_values:
        cells = []
        row_total = 0
        for width in width_values:
            count = cell_map.get((height, width), 0)
            row_total += count
            cells.append({"width": width, "count": count})
        rows.append({"height": height, "total": row_total, "cells": cells})
    return {
        "dataset": dataset,
        "n": n,
        "widths": dist["widths"],
        "heights": dist["heights"],
        "rows": rows,
        "total": sum(item["count"] for item in dist["widths"]),
    }


@lru_cache(maxsize=64)
def appendix_tables(dataset, n):
    return {
        "dataset": dataset,
        "n": n,
        "property_groups": property_count_tables(dataset, n),
        "dimensions": appendix_dimensions(dataset, n),
    }


@lru_cache(maxsize=64)
def cooccurrence_matrix(dataset, n):
    options = property_options(dataset)
    if not options:
        return {"dataset": dataset, "n": n, "labels": [], "cells": [], "total": 0}
    structural = structural_dataset(dataset)
    masks = dataset_property_masks(structural, n)
    keys = dataset_property_keys(structural)
    bit_by_key = {key: bit for bit, key in enumerate(keys)}
    entries = [option for option in options if option["key"] in bit_by_key]
    labels = [
        {
            "key": option["key"],
            "label": option["label"],
            "kind": option["kind"],
        }
        for option in entries
    ]
    cells = []
    for row_index, row_option in enumerate(entries):
        row_mask = 1 << bit_by_key[row_option["key"]]
        for col_index, col_option in enumerate(entries):
            if col_index < row_index:
                continue
            col_mask = 1 << bit_by_key[col_option["key"]]
            count = sum(1 for value in masks if (value & row_mask) and (value & col_mask))
            cells.append(
                {
                    "row": row_index,
                    "col": col_index,
                    "count": count,
                }
            )
    return {
        "dataset": dataset,
        "n": n,
        "labels": labels,
        "cells": cells,
        "total": len(masks),
    }


def decode_reslat_family_item(n, index, enc):
    structure = ResiduatedLattice.decode(enc, n)
    return {
        "index": index,
        "encoding": enc.hex(),
        "mult_table": structure._mult,
    }


def reslat_family(n, index, limit=12):
    items = ordered_dataset_items("reslat", n)
    if index < 0 or index >= len(items):
        raise NotFoundError(
            f"index {index} out of range for reslat{n} ({len(items)} entries)",
            details={"dataset": "reslat", "n": n, "index": index, "total": len(items)},
        )
    selected_enc, _ = items[index]
    base_encoding = base_encoding_from_reslat(selected_enc, n)
    suffix_len = len(selected_enc) - len(base_encoding)
    lower = (base_encoding, None)
    upper = (base_encoding + (b"\xff" * suffix_len), None)
    lo = bisect_left(items, lower)
    hi = bisect_right(items, upper)
    total = hi - lo
    if total <= limit:
        start = lo
        end = hi
    else:
        half = limit // 2
        start = max(lo, min(index - half, hi - limit))
        end = min(hi, start + limit)
    extlat_count = load_dataset("extlat", n).get(base_encoding, total)
    entries = [
        decode_reslat_family_item(n, family_index, enc)
        for family_index, (enc, _) in enumerate(items[start:end], start=start)
    ]
    return {
        "n": n,
        "selected_index": index,
        "base_encoding": base_encoding.hex(),
        "total_expansions": extlat_count,
        "shown": len(entries),
        "range_start": start,
        "range_end": end,
        "items": entries,
    }


class Handler(SimpleHTTPRequestHandler):
    def send_response(self, code, message=None):
        self._status_code = code
        super().send_response(code, message)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

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
            payload = decode_entry(dataset, n, index)
            self.send_json(payload)
            return
        if parsed.path == "/":
            self.path = "/index.html"
        super().do_GET()

    def do_GET(self):
        parsed = urlparse(self.path)
        request_id = uuid4().hex[:8]
        started = perf_counter()
        self._status_code = 200
        LOGGER.info("request.started", request_id=request_id, method="GET", path=parsed.path, query=parsed.query or None)
        try:
            self.route_get(parsed)
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
                method="GET",
                path=parsed.path,
                status=self._status_code,
                duration_ms=round((perf_counter() - started) * 1000, 2),
            )

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


if __name__ == "__main__":
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
