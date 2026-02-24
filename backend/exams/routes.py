"""Exam CRUD + file upload routes."""

import os
import shutil
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from typing import List
from server.database import get_db
from server.config import UPLOAD_DIR
from auth.utils import get_current_user
from exams.schemas import ExamCreate, ExamUpdate, ExamResponse, ExamFileResponse

router = APIRouter()


@router.post("/exams", response_model=ExamResponse)
def create_exam(exam: ExamCreate, current_user: dict = Depends(get_current_user)):
    db = get_db()
    try:
        cursor = db.execute(
            """INSERT INTO exams (user_id, name, subject, exam_date, special_needs)
               VALUES (?, ?, ?, ?, ?)""",
            (current_user["id"], exam.name, exam.subject, exam.exam_date, exam.special_needs)
        )
        db.commit()
        exam_id = cursor.lastrowid
    finally:
        db.close()
    return ExamResponse(
        id=exam_id, user_id=current_user["id"], status="upcoming",
        **exam.model_dump()
    )


@router.get("/exams", response_model=List[ExamResponse])
def get_exams(current_user: dict = Depends(get_current_user)):
    db = get_db()
    rows = db.execute(
        "SELECT * FROM exams WHERE user_id = ? ORDER BY exam_date",
        (current_user["id"],)
    ).fetchall()

    exams = []
    for row in rows:
        d = dict(row)
        eid = d["id"]
        file_count = db.execute(
            "SELECT COUNT(*) FROM exam_files WHERE exam_id = ?", (eid,)
        ).fetchone()[0]
        task_count = db.execute(
            "SELECT COUNT(*) FROM tasks WHERE exam_id = ?", (eid,)
        ).fetchone()[0]
        done_count = db.execute(
            "SELECT COUNT(*) FROM tasks WHERE exam_id = ? AND status = 'done'", (eid,)
        ).fetchone()[0]
        exams.append(ExamResponse(
            **d, file_count=file_count, task_count=task_count, done_count=done_count
        ))
    db.close()
    return exams


@router.delete("/exams/{exam_id}")
def delete_exam(exam_id: int, current_user: dict = Depends(get_current_user)):
    db = get_db()
    exam = db.execute(
        "SELECT * FROM exams WHERE id = ? AND user_id = ?",
        (exam_id, current_user["id"])
    ).fetchone()
    if not exam:
        db.close()
        raise HTTPException(status_code=404, detail="Exam not found")

    exam_dir = os.path.join(UPLOAD_DIR, f"user_{current_user['id']}", f"exam_{exam_id}")
    if os.path.exists(exam_dir):
        shutil.rmtree(exam_dir)

    db.execute("DELETE FROM exams WHERE id = ?", (exam_id,))
    db.commit()
    db.close()
    return {"message": "Exam deleted"}


@router.patch("/exams/{exam_id}", response_model=ExamResponse)
def update_exam(exam_id: int, body: ExamUpdate, current_user: dict = Depends(get_current_user)):
    db = get_db()
    exam = db.execute(
        "SELECT * FROM exams WHERE id = ? AND user_id = ?",
        (exam_id, current_user["id"])
    ).fetchone()
    if not exam:
        db.close()
        raise HTTPException(status_code=404, detail="Exam not found")

    updates = []
    values = []
    if body.name is not None:
        updates.append("name = ?")
        values.append(body.name)
    if body.subject is not None:
        updates.append("subject = ?")
        values.append(body.subject)
    if body.exam_date is not None:
        updates.append("exam_date = ?")
        values.append(body.exam_date)
    if body.special_needs is not None:
        updates.append("special_needs = ?")
        values.append(body.special_needs)

    if updates:
        values.append(exam_id)
        db.execute(f"UPDATE exams SET {', '.join(updates)} WHERE id = ?", values)
        db.commit()

    updated = db.execute("SELECT * FROM exams WHERE id = ?", (exam_id,)).fetchone()
    file_count = db.execute("SELECT COUNT(*) FROM exam_files WHERE exam_id = ?", (exam_id,)).fetchone()[0]
    task_count = db.execute("SELECT COUNT(*) FROM tasks WHERE exam_id = ?", (exam_id,)).fetchone()[0]
    done_count = db.execute("SELECT COUNT(*) FROM tasks WHERE exam_id = ? AND status = 'done'", (exam_id,)).fetchone()[0]
    db.close()
    return ExamResponse(**dict(updated), file_count=file_count, task_count=task_count, done_count=done_count)


@router.post("/exams/{exam_id}/upload", response_model=ExamFileResponse)
async def upload_exam_file(
    exam_id: int,
    file_type: str = Form(default="syllabus"),
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    exam = db.execute(
        "SELECT * FROM exams WHERE id = ? AND user_id = ?",
        (exam_id, current_user["id"])
    ).fetchone()
    if not exam:
        db.close()
        raise HTTPException(status_code=404, detail="Exam not found")

    exam_dir = os.path.join(UPLOAD_DIR, f"user_{current_user['id']}", f"exam_{exam_id}")
    os.makedirs(exam_dir, exist_ok=True)

    safe_name = file.filename.replace("/", "_").replace("\\", "_")
    file_path = os.path.join(exam_dir, safe_name)

    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)

    file_size = len(content)
    try:
        cursor = db.execute(
            """INSERT INTO exam_files (exam_id, filename, file_path, file_type, file_size)
               VALUES (?, ?, ?, ?, ?)""",
            (exam_id, safe_name, file_path, file_type, file_size)
        )
        db.commit()
        file_id = cursor.lastrowid
    finally:
        db.close()

    return ExamFileResponse(
        id=file_id, exam_id=exam_id, filename=safe_name,
        file_type=file_type, file_size=file_size
    )


@router.get("/exams/{exam_id}/files", response_model=List[ExamFileResponse])
def get_exam_files(exam_id: int, current_user: dict = Depends(get_current_user)):
    db = get_db()
    rows = db.execute(
        """SELECT ef.* FROM exam_files ef
           JOIN exams e ON ef.exam_id = e.id
           WHERE ef.exam_id = ? AND e.user_id = ?""",
        (exam_id, current_user["id"])
    ).fetchall()
    db.close()
    return [ExamFileResponse(**dict(r)) for r in rows]


@router.delete("/exam-files/{file_id}")
def delete_exam_file(file_id: int, current_user: dict = Depends(get_current_user)):
    db = get_db()
    row = db.execute(
        """SELECT ef.* FROM exam_files ef
           JOIN exams e ON ef.exam_id = e.id
           WHERE ef.id = ? AND e.user_id = ?""",
        (file_id, current_user["id"])
    ).fetchone()
    if not row:
        db.close()
        raise HTTPException(status_code=404, detail="File not found")

    if os.path.exists(row["file_path"]):
        os.remove(row["file_path"])

    db.execute("DELETE FROM exam_files WHERE id = ?", (file_id,))
    db.commit()
    db.close()
    return {"message": "File deleted"}
