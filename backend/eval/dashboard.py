import streamlit as st
import json
import time
import os
from dotenv import load_dotenv
import litellm
import pandas as pd

# Load environment variables
load_dotenv()

# Set up litellm logging (optional but useful)
# litellm.set_verbose = True

st.set_page_config(layout="wide", page_title="StudyFlow LLM Arena")

st.title("StudyFlow LLM Evaluation Arena 🏟️")

# Sidebar - Settings and Scenario Selection
with st.sidebar:
    st.header("Settings")
    
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
    
    model_a = st.text_input("Current Model (A)", value="gpt-4o")
    model_b = st.text_input("Challenger Model (B)", value="openrouter/anthropic/claude-3-haiku")
    
    st.divider()
    
    run_button = st.button("Run Comparison", type="primary", use_container_width=True)

if scenario:
    st.subheader(f"Scenario: {scenario['scenario_id']} - {scenario['description']}")
    with st.expander("View Scenario Data"):
        st.json(scenario)

    if run_button:
        # Construct Prompt
        prompt = f"""
        You are the StudyFlow AI Scheduler.
        Current Time: {scenario['current_time']}
        Tasks to schedule: {json.dumps(scenario['tasks'])}
        Constraints: {json.dumps(scenario.get('constraints', {}))}
        
        Return a valid JSON object representing the schedule.
        Include 'schedule' (list of blocks with start, end, task_id/title) and 'reasoning'.
        """
        
        col1, col2 = st.columns(2)
        
        def call_model(model_name, prompt):
            start_time = time.time()
            try:
                response = litellm.completion(
                    model=model_name,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0,
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
                    "usage": response.usage
                }
            except Exception as e:
                return {"error": str(e), "latency": time.time() - start_time, "cost": 0}

        with col1:
            st.header(f"Model A: {model_a}")
            with st.spinner(f"Calling {model_a}..."):
                res_a = call_model(model_a, prompt)
            
            if "error" in res_a:
                st.error(res_a["error"])
            else:
                st.metric("Latency", f"{res_a['latency']:.2f}s")
                st.metric("Cost", f"${res_a['cost']:.6f}")
                try:
                    parsed_a = json.loads(res_a["content"])
                    st.json(parsed_a)
                except:
                    st.text(res_a["content"])
                
                with st.expander("Raw Response"):
                    st.write(res_a.get("usage", {}))

        with col2:
            st.header(f"Model B: {model_b}")
            with st.spinner(f"Calling {model_b}..."):
                res_b = call_model(model_b, prompt)
            
            if "error" in res_b:
                st.error(res_b["error"])
            else:
                st.metric("Latency", f"{res_b['latency']:.2f}s")
                st.metric("Cost", f"${res_b['cost']:.6f}")
                try:
                    parsed_b = json.loads(res_b["content"])
                    st.json(parsed_b)
                except:
                    st.text(res_b["content"])
                
                with st.expander("Raw Response"):
                    st.write(res_b.get("usage", {}))
else:
    st.info("Select a scenario from the sidebar to begin.")
