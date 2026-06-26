from functools import lru_cache

from dashboard.datasets import (
    dataset_metadata,
    dataset_path,
    dataset_property_masks,
    matches_metadata_row,
    parse_int,
    property_options,
    property_filter_mask,
)


def parse_blueprint_search(params):
    def optional_int(name):
        value = params.get(name, [""])[0]
        return int(value) if value not in ("", None) else None

    return {
        "dataset": params.get("dataset", ["lat"])[0],
        "n_min": parse_int(params, "n_min", default=1),
        "n_max": parse_int(params, "n_max", default=12),
        "limit": parse_int(params, "limit", default=25),
        "width_min": optional_int("width_min"),
        "width_max": optional_int("width_max"),
        "height_min": optional_int("height_min"),
        "height_max": optional_int("height_max"),
        "count_min": optional_int("count_min"),
        "count_max": optional_int("count_max"),
        "properties": tuple(params.get("prop", [])),
    }


def _property_label_map(dataset):
    return {item["key"]: item["label"] for item in property_options(dataset)}


def _ranking_key(dataset, row):
    index, _encoding, count, width, height = row
    if dataset == "extlat":
        return (-int(count or 0), width * height, width, height, index)
    return (width * height, width, height, index)


def _explanation(dataset, n, row, filters, label_map):
    index, _encoding, count, width, height = row
    bits = [f"{dataset}{n}", f"index {index}", f"width {width}", f"height {height}"]
    if count is not None:
        bits.append(f"count {count}")
    matched = [label_map[key] for key in filters["properties"] if key in label_map]
    if matched:
        bits.append(f"properties {', '.join(matched)}")
    if dataset == "extlat":
        bits.append("ranked by expansion count, then simpler shape")
    else:
        bits.append("ranked by simpler shape first")
    return "Matched " + " • ".join(bits)


@lru_cache(maxsize=128)
def available_sizes(dataset):
    return tuple(n for n in range(1, 13) if dataset_path(dataset, n).exists())


def blueprint_search(filters):
    dataset = filters["dataset"]
    n_min = min(filters["n_min"], filters["n_max"])
    n_max = max(filters["n_min"], filters["n_max"])
    limit = max(1, min(filters["limit"], 250))
    required_mask = property_filter_mask(dataset, filters)
    label_map = _property_label_map(dataset)
    matches = []

    for n in available_sizes(dataset):
        if n < n_min or n > n_max:
            continue
        rows = dataset_metadata(dataset, n)
        prop_masks = dataset_property_masks(dataset, n) if required_mask else None
        for row_index, row in enumerate(rows):
            if not matches_metadata_row(row, filters):
                continue
            if required_mask and (prop_masks[row_index] & required_mask) != required_mask:
                continue
            index, encoding, count, width, height = row
            matches.append(
                {
                    "dataset": dataset,
                    "n": n,
                    "index": index,
                    "encoding": encoding,
                    "count": count,
                    "width": width,
                    "height": height,
                    "matched_property_keys": [key for key in filters["properties"] if key in label_map],
                    "matched_properties": [label_map[key] for key in filters["properties"] if key in label_map],
                    "explanation": _explanation(dataset, n, row, filters, label_map),
                    "_sort": (n,) + _ranking_key(dataset, row),
                }
            )

    matches.sort(key=lambda item: item["_sort"])
    items = [{key: value for key, value in item.items() if key != "_sort"} for item in matches[:limit]]
    return {
        "dataset": dataset,
        "n_min": n_min,
        "n_max": n_max,
        "limit": limit,
        "total": len(matches),
        "items": items,
    }
