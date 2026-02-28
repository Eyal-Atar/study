import os
import asyncio
import anthropic
from dotenv import load_dotenv

# Load from .env if it exists
load_dotenv()

async def list_anthropic_models():
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("ANTHROPIC_API_KEY not found in environment.")
        return

    client = anthropic.AsyncAnthropic(api_key=api_key)
    
    print("Attempting to list models using client.models.list()...")
    try:
        models_response = await client.models.list()
        print("Models available:")
        for model in models_response.data:
            print(f"  - {model.id} (Created: {model.created_at})")
    except Exception as e:
        print(f"  FAILED to list models: {type(e).__name__}: {e}")

if __name__ == "__main__":
    asyncio.run(list_anthropic_models())
