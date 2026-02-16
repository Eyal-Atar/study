"""User profile routes."""

from fastapi import APIRouter, Depends, HTTPException
from server.database import get_db
from auth.utils import get_current_user
from users.schemas import UserResponse, UserUpdate

router = APIRouter()


@router.get("/users/me", response_model=UserResponse)
def get_profile(current_user: dict = Depends(get_current_user)):
    return UserResponse(**{k: current_user[k] for k in UserResponse.model_fields})


@router.patch("/users/me", response_model=UserResponse)
def update_profile(body: UserUpdate, current_user: dict = Depends(get_current_user)):
    db = get_db()
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        db.close()
        raise HTTPException(status_code=400, detail="No fields to update")

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [current_user["id"]]
    db.execute(f"UPDATE users SET {set_clause} WHERE id = ?", values)
    db.commit()

    row = db.execute("SELECT * FROM users WHERE id = ?", (current_user["id"],)).fetchone()
    db.close()
    return UserResponse(**{k: dict(row)[k] for k in UserResponse.model_fields})
