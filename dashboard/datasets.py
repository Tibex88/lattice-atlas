import pickle
import tempfile
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

from dashboard.config import (
    BoundedLattice,
    CACHE,
    CACHE_VERSION,
    DATA,
    LATTICE_PROPERTIES,
    PROPERTY_DESCRIPTIONS,
    RESIDUATED_PROPERTIES,
    SPECIAL_ALGEBRAS,
    VALID_DATASETS,
    ResiduatedLattice,
)
from dashboard.errors import DataError, NotFoundError, RequestError


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


def parse_dataset_value(dataset):
    if dataset not in VALID_DATASETS:
        raise RequestError(f"invalid dataset: {dataset}", details={"allowed": sorted(VALID_DATASETS)})
    return dataset


def require_json_string(payload, name):
    value = payload.get(name)
    if value in (None, ""):
        raise RequestError(f"missing string field: {name}")
    if not isinstance(value, str):
        raise RequestError(f"invalid string field: {name}")
    return value


def optional_json_string(payload, name, default=""):
    value = payload.get(name, default)
    if value is None:
        return default
    if not isinstance(value, str):
        raise RequestError(f"invalid string field: {name}")
    return value


def require_json_int(payload, name):
    value = payload.get(name)
    if value in (None, ""):
        raise RequestError(f"missing integer field: {name}")
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise RequestError(f"invalid integer field: {name}={value}") from exc


def optional_json_int(payload, name):
    value = payload.get(name)
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise RequestError(f"invalid integer field: {name}={value}") from exc


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


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
        with path.open("rb") as fh:
            return pickle.load(fh)
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


@lru_cache(maxsize=64)
def ordered_dataset_items(dataset, n):
    obj = load_dataset(dataset, n)
    if isinstance(obj, set):
        return tuple((enc, None) for enc in sorted(obj))
    return tuple((enc, count) for enc, count in sorted(obj.items(), key=lambda item: item[0]))


def entry_keys(dataset, n):
    return [
        {"index": i, "encoding": enc.hex(), **({"count": count} if count is not None else {})}
        for i, (enc, count) in enumerate(ordered_dataset_items(dataset, n))
    ]


def decode_structure(dataset, n, enc):
    if dataset == "reslat":
        return ResiduatedLattice.decode(enc, n)
    return BoundedLattice.decode(enc, n)


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
    from dashboard.errors import LOGGER

    source = dataset_path(dataset, n)
    cache_path = metadata_cache_path(dataset, n)
    source_stat = source.stat()
    if cache_path.exists():
        try:
            with cache_path.open("rb") as fh:
                cached = pickle.load(fh)
            if (
                cached.get("version") == CACHE_VERSION
                and cached.get("source_mtime_ns") == source_stat.st_mtime_ns
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
    from dashboard.errors import LOGGER

    source = dataset_path(dataset, n)
    cache_path = property_cache_path(dataset, n)
    source_stat = source.stat()
    if cache_path.exists():
        try:
            with cache_path.open("rb") as fh:
                cached = pickle.load(fh)
            if (
                cached.get("version") == CACHE_VERSION
                and cached.get("source_mtime_ns") == source_stat.st_mtime_ns
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
