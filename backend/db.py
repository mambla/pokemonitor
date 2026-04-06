import json
import os
import sqlite3
from datetime import datetime, timezone

DB_PATH = os.environ.get("POKEPARSE_DB", os.path.join(os.path.dirname(__file__), "pokeparse.db"))

_conn = None


def get_conn():
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
        _create_tables(_conn)
    return _conn


def _create_tables(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS posts (
            post_id         TEXT PRIMARY KEY,
            group_id        TEXT NOT NULL,
            author          TEXT,
            text            TEXT,
            images          TEXT,
            image_descriptions TEXT,
            post_link       TEXT,
            group_name      TEXT,
            time_label      TEXT,
            estimated_time  TEXT,
            parsed_at       TEXT NOT NULL,
            analysis        TEXT,
            telegram_sent   INTEGER DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_posts_group ON posts(group_id);
        CREATE INDEX IF NOT EXISTS idx_posts_estimated_time ON posts(estimated_time);
    """)


def store_post(post: dict) -> bool:
    """Store a post. Returns True if new, False if already exists."""
    conn = get_conn()

    existing = conn.execute(
        "SELECT post_id FROM posts WHERE post_id = ?", (post["postId"],)
    ).fetchone()
    if existing:
        return False

    estimated_time = None
    if post.get("estimatedTime"):
        try:
            estimated_time = datetime.fromtimestamp(
                post["estimatedTime"] / 1000, tz=timezone.utc
            ).isoformat()
        except (ValueError, OSError):
            pass

    conn.execute(
        """INSERT INTO posts
           (post_id, group_id, author, text, images, image_descriptions,
            post_link, group_name, time_label, estimated_time, parsed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            post["postId"],
            post.get("groupId", ""),
            post.get("author", ""),
            post.get("text", ""),
            json.dumps(post.get("images", [])),
            json.dumps(post.get("imageDescriptions", [])),
            post.get("postLink", ""),
            post.get("groupName", ""),
            post.get("timeLabel"),
            estimated_time,
            datetime.now(timezone.utc).isoformat(),
        ),
    )
    conn.commit()
    return True


def update_analysis(post_id: str, analysis: dict, telegram_sent: bool):
    conn = get_conn()
    conn.execute(
        "UPDATE posts SET analysis = ?, telegram_sent = ? WHERE post_id = ?",
        (json.dumps(analysis), int(telegram_sent), post_id),
    )
    conn.commit()


def get_recent_posts(limit: int = 50) -> list[dict]:
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM posts ORDER BY parsed_at DESC LIMIT ?", (limit,)
    ).fetchall()
    return [dict(r) for r in rows]


def get_post(post_id: str) -> dict | None:
    conn = get_conn()
    row = conn.execute(
        "SELECT * FROM posts WHERE post_id = ?", (post_id,)
    ).fetchone()
    return dict(row) if row else None
