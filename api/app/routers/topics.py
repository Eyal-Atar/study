"""The topics of an exam (S15): GET /exams/{exam_id}/topics and PATCH /topics/{topic_id}."""

from uuid import UUID

from fastapi import APIRouter

from app.auth import AuthenticatedUser
from app.deps import DatabaseDep
from app.schemas.topics import ExamTopicsResponse, GapOut, TopicOut, TopicPatch
from app.services import topics as topic_service

router = APIRouter()


@router.get("/exams/{exam_id}/topics")
def get_exam_topics(
    exam_id: UUID, user: AuthenticatedUser, database: DatabaseDep
) -> ExamTopicsResponse:
    with database.transaction(user) as conn:
        found = topic_service.exam_topics(conn, user.id, exam_id)
    return ExamTopicsResponse(
        analysis_id=found.analysis_id,
        draft_analysis_id=found.draft_analysis_id,
        topics=[TopicOut.model_validate(row) for row in found.topics],
        gaps=[GapOut.model_validate(gap) for gap in found.gaps],
    )


@router.patch("/topics/{topic_id}")
def patch_topic(
    topic_id: UUID, body: TopicPatch, user: AuthenticatedUser, database: DatabaseDep
) -> TopicOut:
    with database.transaction(user) as conn:
        row = topic_service.update_topic(
            conn, user.id, topic_id, body.model_dump(exclude_unset=True)
        )
    return TopicOut.model_validate(row)
