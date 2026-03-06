import streamlit as st
import json
import time
import os
from dotenv import load_dotenv
import litellm
import pandas as pd
from datetime import datetime

# Import judge logic
from judge_logic import evaluate_output

# Load environment variables
load_dotenv()

# Initialize session state for tracking total cost and run history
if 'total_cost' not in st.session_state:
    st.session_state.total_cost = 0.0
if 'run_results' not in st.session_state:
    st.session_state.run_results = {}

# Load default prompts
def load_default_prompt(filename):
    try:
        # Check if file exists in the new prompts directory
        path = f"backend/eval/prompts/{filename}"
        if os.path.exists(path):
            with open(path, "r") as f:
                return f.read()
        return ""
    except Exception:
        return ""

st.set_page_config(layout="wide", page_title="StudyFlow LLM Arena")

st.title("StudyFlow LLM Evaluation Arena 🏟️")

# Sidebar - Settings and Configuration
with st.sidebar:
    st.header("⚖️ Judge Configuration")
    judge_model = st.selectbox("Judge Model", ["gpt-4o", "gpt-4o-mini", "openrouter/anthropic/claude-3.5-sonnet"], index=0)
    # Set JUDGE_MODEL in env for judge_logic to pick up
    os.environ["JUDGE_MODEL"] = judge_model
    
    st.divider()
    st.header("⚙️ Scenario Selection")
    
    # Load Golden Dataset
    try:
        with open("backend/eval/golden_cases.json", "r") as f:
            scenarios = json.load(f)
        scenario_ids = [s["scenario_id"] for s in scenarios]
        selected_id = st.selectbox("Select Scenario", scenario_ids)
        scenario = next(s for s in scenarios if s["scenario_id"] == selected_id)
    except Exception as e:
        st.error(f"Error loading scenarios: {e}")
        scenario = None

    st.divider()
    
    st.subheader("Model Selection")
    model_options = [
        "gpt-4o", 
        "gpt-4o-mini", 
        "openrouter/anthropic/claude-3-haiku", 
        "openrouter/anthropic/claude-3.5-sonnet", 
        "gemini/gemini-1.5-flash",
        "gemini/gemini-1.5-pro"
    ]
    
    model_a = st.selectbox("Current Model (A)", model_options, index=0)
    custom_a = st.text_input("Custom Model A (e.g. openrouter/...)")
    if custom_a:
        model_a = custom_a
        
    model_b = st.selectbox("Challenger Model (B)", model_options, index=2)
    custom_b = st.text_input("Custom Model B")
    if custom_b:
        model_b = custom_b

    st.divider()
    
    st.subheader("Prompt Engineering")
    # Live Prompt Editor for Challenger
    default_system_prompt = load_default_prompt("scheduler_default.txt")
    system_prompt_b = st.text_area("Challenger System Prompt", value=default_system_prompt, height=300)
    
    if st.button("Copy System Prompt"):
        st.info("Copy the prompt below using the copy button in the top right of the code block:")
        st.code(system_prompt_b)

    st.divider()
    
    col_run1, col_run_all = st.columns(2)
    with col_run1:
        run_button = st.button("Run Comparison", type="primary", use_container_width=True)
    with col_run_all:
        run_all_button = st.button("Run All Scenarios", type="secondary", use_container_width=True)

    st.divider()
    st.metric("Session Total Cost", f"${st.session_state.total_cost:.6f}")
    if st.button("Clear History"):
        st.session_state.total_cost = 0.0
        st.session_state.run_results = {}
        st.rerun()

def call_model(model_name, messages, temperature=0):
    start_time = time.time()
    try:
        response = litellm.completion(
            model=model_name,
            messages=messages,
            temperature=temperature,
            response_format={"type": "json_object"}
        )
        latency = time.time() - start_time
        content = response.choices[0].message.content
        
        try:
            cost = litellm.completion_cost(completion_response=response)
        except:
            cost = 0
        
        return {
            "content": content,
            "latency": latency,
            "cost": cost,
            "usage": response.usage,
            "model": model_name
        }
    except Exception as e:
        return {"error": str(e), "latency": time.time() - start_time, "cost": 0, "model": model_name}

