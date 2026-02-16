from fastapi import APIRouter
from app.routes.auth_routes import router as auth_router
from app.routes.users import router as users_router
from app.routes.exams import router as exams_router
from app.routes.tasks import router as tasks_router
from app.routes.brain import router as brain_router

api_router = APIRouter()
api_router.include_router(auth_router, prefix="/auth", tags=["auth"])
api_router.include_router(users_router, tags=["users"])
api_router.include_router(exams_router, tags=["exams"])
api_router.include_router(tasks_router, tags=["tasks"])
api_router.include_router(brain_router, tags=["brain"])
