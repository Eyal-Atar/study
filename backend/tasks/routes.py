"""Task routes."""

from datetime import datetime, timedelta
from fastapi import APIRouter, Depends
from typing import List
from server.database import get_db
from auth.utils import get_current_user
from tasks.schemas import TaskResponse, BlockUpdate

router = APIRouter()


@router.get("/tasks", response_model=List[TaskResponse])
def get_tasks(current_user: dict = Depends(get_current_user)):
    db = get_db()
    rows = db.execute("""
        SELECT t.*, e.name as exam_name
        FROM tasks t
        LEFT JOIN exams e ON t.exam_id = e.id
        WHERE t.user_id = ?
        ORDER BY t.day_date, t.sort_order
    """, (current_user["id"],)).fetchall()
    db.close()
    return [TaskResponse(**dict(r)) for r in rows]


@router.patch("/tasks/block/{block_id}")
def update_block(block_id: int, body: BlockUpdate, current_user: dict = Depends(get_current_user)):
    """Update an individual schedule block's details."""
    db = get_db()
    
    # 1. Ownership check
    block = db.execute("SELECT * FROM schedule_blocks WHERE id = ? AND user_id = ?", 
                       (block_id, current_user["id"])).fetchone()
    if not block:
        db.close()
        return {"error": "Block not found"}, 404
        
    # 2. Update block fields
    updates = []
    params = []
    if body.task_title is not None:
        updates.append("task_title = ?")
        params.append(body.task_title)
    if body.start_time is not None:
        updates.append("start_time = ?")
        params.append(body.start_time)
        # We might also want to update day_date based on start_time if it changes date
        updates.append("day_date = date(?)")
        params.append(body.start_time)
        # Reset push notification flag for time change
        updates.append("push_notified = 0")
    if body.end_time is not None:
        updates.append("end_time = ?")
        params.append(body.end_time)
    if body.is_delayed is not None:
        updates.append("is_delayed = ?")
        params.append(1 if body.is_delayed else 0)
    if body.completed is not None:
        updates.append("completed = ?")
        params.append(1 if body.completed else 0)

    # Mark as manually edited if the user changed time or title
    if body.start_time is not None or body.end_time is not None or body.task_title is not None:
        updates.append("is_manually_edited = 1")
        updates.append("push_notified = 0")

    if not updates:
        db.close()
        return {"message": "No changes provided"}
        
    params.append(block_id)
    params.append(current_user["id"])
    db.execute(f"UPDATE schedule_blocks SET {', '.join(updates)} WHERE id = ? AND user_id = ?", params)
    
    # 3. Synchronize with main tasks table if this is a study block
    if block["task_id"]:
        if body.task_title is not None:
            db.execute(
                "UPDATE tasks SET title = ? WHERE id = ? AND user_id = ?",
                (body.task_title, block["task_id"], current_user["id"])
            )
        if body.start_time is not None:
            db.execute(
                "UPDATE tasks SET day_date = date(?) WHERE id = ? AND user_id = ?",
                (body.start_time, block["task_id"], current_user["id"])
            )
        if body.is_delayed is not None:
            db.execute(
                "UPDATE tasks SET is_delayed = ? WHERE id = ? AND user_id = ?",
                (1 if body.is_delayed else 0, block["task_id"], current_user["id"])
            )
        
    db.commit()
    db.close()
    return {"message": "Block updated successfully"}