def get_scenario_messages(scenario, system_prompt=None):
    user_content = f"""
    Current Time: {scenario['current_time']}
    Tasks to schedule: {json.dumps(scenario['tasks'])}
    Constraints: {scenario.get('constraints', [])}
    """
    
    if system_prompt:
        return [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content}
        ]
    else:
        # Default simple internal prompt for Model A
        return [{"role": "user", "content": f"You are the StudyFlow AI Scheduler. \n{user_content}\nReturn valid JSON."}]

def run_scenario(scenario, model_a, model_b, system_prompt_b):
    messages_a = get_scenario_messages(scenario) 
    messages_b = get_scenario_messages(scenario, system_prompt_b)
    
    res_a = call_model(model_a, messages_a)
    res_b = call_model(model_b, messages_b)
    
    # Judge Evaluation
    eval_a = evaluate_output(scenario, res_a.get("content", "")) if "error" not in res_a else {"error": "Skipped judge"}
    eval_b = evaluate_output(scenario, res_b.get("content", "")) if "error" not in res_b else {"error": "Skipped judge"}
    
    res_a["eval"] = eval_a
    res_b["eval"] = eval_b
    
    # Update total cost
    st.session_state.total_cost += res_a.get("cost", 0) + res_b.get("cost", 0)
    
    return res_a, res_b

def display_schedule_diff(res_a, res_b):
    try:
        a = json.loads(res_a["content"])
        b = json.loads(res_b["content"])
        
        sched_a = a.get("schedule", [])
        sched_b = b.get("schedule", [])
        
        max_len = max(len(sched_a), len(sched_b))
        diff_data = []
        for i in range(max_len):
            block_a = sched_a[i] if i < len(sched_a) else {}
            block_b = sched_b[i] if i < len(sched_b) else {}
            
            row = {
                "Step": i + 1,
                "Task (A)": block_a.get("task_id") or block_a.get("title", "-"),
                "Start (A)": block_a.get("start_time", "-"),
                "Task (B)": block_b.get("task_id") or block_b.get("title", "-"),
                "Start (B)": block_b.get("start_time", "-"),
            }
            # Add highlight if different
            if row["Start (A)"] != row["Start (B)"] or row["Task (A)"] != row["Task (B)"]:
                row["Match"] = "❌"
            else:
                row["Match"] = "✅"
            diff_data.append(row)
            
        st.subheader("📅 Schedule Side-by-Side Comparison")
        st.table(pd.DataFrame(diff_data))
        
    except Exception as e:
        st.error(f"Could not generate diff: {e}")

