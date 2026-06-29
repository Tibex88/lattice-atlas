import json
import logging
import pickle
import sqlite3


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


class ServiceUnavailableError(AppError):
    def __init__(self, message, *, details=None, public_message=None):
        super().__init__(
            message,
            kind="runtime",
            status=503,
            public_message=public_message or message,
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
        if isinstance(error, sqlite3.DatabaseError):
            return RuntimeFault("sqlite storage failure", details={"type": type(error).__name__})
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
