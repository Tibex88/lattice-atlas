#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARCHIVE_PATH="${ROOT_DIR}/data.tar.gz"
TARGET_DIR="${ROOT_DIR}"

if [[ ! -f "${ARCHIVE_PATH}" ]]; then
  echo "Archive not found: ${ARCHIVE_PATH}" >&2
  exit 1
fi

if ! tar -tzf "${ARCHIVE_PATH}" >/dev/null 2>&1; then
  echo "Invalid archive: ${ARCHIVE_PATH}" >&2
  exit 1
fi

tar -xzf "${ARCHIVE_PATH}" -C "${TARGET_DIR}"

echo "Extracted ${ARCHIVE_PATH} into ${TARGET_DIR}/data"
