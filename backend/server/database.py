"""SQLite database — connection + schema + migrations."""

import sqlite3
import os
from server.config import DB_PATH, UPLOAD_DIR


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    conn = get_db()

    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE,
            wake_up_time TEXT DEFAULT '08:00',
            sleep_time TEXT DEFAULT '23:00',
            study_method TEXT DEFAULT 'pomodoro',
            session_minutes INTEGER DEFAULT 50,
            break_minutes INTEGER DEFAULT 10,
            hobby_name TEXT,
            neto_study_hours REAL DEFAULT 4.0,
            peak_productivity TEXT DEFAULT 'Morning',
            onboarding_completed INTEGER DEFAULT 0,
            fixed_breaks TEXT DEFAULT '[]',
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS exams (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            subject TEXT NOT NULL,
            exam_date TEXT NOT NULL,
            special_needs TEXT,
            parsed_context TEXT,
            status TEXT DEFAULT 'upcoming' CHECK(status IN ('upcoming', 'completed', 'cancelled')),
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS exam_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            exam_id INTEGER NOT NULL,
            filename TEXT NOT NULL,
            file_path TEXT NOT NULL,
            file_type TEXT NOT NULL CHECK(file_type IN ('syllabus', 'past_exam', 'notes', 'other')),
            file_size INTEGER,
            uploaded_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            exam_id INTEGER,
            title TEXT NOT NULL,
            topic TEXT,
            subject TEXT,
            deadline TEXT,
            day_date TEXT,
            sort_order INTEGER DEFAULT 0,
            priority INTEGER DEFAULT 5,
            estimated_hours REAL DEFAULT 1.0,
            difficulty INTEGER DEFAULT 3 CHECK(difficulty BETWEEN 0 AND 5),
            status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'done', 'deferred')),
            is_delayed INTEGER DEFAULT 0,
            original_date TEXT,
            linked_task_id INTEGER,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS schedule_blocks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            task_id INTEGER,
            exam_id INTEGER,
            exam_name TEXT,
            task_title TEXT,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            day_date TEXT,
            block_type TEXT DEFAULT 'study' CHECK(block_type IN ('study', 'break', 'hobby')),
            completed INTEGER DEFAULT 0,
            is_delayed INTEGER DEFAULT 0,
            is_split INTEGER DEFAULT 0,
            part_number INTEGER,
            total_parts INTEGER,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (task_id) REFERENCES tasks(id),
            FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            endpoint TEXT NOT NULL UNIQUE,
            p256dh TEXT NOT NULL,
            auth TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_exams_user_date ON exams(user_id, exam_date);
        CREATE INDEX IF NOT EXISTS idx_exam_files_exam ON exam_files(exam_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_exam ON tasks(exam_id);
        CREATE INDEX IF NOT EXISTS idx_schedule_day ON schedule_blocks(day_date);
    """)

    # Migrations: add auth columns if missing
    columns = {row[1] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
    if "password_hash" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN password_hash TEXT DEFAULT ''")
    if "auth_token" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN auth_token TEXT")
    if "google_id" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN google_id TEXT")
    if "google_linked" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN google_linked INTEGER DEFAULT 0")
    if "hobby_name" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN hobby_name TEXT")
    if "neto_study_hours" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN neto_study_hours REAL DEFAULT 4.0")
    if "peak_productivity" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN peak_productivity TEXT DEFAULT 'Morning'")
    if "onboarding_completed" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN onboarding_completed INTEGER DEFAULT 0")
    if "timezone_offset" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN timezone_offset INTEGER DEFAULT 0")
    if "fixed_breaks" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN fixed_breaks TEXT DEFAULT '[]'")

    conn.execute("CREATE INDEX IF NOT EXISTS idx_users_token ON users(auth_token)")
    # Unique index: only one user per Google ID (CREATE UNIQUE INDEX ignores nulls in SQLite)
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL")

    # Migrations: add parsed_context to exams if missing
    exam_columns = {row[1] for row in conn.execute("PRAGMA table_info(exams)").fetchall()}
    if "parsed_context" not in exam_columns:
        conn.execute("ALTER TABLE exams ADD COLUMN parsed_context TEXT")

    # Migrations: add calendar columns to tasks if missing
    task_columns = {row[1] for row in conn.execute("PRAGMA table_info(tasks)").fetchall()}
    if "day_date" not in task_columns:
        conn.execute("ALTER TABLE tasks ADD COLUMN day_date TEXT")
    if "sort_order" not in task_columns:
        conn.execute("ALTER TABLE tasks ADD COLUMN sort_order INTEGER DEFAULT 0")
    if "is_delayed" not in task_columns:
        conn.execute("ALTER TABLE tasks ADD COLUMN is_delayed INTEGER DEFAULT 0")
    if "priority" not in task_columns:
        conn.execute("ALTER TABLE tasks ADD COLUMN priority INTEGER DEFAULT 5")

    conn.execute("CREATE INDEX IF NOT EXISTS idx_tasks_day ON tasks(day_date)")

    # Migrations: update tasks table for status='deferred' and new columns (SQLite table rebuild)
    if "original_date" not in task_columns:
        # We need to rebuild the table because SQLite doesn't support ALTER TABLE for CHECK constraints
        try:
            conn.execute("PRAGMA foreign_keys = OFF;")
            conn.execute("BEGIN TRANSACTION;")
            conn.execute("""
                CREATE TABLE tasks_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    exam_id INTEGER,
                    title TEXT NOT NULL,
                    topic TEXT,
                    subject TEXT,
                    deadline TEXT,
                    day_date TEXT,
                    sort_order INTEGER DEFAULT 0,
                    priority INTEGER DEFAULT 5,
                    estimated_hours REAL DEFAULT 1.0,
                    difficulty INTEGER DEFAULT 3 CHECK(difficulty BETWEEN 0 AND 5),
                    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'done', 'deferred')),
                    is_delayed INTEGER DEFAULT 0,
                    original_date TEXT,
                    linked_task_id INTEGER,
                    created_at TEXT DEFAULT (datetime('now')),
                    FOREIGN KEY (user_id) REFERENCES users(id),
                    FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
                );
            """)
            
            # Map existing columns
            cols_to_copy = ["id", "user_id", "exam_id", "title", "topic", "subject", "deadline", "estimated_hours", "difficulty", "status", "is_delayed", "created_at"]
            if "day_date" in task_columns: cols_to_copy.append("day_date")
            if "sort_order" in task_columns: cols_to_copy.append("sort_order")
            if "priority" in task_columns: cols_to_copy.append("priority")
            
            cols_str = ", ".join(cols_to_copy)
            conn.execute(f"INSERT INTO tasks_new ({cols_str}) SELECT {cols_str} FROM tasks;")
            
            conn.execute("DROP TABLE tasks;")
            conn.execute("ALTER TABLE tasks_new RENAME TO tasks;")
            
            conn.execute("CREATE INDEX IF NOT EXISTS idx_tasks_exam ON tasks(exam_id);")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_tasks_day ON tasks(day_date);")
            
            conn.execute("COMMIT;")
            conn.execute("PRAGMA foreign_keys = ON;")
        except Exception as e:
            conn.execute("ROLLBACK;")
            print(f"Tasks migration failed: {e}")

    # Migrations: add is_delayed to schedule_blocks
    block_columns = {row[1] for row in conn.execute("PRAGMA table_info(schedule_blocks)").fetchall()}
    if "is_delayed" not in block_columns:
        conn.execute("ALTER TABLE schedule_blocks ADD COLUMN is_delayed INTEGER DEFAULT 0")
    if "task_title" not in block_columns:
        conn.execute("ALTER TABLE schedule_blocks ADD COLUMN task_title TEXT")
    if "exam_name" not in block_columns:
        conn.execute("ALTER TABLE schedule_blocks ADD COLUMN exam_name TEXT")
    if "is_manually_edited" not in block_columns:
        conn.execute("ALTER TABLE schedule_blocks ADD COLUMN is_manually_edited INTEGER DEFAULT 0")
    if "deferred_original_day" not in block_columns:
        conn.execute("ALTER TABLE schedule_blocks ADD COLUMN deferred_original_day TEXT")
    if "is_split" not in block_columns:
        conn.execute("ALTER TABLE schedule_blocks ADD COLUMN is_split INTEGER DEFAULT 0")
    if "part_number" not in block_columns:
        conn.execute("ALTER TABLE schedule_blocks ADD COLUMN part_number INTEGER")
    if "total_parts" not in block_columns:
        conn.execute("ALTER TABLE schedule_blocks ADD COLUMN total_parts INTEGER")

    # Migrations: add push notification columns to users
    user_columns = {row[1] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
    if "push_subscription" not in user_columns:
        conn.execute("ALTER TABLE users ADD COLUMN push_subscription TEXT")
    if "notif_timing" not in user_columns:
        conn.execute("ALTER TABLE users ADD COLUMN notif_timing TEXT DEFAULT 'at_start'")
    if "notif_per_task" not in user_columns:
        conn.execute("ALTER TABLE users ADD COLUMN notif_per_task INTEGER DEFAULT 1")
    if "notif_daily_summary" not in user_columns:
        conn.execute("ALTER TABLE users ADD COLUMN notif_daily_summary INTEGER DEFAULT 0")

    conn.commit()
    conn.close()
