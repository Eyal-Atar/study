import os
import asyncio
import sys

# Add backend to sys.path
sys.path.append(os.getcwd())

from brain.exam_brain import ExamBrain

async def test():
    user = {
        'id': 1, 
        'neto_study_hours': 4.0, 
        'peak_productivity': 'Morning', 
        'timezone_offset': 0,
        'current_local_time': '10:00'
    }
    exams = [{
        'id': 1, 
        'name': 'Test', 
        'subject': 'Test', 
        'exam_date': '2026-03-20T00:00:00Z'
    }]
    approved_tasks = [
        {'title': f'Task {i}', 'exam_id': 1, 'estimated_hours': 1.0, 'focus_score': 5, 'task_index': i}
        for i in range(300)
    ]
    
    # Ensure LLM_MODEL is set or uses default
    os.environ.setdefault("LLM_MODEL", "openrouter/openai/gpt-4o-mini")
    # You might need OPENROUTER_API_KEY set in your environment for this to actually run
    
    brain = ExamBrain(user, exams)
    print(f"Testing model: {brain.model}")
    try:
        res = await brain.call_strategist(approved_tasks)
        print('SUCCESS:', res)
    except Exception as e:
        import traceback
        traceback.print_exc()
        print('FAILURE:', e)

if __name__ == "__main__":
    asyncio.run(test())
