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
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS exams (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            subject TEXT NOT NULL,
            exam_date TEXT NOT NULL,
            special_needs TEXT,
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
            estimated_hours REAL DEFAULT 1.0,
            difficulty INTEGER DEFAULT 3 CHECK(difficulty BETWEEN 1 AND 5),
            status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'done')),
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS schedule_blocks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            task_id INTEGER NOT NULL,
            exam_id INTEGER,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            day_date TEXT,
            block_type TEXT DEFAULT 'study' CHECK(block_type IN ('study', 'break')),
            completed INTEGER DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (task_id) REFERENCES tasks(id),
            FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
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

    conn.execute("CREATE INDEX IF NOT EXISTS idx_users_token ON users(auth_token)")
    conn.commit()
    conn.close()
