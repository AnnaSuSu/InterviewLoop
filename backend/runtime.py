"""Shared in-memory runtime state for API modules."""

# Hot caches for interactive sessions and async task status.
_drill_sessions: dict[str, dict] = {}
_job_prep_sessions: dict[str, dict] = {}
_task_status: dict[str, dict] = {}
_copilot_sessions: dict[str, dict] = {}
