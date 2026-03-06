import json
import litellm
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

def get_judge_system_prompt():
    try:
        path = "backend/eval/prompts/judge_system.txt"
        with open(path, "r") as f:
            return f.read()
    except Exception:
        return "You are the StudyFlow AI Judge. Evaluate logical correctness (1-10) and JSON validity of the scheduler's output."

def evaluate_output(scenario, model_output_content):
    """
    Evaluates the model output for both structural and logical correctness.
    """
    judge_model = os.getenv("JUDGE_MODEL", "gpt-4o")

    # 1. Structural Pass/Fail (Simple JSON Check)
    structural_pass = False
    parsed_json = None
    try:
        parsed_json = json.loads(model_output_content)
        # Check for essential 'schedule' key (StudyFlow convention)
        if "schedule" in parsed_json:
            structural_pass = True
    except Exception:
        structural_pass = False

    # 2. Logical Scoring (via Judge Model)
    # Prepare messages for Judge
    judge_system_prompt = get_judge_system_prompt()
    user_content = f"""
    ### SCENARIO CONTEXT:
    {json.dumps(scenario, indent=2)}

    ### MODEL OUTPUT:
    {model_output_content}

    Evaluate the output against the scenario constraints.
    """

    messages = [
        {"role": "system", "content": judge_system_prompt},
        {"role": "user", "content": user_content}
    ]

    try:
        response = litellm.completion(
            model=judge_model,
            messages=messages,
            temperature=0,
            response_format={"type": "json_object"}
        )
        
        judge_result = json.loads(response.choices[0].message.content)
        
        # Merge structural_pass into judge_result
        judge_result["structural_pass"] = structural_pass
        
        return judge_result
    except Exception as e:
        return {
            "structural_pass": structural_pass,
            "logical_score": 0,
            "critique": f"Judge error: {str(e)}",
            "compensating_prompt": "None"
        }