@router.delete("/tasks/block/{block_id}")
def delete_block(block_id: int, current_user: dict = Depends(get_current_user)):
    """Delete an individual schedule block and handle task status."""
    db = get_db()
    
    # 1. Fetch block to know what we are deleting
    block = db.execute("SELECT * FROM schedule_blocks WHERE id = ? AND user_id = ?", 
                       (block_id, current_user["id"])).fetchone()
    if not block:
        db.close()
        return {"error": "Block not found"}, 404
        
    # 2. Delete the block
    db.execute("DELETE FROM schedule_blocks WHERE id = ? AND user_id = ?", 
               (block_id, current_user["id"]))
    
    # 3. If it was a 'study' block, mark the associated task as pending/unscheduled
    if block["block_type"] == "study" and block["task_id"]:
        # We set day_date to NULL so it reappears in the unscheduled list
        db.execute(
            "UPDATE tasks SET day_date = NULL, status = 'pending' WHERE id = ? AND user_id = ?",
            (block["task_id"], current_user["id"])
        )
        
    db.commit()
    db.close()
    return {"message": "Block deleted successfully"}


@router.patch("/tasks/block/{block_id}/done")
def mark_block_done(block_id: int, current_user: dict = Depends(get_current_user)):
    db = get_db()
    db.execute(
        "UPDATE schedule_blocks SET completed = 1 WHERE id = ? AND user_id = ?",
        (block_id, current_user["id"])
    )
    # Sync task status: when all blocks for this task are done, mark task done (exam progress bars)
    row = db.execute(
        "SELECT task_id FROM schedule_blocks WHERE id = ? AND user_id = ?",
        (block_id, current_user["id"])
    ).fetchone()
    if row and row["task_id"]:
        agg = db.execute(
            "SELECT COUNT(*) AS cnt, SUM(completed) AS sum_done FROM schedule_blocks WHERE task_id = ? AND user_id = ?",
            (row["task_id"], current_user["id"])
        ).fetchone()
        if agg and agg["cnt"] and agg["sum_done"] == agg["cnt"]:
            db.execute(
                "UPDATE tasks SET status = 'done' WHERE id = ? AND user_id = ?",
                (row["task_id"], current_user["id"])
            )
    db.commit()
    db.close()
    return {"message": "Block marked as done!"}


@router.patch("/tasks/block/{block_id}/undone")
def mark_block_undone(block_id: int, current_user: dict = Depends(get_current_user)):
    db = get_db()
    db.execute(
        "UPDATE schedule_blocks SET completed = 0 WHERE id = ? AND user_id = ?",
        (block_id, current_user["id"])
    )
    # Sync task status: any block undone => task no longer fully done (exam progress bars)
    row = db.execute(
        "SELECT task_id FROM schedule_blocks WHERE id = ? AND user_id = ?",
        (block_id, current_user["id"])
    ).fetchone()
    if row and row["task_id"]:
        db.execute(
            "UPDATE tasks SET status = 'pending' WHERE id = ? AND user_id = ?",
            (row["task_id"], current_user["id"])
        )
    db.commit()
    db.close()
    return {"message": "Block marked as undone!"}


