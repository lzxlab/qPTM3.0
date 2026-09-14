"""Subprocess runner for collection-agent CLI."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
from pathlib import Path
from typing import Any, AsyncIterator

from app.collection.store import (
    job_dir,
    jobs_root,
    read_job_json,
    refresh_artifact_summary,
    write_job_json,
)
from app.config import settings

logger = logging.getLogger(__name__)

_running: dict[str, asyncio.Task] = {}
# Child subprocesses by job_id, so resume can kill a stale/hung child instead of
# silently refusing to start a new run (the old one keeps the job "running").
_procs: dict[str, asyncio.subprocess.Process] = {}

_MODEL_FAIL_RE = (
    "not supported",
    "is not supported",
    "model qwen",
    "401 model",
    "all llm models failed",
)


def _is_model_gateway_error(exc: BaseException) -> bool:
    msg = str(exc).lower()
    if "401" in msg and any(tok in msg for tok in ("not supported", "qwen", "model")):
        return True
    return any(tok in msg for tok in _MODEL_FAIL_RE)


def _fetch_pmid_metadata(pmid: str) -> dict[str, Any]:
    """Best-effort PubMed metadata for graceful collection degrade."""
    pmid = str(pmid or "").strip()
    if not pmid.isdigit():
        return {}
    try:
        import httpx

        url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi"
        params = {"db": "pubmed", "id": pmid, "retmode": "json"}
        with httpx.Client(timeout=12.0) as client:
            resp = client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
        result = (data.get("result") or {}).get(pmid) or {}
        if not result or result.get("error"):
            return {}
        return {
            "pmid": pmid,
            "title": result.get("title") or "",
            "source": result.get("source") or "",
            "pubdate": result.get("pubdate") or "",
            "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
        }
    except Exception as exc:
        logger.warning("PMID metadata lookup failed for %s: %s", pmid, exc)
        return {}


def _graceful_collection_failure(pmid: str, exc: BaseException) -> dict[str, Any]:
    meta = _fetch_pmid_metadata(pmid) if _is_model_gateway_error(exc) else {}
    if _is_model_gateway_error(exc):
        title = meta.get("title") or ""
        bits = [
            f"Could not extract quantitative PTM tables for PMID {pmid}",
            "(literature model unavailable).",
        ]
        if title:
            bits.append(f"PMID metadata only: {title}.")
        bits.append("Please upload the PDF or supplementary tables to continue.")
        message = " ".join(bits)
        return {
            "status": "error",
            "error": None,
            "message": message,
            "summary": {
                "pmid_metadata": meta,
                "graceful_degrade": "model_unavailable",
            },
        }
    raw = str(exc)
    if "traceback" in raw.lower() or "qwen3.7-max is not supported" in raw.lower():
        raw = "Collection failed. Please upload a PDF or try another PMID."
    return {
        "status": "error",
        "error": raw[:500],
        "message": f"Collection failed: {raw[:400]}",
    }


class CliTimeoutError(RuntimeError):
    """Raised when a collection-agent child process exceeds its deadline."""


def mark_interrupted_jobs() -> None:
    """After a backend restart, flag any job still 'running' as resumable.

    A restart kills the in-memory task registry, so such jobs can never finish
    on their own — without this they would spin forever in the UI. Set them to
    ``awaiting_continue`` (keeping ``nextStage``) so the UI shows a Continue
    button and the user can resume from where the crash happened.
    """
    root = jobs_root()
    if not root.is_dir():
        return
    for entry in root.iterdir():
        if not entry.is_dir():
            continue
        job_id = entry.name
        state = read_job_json(job_id)
        if not state or state.get("status") != "running":
            continue
        stage = state.get("currentStage") or state.get("nextStage") or "stage1"
        state["status"] = "awaiting_continue"
        if not state.get("nextStage"):
            state["nextStage"] = stage
        state["error"] = "Collection job was interrupted by a backend restart"
        state["message"] = (
            f"Collection was interrupted by a backend restart while running {stage}. "
            "Click Continue to resume."
        )
        write_job_json(job_id, state)
        logger.warning("marked interrupted running job %s as awaiting_continue", job_id)


def _node_bin() -> str:
    return settings.collection_node_bin


def _npx_bin() -> str:
    node_dir = Path(_node_bin()).parent
    candidate = node_dir / "npx"
    return str(candidate) if candidate.is_file() else "npx"


def _collection_env() -> dict[str, str]:
    env = os.environ.copy()
    env["NODE_ENV"] = env.get("NODE_ENV", "production")
    if settings.deepseek_api_key and not env.get("OPENCODE_API_KEY"):
        env["OPENCODE_API_KEY"] = settings.deepseek_api_key
    # Collection uses pi-ai provider/model ids (e.g. opencode-go/deepseek-v4-flash).
    # Do NOT map DEEPSEEK_MODEL (chat HTTP bare id) → opencode-go/… — catalogs differ
    # (e.g. qwen3.5-plus is Zen/opencode, not OpenCode Go).
    if settings.collection_model and not env.get("MODEL"):
        env["MODEL"] = settings.collection_model
    if settings.collection_fallback_models and not env.get("MODEL_FALLBACKS"):
        env["MODEL_FALLBACKS"] = settings.collection_fallback_models
    # Prefer explicit backend settings; otherwise leave for collection-agent/.env via loadDotEnv
    if settings.unpaywall_email:
        env["UNPAYWALL_EMAIL"] = settings.unpaywall_email
    if settings.ncbi_api_key:
        env["NCBI_API_KEY"] = settings.ncbi_api_key
    if settings.ncbi_email:
        env["NCBI_EMAIL"] = settings.ncbi_email
    if settings.qptm3_get_url_dir:
        env["QPTM3_GET_URL_DIR"] = settings.qptm3_get_url_dir
    env["PATH"] = f"{Path(_node_bin()).parent}:{env.get('PATH', '')}"
    return env


def _cli_base() -> list[str]:
    index = Path(settings.collection_agent_dir) / "src" / "index.ts"
    return [_npx_bin(), "tsx", str(index)]


async def _run_cli(
    job_id: str,
    args: list[str],
    *,
    log_name: str = "job.log",
    timeout_seconds: int | None = None,
) -> tuple[int, str]:
    """Run collection-agent CLI.

    timeout_seconds is an *idle* deadline: the child is killed only when no
    stdout has arrived for that many seconds (large Stage5 tables may run
    longer than 30 minutes wall-clock but still emit heartbeats).
    """
    out = job_dir(job_id)
    log_path = out / log_name
    cmd = _cli_base() + args
    logger.info("collection job %s: %s", job_id, " ".join(cmd))
    env = _collection_env()
    env["OPENCODE_SESSION"] = job_id
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=settings.collection_agent_dir,
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    _procs[job_id] = proc
    chunks: list[str] = []
    log_written = False
    try:
        assert proc.stdout is not None
        loop = asyncio.get_running_loop()
        last_activity = loop.time()

        async def _read_stdout() -> int:
            nonlocal last_activity
            async for raw in proc.stdout:
                last_activity = loop.time()
                text = raw.decode("utf-8", errors="replace")
                chunks.append(text)
            return await proc.wait()

        if timeout_seconds:
            reader = asyncio.create_task(_read_stdout())
            try:
                while not reader.done():
                    idle = loop.time() - last_activity
                    if idle >= timeout_seconds:
                        logger.warning(
                            "collection job %s idle for %ss — killing child pid %s",
                            job_id,
                            timeout_seconds,
                            proc.pid,
                        )
                        try:
                            proc.kill()
                        except ProcessLookupError:
                            pass
                        try:
                            await proc.wait()
                        except ProcessLookupError:
                            pass
                        reader.cancel()
                        with contextlib.suppress(asyncio.CancelledError):
                            await reader
                        full = "".join(chunks)
                        log_path.write_text(
                            full
                            + f"\n[timeout] job {job_id} killed after {timeout_seconds}s idle\n",
                            encoding="utf-8",
                        )
                        log_written = True
                        raise CliTimeoutError(
                            f"collection job {job_id} idle for {timeout_seconds}s; "
                            f"process killed. Last output: {full[-500:]}"
                        )
                    await asyncio.wait({reader}, timeout=5.0)
                return reader.result(), "".join(chunks)
            except CliTimeoutError:
                raise
            except Exception:
                if not reader.done():
                    reader.cancel()
                raise
        else:
            code = await _read_stdout()
            return code, "".join(chunks)
    finally:
        _procs.pop(job_id, None)
        if not log_written:
            log_path.write_text("".join(chunks), encoding="utf-8")


async def run_resolve_urls_job(
    job_id: str,
    accessions: list[str],
    *,
    pmid: str | None = None,
    title: str | None = None,
    organism: str | None = None,
    modification: str | None = None,
    ms_data_source: str | None = None,
    message: str | None = None,
) -> dict[str, Any] | None:
    """Standalone Stage-6 URL resolution for MS accessions (no PMID pipeline)."""
    args = [
        "resolve-urls",
        "--out-dir",
        str(job_dir(job_id).resolve()),
        "--job-id",
        job_id,
    ]
    for acc in accessions:
        args.extend(["--accession", str(acc).strip().upper()])
    if pmid:
        args.extend(["--pmid", str(pmid)])
    if title:
        args.extend(["--title", str(title)])
    if organism:
        args.extend(["--organism", str(organism)])
    if modification:
        args.extend(["--modification", str(modification)])
    if ms_data_source:
        args.extend(["--ms-data-source", str(ms_data_source)])
    if message:
        args.extend(["--message", str(message)])

    code, output = await _run_cli(
        job_id,
        args,
        log_name="resolve-urls.log",
        timeout_seconds=settings.collection_stage_timeout_seconds,
    )
    state = read_job_json(job_id)
    if state is None:
        raise RuntimeError(f"resolve-urls finished without job.json (exit {code}): {output[-2000:]}")
    if code != 0 and state.get("status") not in ("completed", "error"):
        raise RuntimeError(state.get("error") or output[-2000:] or f"exit code {code}")
    return state


async def run_collection_job(
    job_id: str,
    pmid: str,
    *,
    fulltext_path: str | None = None,
    supplementary_path: str | None = None,
    supplementary_paths: list[str] | None = None,
    resume_from: str | None = None,
    force_include: bool = False,
) -> dict[str, Any] | None:
    args = [
        "run-job",
        "--pmid",
        pmid,
        "--out-dir",
        str(job_dir(job_id).resolve()),
        "--job-id",
        job_id,
        "--concurrency",
        "2",
    ]
    if fulltext_path:
        args.extend(["--file", str(Path(fulltext_path).resolve())])
    paths = list(supplementary_paths or [])
    if supplementary_path and supplementary_path not in paths:
        paths.append(supplementary_path)
    for path in paths:
        args.extend(["--supp-file", str(Path(path).resolve())])
    if resume_from:
        args.extend(["--resume-from", resume_from])
    if force_include:
        args.append("--force-include")

    code, output = await _run_cli(
        job_id,
        args,
        timeout_seconds=settings.collection_stage_timeout_seconds,
    )
    state = read_job_json(job_id)
    if state is None:
        raise RuntimeError(f"Job finished without job.json (exit {code}): {output[-2000:]}")
    terminal = state.get("status") in (
        "awaiting_upload",
        "awaiting_continue",
        "completed",
        "rejected",
    )
    if code != 0 and not terminal:
        # Child died while job.json still says "running" — typically a backend
        # restart / OOM / crash mid-stage. Make it resumable instead of dumping
        # raw stderr (often just "Using data root…" log lines) as the failure.
        if state.get("status") == "running":
            stage = state.get("currentStage") or state.get("nextStage") or "stage5"
            state["status"] = "awaiting_continue"
            state["nextStage"] = stage
            state["error"] = (
                f"Stage {stage} process exited unexpectedly (code {code})"
            )
            state["message"] = (
                f"Stage {stage} was interrupted before finishing "
                "(backend restart, crash, or process killed). "
                "Click Continue to retry this stage."
            )
            write_job_json(job_id, state)
            return state
        raise RuntimeError(state.get("error") or output[-2000:] or f"exit code {code}")
    return state


async def ingest_fulltext(job_id: str, pmid: str, file_path: str) -> None:
    code, output = await _run_cli(
        job_id,
        [
            "ingest-fulltext",
            "--pmid",
            pmid,
            "--file",
            str(Path(file_path).resolve()),
            "--out-dir",
            str(job_dir(job_id).resolve()),
        ],
        log_name="ingest-fulltext.log",
    )
    if code != 0:
        raise RuntimeError(output[-2000:] or f"ingest-fulltext failed ({code})")


async def ingest_supplementary(job_id: str, pmid: str, file_path: str) -> None:
    code, output = await _run_cli(
        job_id,
        [
            "ingest-supp",
            "--pmid",
            pmid,
            "--file",
            str(Path(file_path).resolve()),
            "--out-dir",
            str(job_dir(job_id).resolve()),
        ],
        log_name="ingest-supp.log",
    )
    if code != 0:
        raise RuntimeError(output[-2000:] or f"ingest-supp failed ({code})")


def _resume_from_state(state: dict[str, Any]) -> str | None:
    # Terminal jobs must never restart from stage1 — that would re-run the whole
    # pipeline and make a stale "Continue" bubble show an earlier stage's plan.
    # A "completed"/"rejected" job is genuinely done. An "error" job may be
    # resumed from its nextStage (e.g. after a timeout or backend restart), but
    # only when the caller explicitly asks — plain polling never auto-restarts.
    if state.get("status") in ("completed", "rejected"):
        return None
    next_stage = state.get("nextStage")
    if next_stage:
        return str(next_stage)
    awaiting = state.get("awaitingUpload")
    if awaiting == "fulltext":
        return "stage2"
    if awaiting == "supplementary":
        return "stage5"
    return None


async def schedule_job(
    job_id: str,
    pmid: str,
    *,
    fulltext_path: str | None = None,
    supplementary_path: str | None = None,
    supplementary_paths: list[str] | None = None,
    resume_from: str | None = None,
    force_include: bool = False,
) -> None:
    if job_id in _running and not _running[job_id].done():
        return

    async def _worker() -> None:
        try:
            await run_collection_job(
                job_id,
                pmid,
                fulltext_path=fulltext_path,
                supplementary_path=supplementary_path,
                supplementary_paths=supplementary_paths,
                resume_from=resume_from,
                force_include=force_include,
            )
        except CliTimeoutError as exc:
            logger.warning("collection job %s timed out: %s", job_id, exc)
            job_path = job_dir(job_id) / "job.json"
            payload = read_job_json(job_id) or {
                "jobId": job_id,
                "pmid": pmid,
                "stages": {},
                "summary": {},
            }
            # Return to a resumable pause so the UI shows a "Continue" button and
            # the user can retry the same stage (nextStage was left untouched).
            payload.update(
                {
                    "status": "awaiting_continue",
                    "error": str(exc),
                    "message": "Stage timed out (no response from the collection agent for "
                    f"{settings.collection_stage_timeout_seconds}s). The process was killed; "
                    "click Continue to retry.",
                }
            )
            job_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        except Exception as exc:
            logger.exception("collection job %s failed", job_id)
            job_path = job_dir(job_id) / "job.json"
            payload = read_job_json(job_id) or {
                "jobId": job_id,
                "pmid": pmid,
                "stages": {},
                "summary": {},
            }
            degrade = _graceful_collection_failure(pmid, exc)
            summary = dict(payload.get("summary") or {})
            extra_summary = degrade.pop("summary", None) or {}
            if extra_summary:
                summary.update(extra_summary)
            payload.update(degrade)
            payload["summary"] = summary
            job_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        finally:
            _running.pop(job_id, None)

    _running[job_id] = asyncio.create_task(_worker())


async def schedule_resolve_urls_job(
    job_id: str,
    accessions: list[str],
    *,
    pmid: str | None = None,
    title: str | None = None,
    organism: str | None = None,
    modification: str | None = None,
    ms_data_source: str | None = None,
    message: str | None = None,
) -> None:
    if job_id in _running and not _running[job_id].done():
        return

    async def _worker() -> None:
        try:
            await run_resolve_urls_job(
                job_id,
                accessions,
                pmid=pmid,
                title=title,
                organism=organism,
                modification=modification,
                ms_data_source=ms_data_source,
                message=message,
            )
        except CliTimeoutError as exc:
            logger.warning("resolve-urls job %s timed out: %s", job_id, exc)
            job_path = job_dir(job_id) / "job.json"
            payload = read_job_json(job_id) or {
                "jobId": job_id,
                "pmid": pmid or (accessions[0] if accessions else ""),
                "stages": {},
                "summary": {"resolveUrls": True, "accessions": accessions},
            }
            payload.update(
                {
                    "status": "error",
                    "error": str(exc),
                    "message": "URL resolution timed out. Please retry.",
                    "currentStage": "stage6",
                }
            )
            job_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        except Exception as exc:
            logger.exception("resolve-urls job %s failed", job_id)
            job_path = job_dir(job_id) / "job.json"
            payload = read_job_json(job_id) or {
                "jobId": job_id,
                "pmid": pmid or (accessions[0] if accessions else ""),
                "stages": {},
                "summary": {"resolveUrls": True, "accessions": accessions},
            }
            payload.update(
                {
                    "status": "error",
                    "error": str(exc),
                    "message": f"URL resolution failed: {exc}",
                    "currentStage": "stage6",
                }
            )
            job_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        finally:
            _running.pop(job_id, None)

    _running[job_id] = asyncio.create_task(_worker())


async def resume_job(
    job_id: str,
    pmid: str,
    resume_from: str | None = None,
    *,
    force_include: bool = False,
) -> None:
    state = read_job_json(job_id) or {}
    # Terminal jobs are finished — do not re-run from stage1. Keep the result
    # so a stale "Continue" bubble simply reflects the final state. An explicit
    # resume_from (sent by the UI "Continue" button after an error/timeout) is
    # allowed to retry from that stage. force_include overrides Stage-1 reject.
    if state.get("status") == "completed":
        return
    if state.get("status") == "rejected" and not force_include:
        return
    if not resume_from:
        resume_from = _resume_from_state(state)
    if not resume_from:
        resume_from = "stage1"
    if force_include:
        resume_from = "stage1"
    # If a previous run is still registered but dead/hung, kill the stale child
    # and cancel the old task so a new process can actually start. Otherwise a
    # zombie task keeps the job "running" forever and resume silently no-ops.
    existing = _running.get(job_id)
    if existing and not existing.done():
        stale = _procs.get(job_id)
        if stale is not None:
            logger.warning(
                "resume job %s: killing stale child pid %s before rescheduling",
                job_id,
                stale.pid,
            )
            try:
                stale.kill()
                await stale.wait()
            except (ProcessLookupError, asyncio.CancelledError):
                pass
        existing.cancel()
        try:
            await existing
        except (asyncio.CancelledError, Exception):
            pass
    # Clear pause flags before resuming; point UI at the stage about to run.
    job_path = job_dir(job_id) / "job.json"
    if job_path.is_file():
        payload = read_job_json(job_id) or {}
        payload["status"] = "running"
        payload["awaitingUpload"] = None
        payload["currentStage"] = resume_from
        payload["nextStage"] = resume_from
        if force_include:
            payload["message"] = "Including paper by user request…"
        if payload.get("error"):
            payload.pop("error", None)
            payload["message"] = f"Retrying stage {resume_from}…"
        job_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    await schedule_job(
        job_id,
        pmid,
        resume_from=resume_from,
        force_include=force_include,
    )


async def resume_after_upload(job_id: str, pmid: str) -> None:
    await resume_job(job_id, pmid)


def job_state_to_response(job_id: str, pmid: str | None = None) -> dict[str, Any]:
    state = read_job_json(job_id) or {}
    summary = state.get("summary") if isinstance(state.get("summary"), dict) else {}
    summary = refresh_artifact_summary(job_id, summary)
    raw_error = state.get("error")
    if isinstance(raw_error, str) and (
        "qwen3.7-max is not supported" in raw_error.lower()
        or "401 model" in raw_error.lower()
        or "traceback (most recent call last)" in raw_error.lower()
    ):
        raw_error = None
        message = state.get("message") or (
            "Could not retrieve full text. Please upload the PDF or supplementary tables."
        )
    else:
        message = state.get("message", "")
    return {
        "job_id": job_id,
        "pmid": state.get("pmid") or pmid,
        "status": state.get("status", "pending"),
        "current_stage": state.get("currentStage"),
        "next_stage": state.get("nextStage"),
        "awaiting_upload": state.get("awaitingUpload"),
        "message": message,
        "stages": state.get("stages") or {},
        "summary": summary,
        "offer_contribute": bool(state.get("offerContribute")),
        "contribution": state.get("contribution"),
        "error": raw_error,
        "needs_pmid": False,
        "resolve_urls": bool(summary.get("resolveUrls")),
    }


async def watch_job_events(job_id: str) -> AsyncIterator[dict[str, Any]]:
    """Poll job.json and emit SSE-friendly events."""
    last = ""
    ticks = 0
    while True:
        state = read_job_json(job_id)
        if state:
            blob = json.dumps(state, sort_keys=True)
            if blob != last:
                last = blob
                yield {"event": "status", "data": job_state_to_response(job_id)}
            status = state.get("status")
            if status in ("completed", "rejected", "error", "awaiting_upload", "awaiting_continue"):
                if status == "completed":
                    yield {"event": "done", "data": job_state_to_response(job_id)}
                elif status == "rejected":
                    yield {"event": "rejected", "data": job_state_to_response(job_id)}
                elif status == "awaiting_upload":
                    yield {
                        "event": "awaiting_upload",
                        "data": job_state_to_response(job_id),
                    }
                elif status == "awaiting_continue":
                    yield {
                        "event": "awaiting_continue",
                        "data": job_state_to_response(job_id),
                    }
                else:
                    yield {"event": "error", "data": job_state_to_response(job_id)}
                return
        ticks += 1
        # Keep proxies / browsers from idle-closing long Stage1/5 runs.
        if ticks % 15 == 0:
            yield {
                "event": "status",
                "data": job_state_to_response(job_id) if state else {"job_id": job_id, "status": "running"},
            }
        await asyncio.sleep(1.0)
