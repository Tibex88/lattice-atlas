import os
from time import perf_counter
from urllib.parse import parse_qs
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from dashboard.analytics import (
    appendix_tables,
    cooccurrence_matrix,
    dataset_summary,
    extlat_rankings,
    filter_bounds,
    level_metrics,
    reslat_family,
    width_height_distribution,
)
from dashboard.blueprint_search import blueprint_search, parse_blueprint_search
from dashboard.config import WEB
from dashboard.datasets import (
    decode_entry,
    optional_json_int,
    optional_json_string,
    parse_dataset,
    parse_dataset_value,
    parse_filters,
    parse_int,
    property_options,
    qualification_report,
    query_items,
    require_json_int,
    require_json_string,
)
from dashboard.errors import ERRORS, LOGGER, RequestError
from dashboard.storage import STORE
from dashboard.workbench import (
    counter_gap_analysis,
    design_language_report,
    parse_smallest_example,
    smallest_example,
)


def query_param_map(request):
    values = {}
    for key, value in request.query_params.multi_items():
        values.setdefault(key, []).append(value)
    return values


async def parse_json_body(request):
    try:
        payload = await request.json()
    except Exception as exc:
        raise RequestError("request body is not valid JSON") from exc
    if not isinstance(payload, dict):
        raise RequestError("request body must be a JSON object")
    return payload


def error_response(app_error, request_id):
    return JSONResponse(
        {
            "error": {
                "kind": app_error.kind,
                "message": app_error.public_message,
                "request_id": request_id,
            }
        },
        status_code=app_error.status,
    )


app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.middleware("http")
async def request_middleware(request: Request, call_next):
    request_id = uuid4().hex[:8]
    request.state.request_id = request_id
    started = perf_counter()
    LOGGER.info(
        "request.started",
        request_id=request_id,
        method=request.method,
        path=request.url.path,
        query=request.url.query or None,
    )
    response = None
    try:
        response = await call_next(request)
    except Exception as exc:
        app_error = ERRORS.capture(
            exc,
            request_id=request_id,
            path=request.url.path,
            query=request.url.query,
        )
        response = error_response(app_error, request_id)
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    LOGGER.info(
        "request.completed",
        request_id=request_id,
        method=request.method,
        path=request.url.path,
        status=response.status_code,
        duration_ms=round((perf_counter() - started) * 1000, 2),
    )
    return response


@app.get("/api/summary")
async def summary_endpoint():
    return dataset_summary()


@app.get("/api/filter-options")
async def filter_options_endpoint(request: Request):
    params = query_param_map(request)
    dataset = parse_dataset(params)
    return {"dataset": dataset, "properties": property_options(dataset)}


@app.get("/api/filter-bounds")
async def filter_bounds_endpoint(request: Request):
    params = query_param_map(request)
    dataset = parse_dataset(params)
    n = parse_int(params, "n", default=1)
    return filter_bounds(dataset, n)


@app.get("/api/level-metrics")
async def level_metrics_endpoint(request: Request):
    params = query_param_map(request)
    n = parse_int(params, "n", default=1)
    return level_metrics(n)


@app.get("/api/width-height")
async def width_height_endpoint(request: Request):
    params = query_param_map(request)
    dataset = parse_dataset(params)
    n = parse_int(params, "n", default=1)
    return width_height_distribution(dataset, n)


@app.get("/api/extlat-rankings")
async def extlat_rankings_endpoint(request: Request):
    params = query_param_map(request)
    n = parse_int(params, "n", default=1)
    limit = parse_int(params, "limit", default=12)
    return extlat_rankings(n, limit)


@app.get("/api/cooccurrence")
async def cooccurrence_endpoint(request: Request):
    params = query_param_map(request)
    dataset = parse_dataset(params)
    n = parse_int(params, "n", default=1)
    return cooccurrence_matrix(dataset, n)


@app.get("/api/appendix-tables")
async def appendix_tables_endpoint(request: Request):
    params = query_param_map(request)
    dataset = parse_dataset(params)
    n = parse_int(params, "n", default=1)
    return appendix_tables(dataset, n)


@app.get("/api/reslat-family")
async def reslat_family_endpoint(request: Request):
    params = query_param_map(request)
    n = parse_int(params, "n")
    index = parse_int(params, "index")
    limit = parse_int(params, "limit", default=12)
    return reslat_family(n, index, limit)


