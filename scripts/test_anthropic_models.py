import os
import asyncio
import anthropic
from dotenv import load_dotenv

# Load from .env if it exists
load_dotenv()

async def test_anthropic():
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("ANTHROPIC_API_KEY not found in environment.")
        return

    client = anthropic.AsyncAnthropic(api_key=api_key)
    
    models_to_test = [
        "claude-3-5-sonnet-latest",
        "claude-3-5-sonnet-20241022",
        "claude-3-5-sonnet-20240620",
        "claude-3-5-haiku-latest",
        "claude-3-opus-20240229",
        "claude-3-sonnet-20240229",
        "claude-3-haiku-20240307"
    ]

    for model in models_to_test:
        print(f"Testing model: {model}...")
        try:
            message = await client.messages.create(
                model=model,
                max_tokens=10,
                messages=[
                    {"role": "user", "content": "Hello, are you there?"}
                ]
            )
            print(f"  SUCCESS: {model}")
            # print(f"  Response: {message.content[0].text}")
        except anthropic.NotFoundError as e:
            print(f"  FAILED (404 Not Found): {model}")
            # print(f"  Error details: {e}")
        except Exception as e:
            print(f"  FAILED (Other error): {model}")
            print(f"  Error type: {type(e).__name__}")
            print(f"  Error details: {e}")

if __name__ == "__main__":
    asyncio.run(test_anthropic())
