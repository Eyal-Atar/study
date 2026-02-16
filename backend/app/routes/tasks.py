"""Task routes."""

from fastapi import APIRouter, Depends
from typing import List
from app.database import get_db
from app.auth import get_current_user
from app.schemas import TaskResponse

router = APIRouter()


@router.get("/tasks", response_model=List[TaskResponse])
def get_tasks(current_user: dict = Depends(get_current_user)):
    db = get_db()
    rows = db.execute("""
        SELECT t.*, e.name as exam_name
        FROM tasks t
        LEFT JOIN exams e ON t.exam_id = e.id
        WHERE t.user_id = ?
        ORDER BY t.deadline
    """, (current_user["id"],)).fetchall()
    db.close()
    return [TaskResponse(**dict(r)) for r in rows]


@router.patch("/tasks/{task_id}/done")
def mark_task_done(task_id: int, current_user: dict = Depends(get_current_user)):
    db = get_db()
    db.execute(
        "UPDATE tasks SET status = 'done' WHERE id = ? AND user_id = ?",
        (task_id, current_user["id"])
    )
    db.commit()
    db.close()
    return {"message": "Task marked as done!"}


@router.patch("/tasks/{task_id}/undone")
def mark_task_undone(task_id: int, current_user: dict = Depends(get_current_user)):
    db = get_db()
    db.execute(
        "UPDATE tasks SET status = 'pending' WHERE id = ? AND user_id = ?",
        (task_id, current_user["id"])
    )
    db.commit()
    db.close()
    return {"message": "Task marked as pending"}
