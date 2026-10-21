from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

from app.services.voice_workflow_tts_client import VoiceWorkflowTtsError


async def run_message_tts_worker(app) -> None:
    settings = app.state.settings
    store = app.state.trace_store
    tts_client = app.state.tts_client

    while True:
        try:
            now = datetime.now(UTC).isoformat()
            job = store.claim_next_tts_job(now_iso=now, lock_timeout_seconds=settings.tts_job_lock_timeout_seconds)
            if job is None:
                await asyncio.sleep(settings.tts_job_worker_interval_seconds)
                continue

            tts = store.get_tts_by_id(job["workspace_id"], job["message_tts_id"])
            message = store.get_workspace_message(job["workspace_id"], job["message_id"])
            trace_id = message.get("trace_id") if message else None
            trace_user_id = store.get_account_external_user_id(str(message["account_id"])) if message else None
            trace_session_id = message.get("session_id") if message else None
            if not tts or not tts.get("task_id"):
                store.update_tts_status(job["workspace_id"], job["message_tts_id"], status="failed", error="missing_task_reference")
                store.fail_tts_job(job["id"], last_error="missing_task_reference")
                if trace_id and trace_user_id:
                    store.insert_event(
                        trace_id=trace_id,
                        user_id=trace_user_id,
                        session_id=trace_session_id,
                        stage="message_service.tts.worker",
                        status="error",
                        latency_ms=None,
                        error_code="missing_task_reference",
                        payload={"job_id": job["id"], "message_id": job["message_id"], "tts_id": job["message_tts_id"]},
                    )
                continue

            try:
                task = await tts_client.get_task_status(str(tts["task_id"]))
                status = str(task.get("status") or "").strip().lower()
                if trace_id and trace_user_id:
                    store.insert_event(
                        trace_id=trace_id,
                        user_id=trace_user_id,
                        session_id=trace_session_id,
                        stage="message_service.tts.worker",
                        status=status or "pending",
                        latency_ms=None,
                        payload={
                            "job_id": job["id"],
                            "message_id": job["message_id"],
                            "tts_id": job["message_tts_id"],
                            "task_id": tts["task_id"],
                            "attempts": job["attempts"],
                        },
                    )
                if status == "completed":
                    reference = tts_client.build_reference(str(tts["task_id"]), task)
                    store.finalize_message_tts(
                        job["workspace_id"],
                        job["message_tts_id"],
                        status="ready",
                        remote_audio_url=reference.audio_url,
                        media_type=reference.media_type,
                        duration_seconds=reference.duration_seconds,
                        chunks_count=reference.chunks_count,
                        error=None,
                    )
                    store.complete_tts_job(job["id"])
                    if trace_id and trace_user_id:
                        store.insert_event(
                            trace_id=trace_id,
                            user_id=trace_user_id,
                            session_id=trace_session_id,
                            stage="message_service.tts.reference",
                            status="ok",
                            latency_ms=None,
                            payload={
                                "job_id": job["id"],
                                "message_id": job["message_id"],
                                "tts_id": job["message_tts_id"],
                                "task_id": tts["task_id"],
                                "remote_audio_url": reference.audio_url,
                                "media_type": reference.media_type,
                                "duration_seconds": reference.duration_seconds,
                                "chunks_count": reference.chunks_count,
                                "source": "worker",
                            },
                        )
                    continue

                if status == "failed":
                    error = str(task.get("error") or "Voice workflow TTS task failed.")
                    store.finalize_message_tts(
                        job["workspace_id"],
                        job["message_tts_id"],
                        status="failed",
                        remote_audio_url=None,
                        media_type=None,
                        error=error,
                    )
                    store.fail_tts_job(job["id"], last_error=error)
                    if trace_id and trace_user_id:
                        store.insert_event(
                            trace_id=trace_id,
                            user_id=trace_user_id,
                            session_id=trace_session_id,
                            stage="message_service.tts.reference",
                            status="error",
                            latency_ms=None,
                            error_code="tts_task_failed",
                            payload={
                                "job_id": job["id"],
                                "message_id": job["message_id"],
                                "tts_id": job["message_tts_id"],
                                "task_id": tts["task_id"],
                                "error": error,
                                "source": "worker",
                            },
                        )
                    continue

                next_attempt_at = (datetime.now(UTC) + timedelta(seconds=settings.tts_job_worker_interval_seconds)).isoformat()
                store.reschedule_tts_job(job["id"], next_attempt_at=next_attempt_at, last_error=None)
            except VoiceWorkflowTtsError as error:
                if int(job["attempts"]) >= settings.tts_service_max_poll_attempts:
                    store.finalize_message_tts(
                        job["workspace_id"],
                        job["message_tts_id"],
                        status="failed",
                        remote_audio_url=None,
                        media_type=None,
                        error=str(error),
                    )
                    store.fail_tts_job(job["id"], last_error=str(error))
                    if trace_id and trace_user_id:
                        store.insert_event(
                            trace_id=trace_id,
                            user_id=trace_user_id,
                            session_id=trace_session_id,
                            stage="message_service.tts.reference",
                            status="error",
                            latency_ms=None,
                            error_code=type(error).__name__,
                            payload={
                                "job_id": job["id"],
                                "message_id": job["message_id"],
                                "tts_id": job["message_tts_id"],
                                "task_id": tts["task_id"],
                                "error": str(error),
                                "source": "worker",
                            },
                        )
                else:
                    next_attempt_at = (datetime.now(UTC) + timedelta(seconds=settings.tts_job_worker_interval_seconds)).isoformat()
                    store.reschedule_tts_job(job["id"], next_attempt_at=next_attempt_at, last_error=str(error))
        except asyncio.CancelledError:
            raise
        except Exception:
            await asyncio.sleep(settings.tts_job_worker_interval_seconds)
