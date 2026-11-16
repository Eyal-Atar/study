from uuid import UUID

from fastapi import APIRouter, Response

from app.auth import AuthenticatedUser
from app.deps import DatabaseDep
from app.schemas.push import PushSubscriptionIn, PushSubscriptionOut
from app.services import push as push_service

router = APIRouter()


@router.post("/push/subscriptions", status_code=201)
def post_subscription(
    body: PushSubscriptionIn, response: Response, user: AuthenticatedUser, database: DatabaseDep
) -> PushSubscriptionOut:
    with database.transaction(user) as conn:
        subscription_id, created = push_service.save_subscription(
            conn,
            user.id,
            endpoint=body.endpoint,
            p256dh=body.keys.p256dh,
            auth=body.keys.auth,
            user_agent=body.user_agent,
        )
    # The browser registers again on every visit; 200 tells it nothing new was made.
    if not created:
        response.status_code = 200
    return PushSubscriptionOut(id=subscription_id, created=created)


@router.delete("/push/subscriptions/{subscription_id}", status_code=204, response_class=Response)
def delete_subscription(
    subscription_id: UUID, user: AuthenticatedUser, database: DatabaseDep
) -> None:
    with database.transaction(user) as conn:
        push_service.delete_subscription(conn, user.id, subscription_id)
