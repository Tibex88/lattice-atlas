import importlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
DATA = ROOT / "data"
ARTIFACTS = ROOT / "artifacts"
CACHE = ARTIFACTS / "metadata-cache"
SQLITE_DB = ARTIFACTS / "dashboard.sqlite3"
WEB = ROOT / "web"
CACHE_VERSION = 2

sys.path.insert(0, str(SRC))
from prog import BoundedLattice, DataStore, ResiduatedLattice  # noqa: E402

schema_module = importlib.import_module("schemas")


def _slug(label):
    return "".join(ch.lower() if ch.isalnum() else "_" for ch in label).strip("_")


LATTICE_PROPERTIES = {_slug(name): (name, fn) for name, fn in schema_module.lattice_properties.attributes}
RESIDUATED_PROPERTIES = {
    _slug(name): (name, fn) for name, fn in schema_module.residuated_properties.attributes
}
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
