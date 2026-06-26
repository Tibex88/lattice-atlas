from bisect import bisect_left, bisect_right
from functools import lru_cache

from dashboard.config import BoundedLattice, DataStore, ResiduatedLattice
from dashboard.datasets import (
    base_encoding_from_reslat,
    dataset_path,
    dataset_property_keys,
    dataset_property_masks,
    load_dataset,
    object_count,
    ordered_dataset_items,
    property_options,
    structural_dataset,
)
from dashboard.errors import LOGGER, NotFoundError


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
    labels = [{"key": option["key"], "label": option["label"], "kind": option["kind"]} for option in entries]
    cells = []
    for row_index, row_option in enumerate(entries):
        row_mask = 1 << bit_by_key[row_option["key"]]
        for col_index, col_option in enumerate(entries):
            if col_index < row_index:
                continue
            col_mask = 1 << bit_by_key[col_option["key"]]
            count = sum(1 for value in masks if (value & row_mask) and (value & col_mask))
            cells.append({"row": row_index, "col": col_index, "count": count})
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
