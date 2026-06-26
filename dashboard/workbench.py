from functools import lru_cache

from dashboard.datasets import (
    dataset_metadata,
    dataset_path,
    dataset_property_masks,
    decode_entry,
    matches_metadata_row,
    parse_filters,
    property_filter_mask,
    property_options,
)
from dashboard.errors import RequestError


def parse_smallest_example(params):
    filters = parse_filters(params)
    return {
        "dataset": params.get("dataset", ["reslat"])[0],
        **filters,
    }


@lru_cache(maxsize=64)
def available_sizes(dataset):
    return tuple(n for n in range(1, 13) if dataset_path(dataset, n).exists())


def _label_map(dataset):
    return {item["key"]: item["label"] for item in property_options(dataset)}


def smallest_example(filters):
    dataset = filters["dataset"]
    required_mask = property_filter_mask(dataset, filters)
    if required_mask == 0 and not any(
        filters[key] is not None for key in ("width_min", "width_max", "height_min", "height_max", "count_min", "count_max")
    ):
        raise RequestError("select at least one property or structural bound for smallest-example search")

    label_map = _label_map(dataset)
    for n in available_sizes(dataset):
        rows = dataset_metadata(dataset, n)
        prop_masks = dataset_property_masks(dataset, n) if required_mask else None
        for row_index, row in enumerate(rows):
            if not matches_metadata_row(row, filters):
                continue
            if required_mask and (prop_masks[row_index] & required_mask) != required_mask:
                continue
            entry = decode_entry(dataset, n, row[0])
            matched = [label_map[key] for key in filters["properties"] if key in label_map]
            return {
                "found": True,
                "dataset": dataset,
                "n": n,
                "index": row[0],
                "matched_properties": matched,
                "explanation": f"Smallest {dataset} example found at n={n}, index {row[0]}.",
                "entry": entry,
            }
    return {
        "found": False,
        "dataset": dataset,
        "matched_properties": [label_map[key] for key in filters["properties"] if key in label_map],
        "explanation": f"No {dataset} example matched the selected constraints.",
    }


def _comparability_density(order_matrix):
    n = len(order_matrix)
    comparable = 0
    total = 0
    for i in range(n):
        for j in range(i + 1, n):
            total += 1
            if order_matrix[i][j] or order_matrix[j][i]:
                comparable += 1
    return comparable / total if total else 1.0


def _comparability_counts(order_matrix):
    n = len(order_matrix)
    return [
        sum(1 for j in range(n) if order_matrix[i][j] or order_matrix[j][i])
        for i in range(n)
    ]