@router.patch("/tasks/{task_id}/done")
def mark_task_done(task_id: int, current_user: dict = Depends(get_current_user)):
    db = get_db()
    db.execute(
        "UPDATE tasks SET status = 'done' WHERE id = ? AND user_id = ?",
        (task_id, current_user["id"])
    )
    # Sync all blocks for this task so Roadmap (calendar) shows them done
    db.execute(
        "UPDATE schedule_blocks SET completed = 1 WHERE task_id = ? AND user_id = ?",
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
    # Sync all blocks for this task so Roadmap (calendar) shows them undone
    db.execute(
        "UPDATE schedule_blocks SET completed = 0 WHERE task_id = ? AND user_id = ?",
        (task_id, current_user["id"])
    )
    db.commit()
    db.close()
    return {"message": "Task marked as pending"}


@router.post("/tasks/block/{block_id}/defer")
def defer_block_to_next_day(block_id: int, current_user: dict = Depends(get_current_user)):
    """Move a schedule block to the next calendar day (push-to-next-day foundation)."""
    db = get_db()
    block = db.execute(
        "SELECT id, task_id, user_id, day_date, start_time, end_time FROM schedule_blocks WHERE id = ? AND user_id = ?",
        (block_id, current_user["id"])
    ).fetchone()
    if not block:
        db.close()
        return {"error": "Block not found"}, 404

    day_date = block["day_date"]
    if not day_date:
        db.close()
        return {"error": "Block has no day_date"}, 400

    try:
        dt = datetime.strptime(day_date, "%Y-%m-%d")
    except ValueError:
        db.close()
        return {"error": "Invalid day_date format"}, 400

    next_day = (dt + timedelta(days=1)).strftime("%Y-%m-%d")
    orig_start = block["start_time"]
    orig_end = block["end_time"]
    # start_time/end_time may be "YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DDTHH:MM:SS"
    try:
        if "T" in orig_start:
            start_dt = datetime.fromisoformat(orig_start.replace("Z", "+00:00"))
        else:
            start_dt = datetime.strptime(orig_start.replace("T", " ").split(".")[0], "%Y-%m-%d %H:%M:%S")
    except ValueError:
        start_dt = datetime.strptime(day_date + " 08:00:00", "%Y-%m-%d %H:%M:%S")
    try:
        if "T" in orig_end:
            end_dt = datetime.fromisoformat(orig_end.replace("Z", "+00:00"))
        else:
            end_dt = datetime.strptime(orig_end.replace("T", " ").split(".")[0], "%Y-%m-%d %H:%M:%S")
    except ValueError:
        end_dt = start_dt + timedelta(hours=1)

    new_start = next_day + " " + start_dt.strftime("%H:%M:%S")
    new_end = next_day + " " + end_dt.strftime("%H:%M:%S")

    db.execute(
        """UPDATE schedule_blocks SET start_time = ?, end_time = ?, day_date = ?, is_delayed = 1, deferred_original_day = ?, push_notified = 0
           WHERE id = ? AND user_id = ?""",
        (new_start, new_end, next_day, day_date, block_id, current_user["id"])
    )
    if block["task_id"]:
        db.execute(
            "UPDATE tasks SET day_date = ?, is_delayed = 1 WHERE id = ? AND user_id = ?",
            (next_day, block["task_id"], current_user["id"])
        )
    db.commit()
    db.close()
    return {"message": "Block deferred to next day", "day_date": next_day}


@router.patch("/tasks/{task_id}/shift-time")
def shift_task_time(task_id: int, body: dict, current_user: dict = Depends(get_current_user)):
    """Manually shift a task start/end times via schedule_blocks."""
    minutes = body.get("minutes", 0)
    db = get_db()
    
    # We update the schedule_blocks directly for manual overrides
    # In a full system, we might update the task itself, but blocks are the source of truth for the hourly view
    db.execute(
        """UPDATE schedule_blocks 
           SET start_time = datetime(start_time, ? || ' minutes'),
               end_time = datetime(end_time, ? || ' minutes'),
               push_notified = 0
           WHERE task_id = ? AND user_id = ?""",
        (f"{minutes:+}", f"{minutes:+}", task_id, current_user["id"])
    )
    db.commit()
    db.close()
    return {"message": f"Shifted task by {minutes} minutes"}


@router.patch("/tasks/{task_id}/duration")
def update_task_duration(task_id: int, body: dict, current_user: dict = Depends(get_current_user)):
    hours = body.get("estimated_hours", 1.0)
    db = get_db()
    
    # Update task estimation
    db.execute(
        "UPDATE tasks SET estimated_hours = ? WHERE id = ? AND user_id = ?",
        (hours, task_id, current_user["id"])
    )
    
    # Also update the specific block's end_time to reflect new duration immediately
    # end_time = start_time + hours
    db.execute(
        """UPDATE schedule_blocks 
           SET end_time = datetime(start_time, '+' || (? * 60) || ' minutes'),
               push_notified = 0
           WHERE task_id = ? AND user_id = ?""",
        (hours, task_id, current_user["id"])
    )
    
    db.commit()
    db.close()
    return {"message": "Duration updated"}
