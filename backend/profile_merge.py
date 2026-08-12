"""Semantic profile merge used by personal backup imports.

``profile.json`` is a materialized user model, not an opaque attachment.  Raw
file copy semantics would either skip the archive entirely or replace the local
profile.  This module merges durable profile facts and rebuilds derived practice
statistics from the de-duplicated sessions table.
"""
from __future__ import annotations

import copy
import json
import os
import sqlite3
import tempfile
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any


_MODE_COUNT_KEYS = {
    "resume": "resume_sessions",
    "topic_drill": "drill_sessions",
    "jd_prep": "job_prep_sessions",
    "recording": "recording_sessions",
    "copilot": "copilot_sessions",
}

_MODE_AVERAGE_KEYS = {
    "resume": ("resume_avg_score", 10),
    "topic_drill": ("drill_avg_score", 20),
    "jd_prep": ("job_prep_avg_score", 10),
    "recording": ("recording_avg_score", 20),
    "copilot": ("copilot_avg_score", 10),
}


def load_profile_file(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"画像文件无法解析: {path}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"画像文件必须是 JSON 对象: {path}")
    return value


def _write_profile_file(path: Path, profile: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            newline="\n",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temp_file:
            temp_path = Path(temp_file.name)
            json.dump(profile, temp_file, ensure_ascii=False, indent=2)
            temp_file.flush()
            os.fsync(temp_file.fileno())
        os.replace(temp_path, path)
        temp_path = None
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


def _canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _merge_unique_list(local: list, archive: list) -> list:
    result = copy.deepcopy(local)
    seen = {_canonical(item) for item in result}
    for item in archive:
        marker = _canonical(item)
        if marker not in seen:
            result.append(copy.deepcopy(item))
            seen.add(marker)
    return result


def _merge_generic(local: Any, archive: Any) -> Any:
    if local is None or local == "":
        return copy.deepcopy(archive)
    if isinstance(local, dict) and isinstance(archive, dict):
        result = copy.deepcopy(local)
        for key, value in archive.items():
            if key in result:
                result[key] = _merge_generic(result[key], value)
            else:
                result[key] = copy.deepcopy(value)
        return result
    if isinstance(local, list) and isinstance(archive, list):
        return _merge_unique_list(local, archive)
    return copy.deepcopy(local)


def _normalized_text(value: Any) -> str:
    return " ".join(str(value or "").casefold().split())


def _earliest(left: Any, right: Any) -> Any:
    values = [value for value in (left, right) if isinstance(value, str) and value]
    return min(values) if values else (left or right)


def _latest(left: Any, right: Any) -> Any:
    values = [value for value in (left, right) if isinstance(value, str) and value]
    return max(values) if values else (left or right)


def _entry_recency(entry: dict) -> str:
    return max(
        (
            value
            for key in ("last_seen", "improved_at", "archived_at", "last_assessed")
            if isinstance((value := entry.get(key)), str) and value
        ),
        default="",
    )


def _merge_fact(local: dict, archive: dict) -> dict:
    result = _merge_generic(local, archive)
    result["first_seen"] = _earliest(local.get("first_seen"), archive.get("first_seen"))
    result["last_seen"] = _latest(local.get("last_seen"), archive.get("last_seen"))
    result["times_seen"] = max(
        int(local.get("times_seen", 1) or 1),
        int(archive.get("times_seen", 1) or 1),
    )
    for key in ("history", "examples", "consolidates"):
        left = local.get(key, [])
        right = archive.get(key, [])
        if isinstance(left, list) and isinstance(right, list):
            merged = _merge_unique_list(left, right)
            result[key] = merged[-5:] if key == "examples" else merged

    newer = archive if _entry_recency(archive) > _entry_recency(local) else local
    for key in ("improved", "improved_at", "archived", "archived_at", "sr"):
        if key in newer:
            result[key] = copy.deepcopy(newer[key])
    return result


def _merge_fact_list(local: list, archive: list, *, include_source: bool) -> list:
    result = [copy.deepcopy(item) for item in local if isinstance(item, dict)]
    index: dict[tuple[str, ...], int] = {}
    for position, item in enumerate(result):
        key = (
            _normalized_text(item.get("topic")),
            _normalized_text(item.get("point")),
        )
        if include_source and item.get("source") == "consolidated":
            key += ("consolidated",)
        index[key] = position

    for item in archive:
        if not isinstance(item, dict):
            continue
        key = (
            _normalized_text(item.get("topic")),
            _normalized_text(item.get("point")),
        )
        if include_source and item.get("source") == "consolidated":
            key += ("consolidated",)
        if key in index:
            position = index[key]
            result[position] = _merge_fact(result[position], item)
        else:
            index[key] = len(result)
            result.append(copy.deepcopy(item))
    return result


def _merge_behavior_signals(local: dict, archive: dict) -> dict:
    result = copy.deepcopy(local)
    for signal_id, signal in archive.items():
        if not isinstance(signal, dict):
            continue
        if signal_id in result and isinstance(result[signal_id], dict):
            result[signal_id] = _merge_fact(result[signal_id], signal)
        else:
            result[signal_id] = copy.deepcopy(signal)
    return result


def _merge_topic_mastery(local: dict, archive: dict) -> dict:
    result = copy.deepcopy(local)
    for topic, incoming in archive.items():
        if not isinstance(incoming, dict):
            continue
        current = result.get(topic)
        if not isinstance(current, dict):
            result[topic] = copy.deepcopy(incoming)
            continue
        newer = incoming if _entry_recency(incoming) > _entry_recency(current) else current
        merged = _merge_generic(current, incoming)
        merged.update(copy.deepcopy(newer))
        merged["session_count"] = max(
            int(current.get("session_count", 0) or 0),
            int(incoming.get("session_count", 0) or 0),
        )
        result[topic] = merged
    return result


def merge_profiles(local: dict, archive: dict) -> dict:
    """Merge an archive profile into an existing account without double-counting.

    Identity/preferences remain local.  Evidence collections are unioned by stable
    semantic keys.  Numeric practice statistics are rebuilt separately from the
    merged sessions database by :func:`rebuild_profile_stats_file`.
    """
    result = copy.deepcopy(local)
    special = {
        "weak_points",
        "strong_points",
        "behavior_signals",
        "topic_mastery",
        "stats",
        "view_marker",
        "updated_at",
        "last_consolidation_at",
    }
    for key, value in archive.items():
        if key in special:
            continue
        result[key] = _merge_generic(result.get(key), value)

    result["weak_points"] = _merge_fact_list(
        local.get("weak_points", []), archive.get("weak_points", []), include_source=True
    )
    result["strong_points"] = _merge_fact_list(
        local.get("strong_points", []), archive.get("strong_points", []), include_source=False
    )
    result["behavior_signals"] = _merge_behavior_signals(
        local.get("behavior_signals", {}), archive.get("behavior_signals", {})
    )
    result["topic_mastery"] = _merge_topic_mastery(
        local.get("topic_mastery", {}), archive.get("topic_mastery", {})
    )

    stats = _merge_generic(local.get("stats", {}), archive.get("stats", {}))
    local_stats = local.get("stats", {})
    archive_stats = archive.get("stats", {})
    for key in (
        "total_sessions",
        "total_answers",
        "resume_sessions",
        "drill_sessions",
        "job_prep_sessions",
        "recording_sessions",
        "copilot_sessions",
    ):
        stats[key] = max(
            int(local_stats.get(key, 0) or 0),
            int(archive_stats.get(key, 0) or 0),
        )
    result["stats"] = stats

    # A view marker belongs to the current account. Keeping it makes imported
    # sessions appear as a delta on the next profile visit.
    if "view_marker" in local:
        result["view_marker"] = copy.deepcopy(local["view_marker"])
    elif "view_marker" in archive:
        result["view_marker"] = copy.deepcopy(archive["view_marker"])
    result["last_consolidation_at"] = _latest(
        local.get("last_consolidation_at"), archive.get("last_consolidation_at")
    ) or ""
    result["updated_at"] = _latest(local.get("updated_at"), archive.get("updated_at")) or ""
    return result


def merge_profile_files(archive_path: Path, local_path: Path) -> dict:
    archive = load_profile_file(archive_path)
    local = load_profile_file(local_path)
    merged = merge_profiles(local, archive)
    _write_profile_file(local_path, merged)
    return merged


def _parse_json(value: Any, default: Any) -> Any:
    if isinstance(value, type(default)):
        return value
    if not isinstance(value, str) or not value:
        return copy.deepcopy(default)
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return copy.deepcopy(default)
    return parsed if isinstance(parsed, type(default)) else copy.deepcopy(default)


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def rebuild_profile_stats_file(profile_path: Path, db_path: Path, user_id: str) -> dict:
    """Rebuild derived practice stats from reviewed, de-duplicated sessions."""
    profile = load_profile_file(profile_path)
    if not db_path.exists():
        return profile

    with sqlite3.connect(str(db_path)) as conn:
        conn.row_factory = sqlite3.Row
        if conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sessions'"
        ).fetchone() is None:
            return profile
        rows = conn.execute(
            "SELECT session_id, mode, topic, scores, overall, review, status, created_at "
            "FROM sessions WHERE user_id = ? "
            "AND (status = 'reviewed' OR (review IS NOT NULL AND review != '')) "
            "ORDER BY created_at, session_id",
            (user_id,),
        ).fetchall()

    stats = copy.deepcopy(profile.get("stats", {}))
    mode_counts: Counter[str] = Counter()
    topic_counts: Counter[str] = Counter()
    score_history: list[dict] = []
    total_answers = 0

    for row in rows:
        mode = row["mode"] or "topic_drill"
        topic = row["topic"] or None
        mode_counts[mode] += 1
        if topic:
            topic_counts[topic] += 1

        scores = _parse_json(row["scores"], [])
        numeric_scores = [
            number
            for item in scores
            if isinstance(item, dict) and (number := _number(item.get("score"))) is not None
        ]
        total_answers += len(numeric_scores)
        overall = _parse_json(row["overall"], {})
        avg_score = _number(overall.get("avg_score"))
        if avg_score is None and numeric_scores:
            avg_score = round(sum(numeric_scores) / len(numeric_scores), 1)
        if avg_score is None:
            continue

        created_at = row["created_at"] or ""
        entry = {
            "date": created_at[:10],
            "mode": mode,
            "topic": topic,
            "avg_score": round(avg_score, 1),
            "session_id": row["session_id"],
        }
        dimensions = overall.get("dimension_scores")
        if isinstance(dimensions, dict):
            entry["dimension_scores"] = dimensions
        score_history.append(entry)

    for mode, count_key in _MODE_COUNT_KEYS.items():
        if mode != "copilot":
            stats[count_key] = max(int(stats.get(count_key, 0) or 0), mode_counts[mode])
    copilot_sessions = max(
        int(stats.get("copilot_sessions", 0) or 0),
        mode_counts["copilot"],
    )
    stats["copilot_sessions"] = copilot_sessions
    rebuilt_total = len(rows) + max(0, copilot_sessions - mode_counts["copilot"])
    stats["total_sessions"] = max(int(stats.get("total_sessions", 0) or 0), rebuilt_total)
    stats["total_answers"] = max(int(stats.get("total_answers", 0) or 0), total_answers)
    if score_history:
        stats["score_history"] = score_history

    if score_history:
        for average_key, _window in _MODE_AVERAGE_KEYS.values():
            stats.pop(average_key, None)
        for mode, (average_key, window) in _MODE_AVERAGE_KEYS.items():
            values = [
                entry["avg_score"]
                for entry in score_history
                if entry.get("mode") == mode
            ][-window:]
            if values:
                stats[average_key] = round(sum(values) / len(values), 1)
        recent_scores = [entry["avg_score"] for entry in score_history][-30:]
        stats["avg_score"] = round(sum(recent_scores) / len(recent_scores), 1)
    profile["stats"] = stats

    for topic, mastery in profile.get("topic_mastery", {}).items():
        if isinstance(mastery, dict) and topic_counts[topic]:
            mastery["session_count"] = max(
                int(mastery.get("session_count", 0) or 0),
                topic_counts[topic],
            )

    profile["updated_at"] = datetime.now().isoformat()
    _write_profile_file(profile_path, profile)
    return profile
