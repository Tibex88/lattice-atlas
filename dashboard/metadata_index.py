import argparse
import sqlite3
from pathlib import Path

from dashboard.config import METADATA_INDEX_VERSION, SQLITE_DB, VALID_DATASETS
from dashboard.datasets import (
    dataset_path,
    decode_structure,
    ordered_dataset_items,
    property_mask,
    search_result_details_from_encoding,
)
from dashboard.errors import LOGGER, DataError, ServiceUnavailableError


def available_sizes(dataset):
    return tuple(n for n in range(1, 13) if dataset_path(dataset, n).exists())


class MetadataIndexStore:
    _instance = None

    @classmethod
    def get(cls):
        if cls._instance is None:
            cls._instance = cls(SQLITE_DB, LOGGER)
        return cls._instance

    def __init__(self, path, logger):
        self.path = Path(path)
        self.logger = logger
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self):
        conn = sqlite3.connect(self.path, timeout=60)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA temp_store=MEMORY")
        conn.execute("PRAGMA busy_timeout=60000")
        return conn

    def _initialize(self):
        try:
            with self._connect() as conn:
                conn.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS metadata_index_slices (
                        dataset TEXT NOT NULL,
                        n INTEGER NOT NULL,
                        version INTEGER NOT NULL,
                        source_mtime_ns INTEGER NOT NULL,
                        source_size INTEGER NOT NULL,
                        row_count INTEGER NOT NULL,
                        last_entry_index INTEGER NOT NULL DEFAULT -1,
                        is_complete INTEGER NOT NULL DEFAULT 0,
                        built_at TEXT NOT NULL,
                        PRIMARY KEY (dataset, n)
                    );

                    CREATE TABLE IF NOT EXISTS metadata_index_entries (
                        dataset TEXT NOT NULL,
                        n INTEGER NOT NULL,
                        entry_index INTEGER NOT NULL,
                        encoding BLOB NOT NULL,
                        structure_count INTEGER,
                        width INTEGER NOT NULL,
                        height INTEGER NOT NULL,
                        size_rank INTEGER NOT NULL,
                        property_mask INTEGER NOT NULL,
                        PRIMARY KEY (dataset, n, entry_index)
                    );

                    CREATE INDEX IF NOT EXISTS idx_metadata_index_dims
                    ON metadata_index_entries(dataset, n, width, height, size_rank, entry_index);

                    CREATE INDEX IF NOT EXISTS idx_metadata_index_rank
                    ON metadata_index_entries(dataset, n, size_rank, width, height, entry_index);

                    CREATE INDEX IF NOT EXISTS idx_metadata_index_extlat_rank
                    ON metadata_index_entries(dataset, n, structure_count DESC, size_rank, width, height, entry_index);
                    """
                )
                columns = {
                    row["name"]
                    for row in conn.execute("PRAGMA table_info(metadata_index_entries)").fetchall()
                }
                if "encoding" not in columns:
                    conn.execute("ALTER TABLE metadata_index_entries ADD COLUMN encoding BLOB")
                    conn.execute("DELETE FROM metadata_index_slices")
                    conn.execute("DELETE FROM metadata_index_entries")
                slice_columns = {
                    row["name"]
                    for row in conn.execute("PRAGMA table_info(metadata_index_slices)").fetchall()
                }
                if "last_entry_index" not in slice_columns:
                    conn.execute("ALTER TABLE metadata_index_slices ADD COLUMN last_entry_index INTEGER NOT NULL DEFAULT -1")
                if "is_complete" not in slice_columns:
                    conn.execute("ALTER TABLE metadata_index_slices ADD COLUMN is_complete INTEGER NOT NULL DEFAULT 0")
        except sqlite3.OperationalError as exc:
            if "locked" in str(exc).lower():
                raise ServiceUnavailableError(
                    "metadata index schema update could not acquire a database lock",
                    public_message=(
                        "The metadata index needs a one-time schema update. Stop the running app/server, "
                        "run the index command once, then start the app again."
                    ),
                ) from exc
            raise
        self.logger.info("metadata_index.ready", path=str(self.path), version=METADATA_INDEX_VERSION)

    def _source_state(self, dataset, n):
        source = dataset_path(dataset, n)
        if not source.exists():
            raise DataError(f"missing dataset file: {source.name}", details={"path": str(source)})
        stat = source.stat()
        return source, stat.st_mtime_ns, stat.st_size

    def _slice_record(self, conn, dataset, n):
        return conn.execute(
            """
            SELECT *
            FROM metadata_index_slices
            WHERE dataset = ? AND n = ?
            """,
            (dataset, n),
        ).fetchone()

    def _entry_progress(self, conn, dataset, n):
        row = conn.execute(
            """
            SELECT COUNT(*) AS row_count, MAX(entry_index) AS max_entry_index
            FROM metadata_index_entries
            WHERE dataset = ? AND n = ?
            """,
            (dataset, n),
        ).fetchone()
        row_count = int(row["row_count"] or 0)
        max_entry_index = int(row["max_entry_index"]) if row["max_entry_index"] is not None else -1
        return row_count, max_entry_index

    def _reconcile_slice_progress(self, conn, dataset, n, slice_row):
        actual_count, actual_max_index = self._entry_progress(conn, dataset, n)
        if not slice_row:
            return actual_count, actual_max_index
        if (
            int(slice_row["row_count"]) != actual_count
            or int(slice_row["last_entry_index"]) != actual_max_index
        ):
            conn.execute(
                """
                UPDATE metadata_index_slices
                SET row_count = ?, last_entry_index = ?
                WHERE dataset = ? AND n = ?
                """,
                (actual_count, actual_max_index, dataset, n),
            )
            conn.commit()
            self.logger.warning(
                "metadata_index.slice.reconciled",
                dataset=dataset,
                n=n,
                stored_row_count=int(slice_row["row_count"]),
                actual_row_count=actual_count,
                stored_last_entry_index=int(slice_row["last_entry_index"]),
                actual_last_entry_index=actual_max_index,
            )
        return actual_count, actual_max_index

    def slice_status(self, dataset, n):
        _source, source_mtime_ns, source_size = self._source_state(dataset, n)
        with self._connect() as conn:
            row = self._slice_record(conn, dataset, n)
        fresh = bool(
            row
            and row["version"] == METADATA_INDEX_VERSION
            and row["source_mtime_ns"] == source_mtime_ns
            and row["source_size"] == source_size
            and row["is_complete"] == 1
        )
        return {
            "dataset": dataset,
            "n": n,
            "indexed": fresh,
            "row_count": row["row_count"] if row else 0,
            "last_entry_index": row["last_entry_index"] if row else -1,
            "is_complete": bool(row["is_complete"]) if row else False,
            "built_at": row["built_at"] if row else None,
            "source_mtime_ns": source_mtime_ns,
            "source_size": source_size,
        }

    def require_slices(self, dataset, sizes):
        missing = [status for status in (self.slice_status(dataset, n) for n in sizes) if not status["indexed"]]
        if not missing:
            return
        labels = ", ".join(f"{dataset}{item['n']}" for item in missing[:6])
        if len(missing) > 6:
            labels += f", and {len(missing) - 6} more"
        command_bits = " ".join(f"--n {item['n']}" for item in missing)
        raise ServiceUnavailableError(
            f"metadata index is missing for {labels}",
            public_message=(
                f"Search index missing for {labels}. Build it first with "
                f"`python3 -m dashboard.metadata_index --dataset {dataset} {command_bits}`."
            ),
            details={"dataset": dataset, "missing_sizes": [item["n"] for item in missing]},
        )

    def build_slice(self, dataset, n, *, force=False, batch_size=5000):
        _source, source_mtime_ns, source_size = self._source_state(dataset, n)
        status = self.slice_status(dataset, n)
        if status["indexed"] and not force:
            self.logger.info("metadata_index.slice.hit", dataset=dataset, n=n, rows=status["row_count"])
            return status

        self.logger.info("metadata_index.slice.building", dataset=dataset, n=n, force=force)
        rows_written = 0
        start_index = 0
        batch = []
        with self._connect() as conn:
            slice_row = self._slice_record(conn, dataset, n)
            can_resume = bool(
                not force
                and slice_row
                and slice_row["version"] == METADATA_INDEX_VERSION
                and slice_row["source_mtime_ns"] == source_mtime_ns
                and slice_row["source_size"] == source_size
            )
            if can_resume:
                rows_written, last_entry_index = self._reconcile_slice_progress(conn, dataset, n, slice_row)
                start_index = last_entry_index + 1
                self.logger.info(
                    "metadata_index.slice.resume",
                    dataset=dataset,
                    n=n,
                    row_count=rows_written,
                    next_index=start_index,
                )
            else:
                conn.execute("DELETE FROM metadata_index_entries WHERE dataset = ? AND n = ?", (dataset, n))
                conn.execute("DELETE FROM metadata_index_slices WHERE dataset = ? AND n = ?", (dataset, n))
                conn.execute(
                    """
                    INSERT INTO metadata_index_slices (
                        dataset, n, version, source_mtime_ns, source_size, row_count,
                        last_entry_index, is_complete, built_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                    """,
                    (dataset, n, METADATA_INDEX_VERSION, source_mtime_ns, source_size, 0, -1, 0),
                )
                conn.commit()

            for index, (enc, count) in enumerate(ordered_dataset_items(dataset, n)):
                if index < start_index:
                    continue
                structure = decode_structure(dataset, n, enc)
                width = structure.width()
                height = structure.height()
                batch.append(
                    (
                        dataset,
                        n,
                        index,
                        sqlite3.Binary(enc),
                        count,
                        width,
                        height,
                        width * height,
                        property_mask(dataset, structure),
                    )
                )
                if len(batch) >= batch_size:
                    conn.executemany(
                        """
                        INSERT OR REPLACE INTO metadata_index_entries (
                            dataset, n, entry_index, encoding, structure_count, width, height, size_rank, property_mask
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        batch,
                    )
                    rows_written += len(batch)
                    last_index = batch[-1][2]
                    batch.clear()
                    conn.execute(
                        """
                        UPDATE metadata_index_slices
                        SET row_count = ?, last_entry_index = ?, is_complete = 0, built_at = datetime('now')
                        WHERE dataset = ? AND n = ?
                        """,
                        (rows_written, last_index, dataset, n),
                    )
                    conn.commit()
                    if rows_written and rows_written % 50000 == 0:
                        self.logger.info("metadata_index.slice.progress", dataset=dataset, n=n, rows=rows_written)
            if batch:
                conn.executemany(
                    """
                    INSERT OR REPLACE INTO metadata_index_entries (
                        dataset, n, entry_index, encoding, structure_count, width, height, size_rank, property_mask
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    batch,
                )
                rows_written += len(batch)
                last_index = batch[-1][2]
                batch.clear()
                conn.execute(
                    """
                    UPDATE metadata_index_slices
                    SET row_count = ?, last_entry_index = ?, is_complete = 0, built_at = datetime('now')
                    WHERE dataset = ? AND n = ?
                    """,
                    (rows_written, last_index, dataset, n),
                )
                conn.commit()
            conn.execute(
                """
                INSERT INTO metadata_index_slices (
                    dataset, n, version, source_mtime_ns, source_size, row_count,
                    last_entry_index, is_complete, built_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                ON CONFLICT(dataset, n) DO UPDATE SET
                    version = excluded.version,
                    source_mtime_ns = excluded.source_mtime_ns,
                    source_size = excluded.source_size,
                    row_count = excluded.row_count,
                    last_entry_index = excluded.last_entry_index,
                    is_complete = excluded.is_complete,
                    built_at = excluded.built_at
                """,
                (dataset, n, METADATA_INDEX_VERSION, source_mtime_ns, source_size, rows_written, rows_written - 1, 1),
            )
            conn.commit()
        self.logger.info("metadata_index.slice.built", dataset=dataset, n=n, rows=rows_written)
        return self.slice_status(dataset, n)

    def build_many(self, dataset, sizes, *, force=False):
        built = []
        for n in sizes:
            built.append(self.build_slice(dataset, n, force=force))
        return built

    def search(self, filters):
        dataset = filters["dataset"]
        n_min = min(filters["n_min"], filters["n_max"])
        n_max = max(filters["n_min"], filters["n_max"])
        sizes = [n for n in available_sizes(dataset) if n_min <= n <= n_max]
        self.require_slices(dataset, sizes)

        where = ["dataset = ?", "n >= ?", "n <= ?"]
        params = [dataset, n_min, n_max]
        if filters["width_min"] is not None:
            where.append("width >= ?")
            params.append(filters["width_min"])
        if filters["width_max"] is not None:
            where.append("width <= ?")
            params.append(filters["width_max"])
        if filters["height_min"] is not None:
            where.append("height >= ?")
            params.append(filters["height_min"])
        if filters["height_max"] is not None:
            where.append("height <= ?")
            params.append(filters["height_max"])
        if filters["count_min"] is not None:
            where.append("structure_count >= ?")
            params.append(filters["count_min"])
        if filters["count_max"] is not None:
            where.append("structure_count <= ?")
            params.append(filters["count_max"])
        required_mask = filters["required_mask"]
        if required_mask:
            where.append("(property_mask & ?) = ?")
            params.extend([required_mask, required_mask])

        where_sql = " AND ".join(where)
        order_sql = (
            "n ASC, structure_count DESC, size_rank ASC, width ASC, height ASC, entry_index ASC"
            if dataset == "extlat"
            else "n ASC, size_rank ASC, width ASC, height ASC, entry_index ASC"
        )
        limit = max(1, min(int(filters["limit"]), 250))
        with self._connect() as conn:
            total = conn.execute(
                f"SELECT COUNT(*) FROM metadata_index_entries WHERE {where_sql}",
                params,
            ).fetchone()[0]
            rows = conn.execute(
                f"""
                SELECT dataset, n, entry_index, encoding, structure_count, width, height
                FROM metadata_index_entries
                WHERE {where_sql}
                ORDER BY {order_sql}
                LIMIT ?
                """,
                [*params, limit],
            ).fetchall()

        items = []
        for row in rows:
            details = search_result_details_from_encoding(
                row["dataset"],
                row["n"],
                bytes(row["encoding"]),
                count=row["structure_count"],
            )
            items.append(
                {
                    "dataset": row["dataset"],
                    "n": row["n"],
                    "index": row["entry_index"],
                    "encoding": details["encoding"],
                    "count": row["structure_count"],
                    "width": row["width"],
                    "height": row["height"],
                    "preview": details["preview"],
                }
            )
        return {
            "dataset": dataset,
            "n_min": n_min,
            "n_max": n_max,
            "limit": limit,
            "total": total,
            "items": items,
        }


METADATA_INDEX = MetadataIndexStore.get()


def parse_args():
    parser = argparse.ArgumentParser(description="Build the persistent blueprint-search metadata index.")
    parser.add_argument("--dataset", required=True, choices=sorted(VALID_DATASETS))
    parser.add_argument("--n", dest="sizes", action="append", type=int, help="Structure size to index. Repeatable.")
    parser.add_argument("--all", action="store_true", help="Build all available sizes for the dataset.")
    parser.add_argument("--force", action="store_true", help="Rebuild even if the slice is already fresh.")
    return parser.parse_args()


def main():
    args = parse_args()
    sizes = available_sizes(args.dataset) if args.all or not args.sizes else tuple(sorted(set(args.sizes)))
    if not sizes:
        raise SystemExit("No dataset sizes selected for indexing.")
    built = METADATA_INDEX.build_many(args.dataset, sizes, force=args.force)
    labels = ", ".join(f"{args.dataset}{item['n']}" for item in built)
    print(f"Indexed {labels}")


if __name__ == "__main__":
    main()