def _variety_band(width, n):
    if width <= 2:
        return {
            "level": "low",
            "summary": "Few incomparable branches. Choice lanes are tight and easier to reason about.",
        }
    if width <= max(3, n // 3):
        return {
            "level": "balanced",
            "summary": "Moderate branching. There is room for distinct options without losing structure.",
        }
    return {
        "level": "high",
        "summary": "Many incomparable branches. This shape supports broad variety and more parallel options.",
    }


def _depth_band(height, n):
    if height >= max(4, n - 1):
        return {
            "level": "deep",
            "summary": "Long progression chain. Advancement can feel staged and layered.",
        }
    if height >= max(3, n // 2):
        return {
            "level": "layered",
            "summary": "Several progression layers without collapsing into a near-chain.",
        }
    return {
        "level": "shallow",
        "summary": "Short progression depth. Branches dominate more than long advancement paths.",
    }


def _redundancy_band(width, density):
    if width <= 2 and density >= 0.75:
        return {
            "level": "high",
            "summary": "Many elements are comparable and the branch width is narrow, so roles may collapse into each other.",
        }
    if width <= 3 and density >= 0.6:
        return {
            "level": "medium",
            "summary": "Some branches remain distinct, but the shape still trends toward reuse and overlap.",
        }
    return {
        "level": "low",
        "summary": "The structure leaves enough incomparable space to resist obvious redundancy.",
    }


def _centralization_band(width, density, interior_peak, n):
    if width <= 2 and density >= 0.75 and interior_peak >= max(3, n - 1):
        return {
            "level": "high",
            "summary": "Interior nodes dominate many relations. A few skills could become chokepoints in the design language.",
        }
    if density >= 0.65 and interior_peak >= max(3, n - 2):
        return {
            "level": "medium",
            "summary": "Some middle nodes organize a large part of the space and may deserve extra scrutiny.",
        }
    return {
        "level": "low",
        "summary": "No obvious interior chokepoint dominates the shape.",
    }


def design_language_report(dataset, n, index):
    entry = decode_entry(dataset, n, index)
    density = _comparability_density(entry["order_matrix"])
    counts = _comparability_counts(entry["order_matrix"])
    interior = [(node, value) for node, value in enumerate(counts) if node not in (0, entry["n"] - 1)]
    interior.sort(key=lambda item: (-item[1], item[0]))
    interior_peak = interior[0][1] if interior else counts[0]

    variety = _variety_band(entry["width"], entry["n"])
    depth = _depth_band(entry["height"], entry["n"])
    redundancy = _redundancy_band(entry["width"], density)
    centralization = _centralization_band(entry["width"], density, interior_peak, entry["n"])
    shape_name = "tall and thin" if entry["width"] <= 2 and entry["height"] >= max(4, entry["n"] // 2) else (
        "wide and choice-heavy" if entry["width"] >= max(4, entry["n"] // 3) else "mixed-shape"
    )

    drivers = [
        {
            "node": node,
            "comparable_count": value,
            "summary": f"Node {node} is comparable with {value} of {entry['n']} elements.",
        }
        for node, value in interior[:3]
    ]

    return {
        "dataset": dataset,
        "n": n,
        "index": index,
        "shape_name": shape_name,
        "summary": (
            f"This {shape_name} blueprint has width {entry['width']} and height {entry['height']}. "
            f"Comparability density is {density:.2f}."
        ),
        "metrics": [
            {"key": "variety", "label": "Variety Pressure", "value": entry["width"], **variety},
            {"key": "depth", "label": "Progression Depth", "value": entry["height"], **depth},
            {"key": "redundancy", "label": "Redundancy Risk", "value": round(density, 2), **redundancy},
            {"key": "centralization", "label": "Over-Centralization Risk", "value": interior_peak, **centralization},
        ],
        "drivers": drivers,
    }


def counter_gap_analysis(dataset, n, index):
    if dataset != "reslat":
        return {
            "available": False,
            "dataset": dataset,
            "n": n,
            "index": index,
            "reason": "Counter-gap analysis needs a residuated lattice because it relies on the residuum table.",
        }

    entry = decode_entry(dataset, n, index)
    order = entry["order_matrix"]
    arrow = entry["arrow_table"]
    levels = entry["levels"]
    rows = []

    for left in range(n):
        for right in range(n):
            if left == right or order[left][right]:
                continue
            strongest = arrow[left][right]
            support_nodes = [node for node in range(n) if order[node][strongest]]
            support_size = len(support_nodes)
            severity = (n - support_size) * 10 + (5 if strongest == 0 else 0) + abs(levels[left] - levels[right])
            if support_size == 1:
                level = "bottom-only"
            elif support_size <= max(2, n // 3):
                level = "tight"
            else:
                level = "open"
            rows.append(
                {
                    "from_node": left,
                    "to_node": right,
                    "strongest_counter": strongest,
                    "support_nodes": support_nodes,
                    "support_size": support_size,
                    "severity": severity,
                    "level": level,
                    "explanation": (
                        f"To keep {left} within {right}, the strongest admissible added behavior is node {strongest}; "
                        f"{support_size} elements lie below that bound."
                    ),
                }
            )

    rows.sort(key=lambda item: (-item["severity"], item["support_size"], item["from_node"], item["to_node"]))
    top = rows[:8]
    return {
        "available": True,
        "dataset": dataset,
        "n": n,
        "index": index,
        "summary": (
            f"{sum(1 for item in rows if item['support_size'] == 1)} bottom-only regions and "
            f"{sum(1 for item in rows if item['support_size'] <= max(2, n // 3))} tight regions found."
        ),
        "items": top,
    }
