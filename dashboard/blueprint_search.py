from dashboard.datasets import (
    parse_int,
    property_options,
    property_filter_mask,
)
from dashboard.metadata_index import METADATA_INDEX


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


def _explanation(dataset, n, row, filters, label_map):
    index, _encoding, count, width, height, *_rest = row
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

def blueprint_search(filters):
    dataset = filters["dataset"]
    n_min = min(filters["n_min"], filters["n_max"])
    n_max = max(filters["n_min"], filters["n_max"])
    limit = max(1, min(filters["limit"], 250))
    required_mask = property_filter_mask(dataset, filters)
    label_map = _property_label_map(dataset)
    payload = METADATA_INDEX.search(
        {
            **filters,
            "dataset": dataset,
            "n_min": n_min,
            "n_max": n_max,
            "limit": limit,
            "required_mask": required_mask,
        }
    )
    items = []
    for item in payload["items"]:
        row = (
            item["index"],
            item["encoding"],
            item["count"],
            item["width"],
            item["height"],
            item["preview"],
        )
        items.append(
            {
                **item,
                "matched_property_keys": [key for key in filters["properties"] if key in label_map],
                "matched_properties": [label_map[key] for key in filters["properties"] if key in label_map],
                "explanation": _explanation(dataset, item["n"], row, filters, label_map),
            }
        )
    return {
        "dataset": dataset,
        "n_min": n_min,
        "n_max": n_max,
        "limit": limit,
        "total": payload["total"],
        "items": items,
    }