if scenario:
    st.subheader(f"Current Scenario: {scenario['scenario_id']} - {scenario['description']}")
    with st.expander("View Input Scenario Data"):
        st.json(scenario)
    
    if run_button:
        with st.spinner(f"Running comparison for {scenario['scenario_id']}..."):
            res_a, res_b = run_scenario(scenario, model_a, model_b, system_prompt_b)
            st.session_state.run_results[scenario['scenario_id']] = (res_a, res_b)
            
    if run_all_button:
        progress_bar = st.progress(0)
        for i, sc in enumerate(scenarios):
            with st.spinner(f"Running scenario {sc['scenario_id']} ({i+1}/{len(scenarios)})..."):
                res_a, res_b = run_scenario(sc, model_a, model_b, system_prompt_b)
                st.session_state.run_results[sc['scenario_id']] = (res_a, res_b)
            progress_bar.progress((i + 1) / len(scenarios))
        st.success("Batch run complete!")

    # Display Results
    if scenario['scenario_id'] in st.session_state.run_results:
        res_a, res_b = st.session_state.run_results[scenario['scenario_id']]
        
        col1, col2 = st.columns(2)
        
        with col1:
            st.header(f"Model A: {model_a}")
            if "error" in res_a:
                st.error(res_a["error"])
            else:
                c1, c2, c3 = st.columns(3)
                c1.metric("Latency", f"{res_a['latency']:.2f}s")
                c2.metric("Cost", f"${res_a['cost']:.6f}")
                
                # Evaluation metrics
                eval_a = res_a.get("eval", {})
                score_a = eval_a.get("logical_score", 0)
                pass_a = eval_a.get("structural_pass", False)
                c3.metric("Judge Score", f"{score_a}/10", delta="PASSED" if pass_a else "FAILED", delta_color="normal" if pass_a else "inverse")
                
                if not pass_a:
                    st.error("🚨 Structural Failure: Output is not valid JSON or missing 'schedule' key.")
                
                if eval_a.get("critique"):
                    st.info(f"**Critique:** {eval_a['critique']}")
                
                try:
                    parsed_a = json.loads(res_a["content"])
                    with st.expander("View Raw Output"):
                        st.json(parsed_a)
                except:
                    st.text(res_a["content"])
                
                with st.expander("Raw Usage"):
                    st.write(res_a.get("usage", {}))

        with col2:
            st.header(f"Model B: {model_b}")
            if "error" in res_b:
                st.error(res_b["error"])
            else:
                c1, c2, c3 = st.columns(3)
                c1.metric("Latency", f"{res_b['latency']:.2f}s")
                c2.metric("Cost", f"${res_b['cost']:.6f}")
                
                # Evaluation metrics
                eval_b = res_b.get("eval", {})
                score_b = eval_b.get("logical_score", 0)
                pass_b = eval_b.get("structural_pass", False)
                c3.metric("Judge Score", f"{score_b}/10", delta="PASSED" if pass_b else "FAILED", delta_color="normal" if pass_b else "inverse")

                if not pass_b:
                    st.error("🚨 Structural Failure: Output is not valid JSON or missing 'schedule' key.")
                
                if eval_b.get("critique"):
                    st.info(f"**Critique:** {eval_b['critique']}")

                # Actionable feedback for model B (Challenger)
                if eval_b.get("compensating_prompt") and eval_b["compensating_prompt"] != "None":
                    with st.container(border=True):
                        st.subheader("💡 Actionable Feedback")
                        st.markdown(f"**Suggested Improvement:**")
                        st.code(eval_b["compensating_prompt"])
                        if st.button("Copy Snippet", key="copy_snippet_btn"):
                            # This doesn't actually copy to clipboard in Streamlit easily without custom components,
                            # but providing the code block makes it copyable.
                            st.toast("Snippet ready for copy above!")

                try:
                    parsed_b = json.loads(res_b["content"])
                    with st.expander("View Raw Output"):
                        st.json(parsed_b)
                except:
                    st.text(res_b["content"])
                
                with st.expander("Raw Usage"):
                    st.write(res_b.get("usage", {}))
                    
        # Diff Analysis
        if "error" not in res_a and "error" not in res_b:
            st.divider()
            display_schedule_diff(res_a, res_b)
        
    # Batch Results Summary Table
    if st.session_state.run_results:
        st.divider()
        st.subheader("📊 Batch Performance Summary")
        summary_data = []
        for sid, (r_a, r_b) in st.session_state.run_results.items():
            summary_data.append({
                "Scenario": sid,
                "Model A": r_a.get("model"),
                "Model B": r_b.get("model"),
                "Score A": f"{r_a.get('eval', {}).get('logical_score', 0)}/10",
                "Score B": f"{r_b.get('eval', {}).get('logical_score', 0)}/10",
                "Lat A": f"{r_a['latency']:.2f}s",
                "Lat B": f"{r_b['latency']:.2f}s",
                "Cost A": f"${r_a['cost']:.6f}",
                "Cost B": f"${r_b['cost']:.6f}",
                "OK A": "✅" if r_a.get('eval', {}).get('structural_pass') else "❌",
                "OK B": "✅" if r_b.get('eval', {}).get('structural_pass') else "❌",
            })
        st.dataframe(pd.DataFrame(summary_data), use_container_width=True)

else:
    st.info("Select a scenario from the sidebar and run the comparison.")

