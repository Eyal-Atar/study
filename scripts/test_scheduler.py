
from datetime import datetime, timedelta
from brain.scheduler import generate_multi_exam_schedule
from brain.schemas import ScheduleBlock

def test_scheduler_with_hobby():
    user = {
        "id": 1,
        "wake_up_time": "07:00",
        "sleep_time": "23:00",
        "hobby_name": "Guitar",
        "session_minutes": 60,
        "break_minutes": 15,
        "study_method": "pomodoro"
    }
    
    exams = [
        {"id": 1, "name": "Math", "subject": "Mathematics", "exam_date": (datetime.now() + timedelta(days=5)).isoformat()},
        {"id": 2, "name": "History", "subject": "History", "exam_date": (datetime.now() + timedelta(days=10)).isoformat()}
    ]
    
    tasks = [
        {"id": 101, "exam_id": 1, "title": "Algebra", "estimated_hours": 3.0, "difficulty": 4},
        {"id": 102, "exam_id": 1, "title": "Geometry", "estimated_hours": 2.0, "difficulty": 3},
        {"id": 201, "exam_id": 2, "title": "WWII", "estimated_hours": 4.0, "difficulty": 5}
    ]
    
    schedule = generate_multi_exam_schedule(user, exams, tasks)
    
    print(f"Generated {len(schedule)} blocks")
    for block in schedule[:10]:
        print(f"{block.day_date} | {block.start_time[11:16]} - {block.end_time[11:16]} | {block.block_type} | {block.task_title}")

if __name__ == "__main__":
    test_scheduler_with_hobby()