@app.get("/api/items")
async def items_endpoint(request: Request):
    params = query_param_map(request)
    dataset = parse_dataset(params)
    n = parse_int(params, "n", default=1)
    limit = parse_int(params, "limit", default=100)
    offset = parse_int(params, "offset", default=0)
    filters = parse_filters(params)
    return query_items(dataset, n, filters, limit, offset)


@app.get("/api/entry")
async def entry_endpoint(request: Request):
    params = query_param_map(request)
    dataset = parse_dataset(params, default=None)
    n = parse_int(params, "n")
    index = parse_int(params, "index")
    return decode_entry(dataset, n, index)


@app.get("/api/why-qualified")
async def why_qualified_endpoint(request: Request):
    params = query_param_map(request)
    dataset = parse_dataset(params, default=None)
    n = parse_int(params, "n")
    index = parse_int(params, "index")
    keys = tuple(params.get("prop", []))
    return qualification_report(dataset, n, index, keys=keys)


@app.get("/api/blueprint-search")
async def blueprint_search_endpoint(request: Request):
    params = query_param_map(request)
    filters = parse_blueprint_search(params)
    filters["dataset"] = parse_dataset(params)
    return blueprint_search(filters)


@app.get("/api/smallest-example")
async def smallest_example_endpoint(request: Request):
    params = query_param_map(request)
    filters = parse_smallest_example(params)
    filters["dataset"] = parse_dataset(params)
    return smallest_example(filters)


@app.get("/api/design-report")
async def design_report_endpoint(request: Request):
    params = query_param_map(request)
    dataset = parse_dataset(params)
    n = parse_int(params, "n")
    index = parse_int(params, "index")
    return design_language_report(dataset, n, index)


@app.get("/api/counter-gap")
async def counter_gap_endpoint(request: Request):
    params = query_param_map(request)
    dataset = parse_dataset(params)
    n = parse_int(params, "n")
    index = parse_int(params, "index")
    return counter_gap_analysis(dataset, n, index)


@app.get("/api/storage")
async def storage_endpoint():
    return STORE.status()


@app.get("/api/blueprints")
async def blueprints_list_endpoint():
    return {"items": STORE.list_blueprints()}


@app.post("/api/blueprints")
async def blueprints_save_endpoint(request: Request):
    payload = await parse_json_body(request)
    dataset = parse_dataset_value(require_json_string(payload, "dataset"))
    n = require_json_int(payload, "n")
    index = require_json_int(payload, "index")
    title = optional_json_string(payload, "title")
    notes = optional_json_string(payload, "notes")
    tags = payload.get("tags", [])
    return JSONResponse(
        STORE.save_blueprint(dataset, n, index, title=title, notes=notes, tags=tags),
        status_code=201,
    )


@app.delete("/api/blueprints")
async def blueprints_delete_endpoint(request: Request):
    params = query_param_map(request)
    blueprint_id = parse_int(params, "id")
    return STORE.delete_blueprint(blueprint_id)


@app.get("/api/sessions")
async def sessions_list_endpoint():
    return {"items": STORE.list_sessions()}


@app.post("/api/sessions")
async def sessions_save_endpoint(request: Request):
    payload = await parse_json_body(request)
    session_id = optional_json_int(payload, "id")
    name = require_json_string(payload, "name")
    notes = optional_json_string(payload, "notes")
    state = payload.get("state")
    return JSONResponse(
        STORE.save_session(name, state, notes=notes, session_id=session_id),
        status_code=201,
    )


@app.delete("/api/sessions")
async def sessions_delete_endpoint(request: Request):
    params = query_param_map(request)
    session_id = parse_int(params, "id")
    return STORE.delete_session(session_id)


app.mount("/", StaticFiles(directory=str(WEB), html=True), name="web")


def main():
    import uvicorn

    port = int(os.environ.get("PORT", "8000"))
    LOGGER.info("server.started", host="127.0.0.1", port=port, framework="fastapi")
    print(f"Serving on http://127.0.0.1:{port}")
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=port,
        log_level="warning",
        access_log=False,
        server_header=False,
        date_header=False,
    )
