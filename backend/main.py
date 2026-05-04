import asyncio
import os

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sse_starlette.sse import EventSourceResponse

from schemas import CrewExecutionRequest, CrewExecutionResponse
from executor import execute_crew, execute_crew_stream, ExecutionError

app = FastAPI(
    title="CrewAI Execution Backend",
    version="1.0.0",
    docs_url="/docs",
    redoc_url=None,
)

# CORS - primarily as fallback since nginx handles same-origin proxying
allowed_origins = os.environ.get("CORS_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Concurrency limiter
MAX_CONCURRENT = int(os.environ.get("MAX_CONCURRENT", "3"))
EXECUTION_TIMEOUT = int(os.environ.get("EXECUTION_TIMEOUT", "300"))
_semaphore = asyncio.Semaphore(MAX_CONCURRENT)


OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://host.docker.internal:11434")


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/models")
async def list_models():
    """List available Ollama models and flag OpenAI availability."""
    ollama_models = []
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{OLLAMA_HOST}/api/tags")
            if resp.status_code == 200:
                data = resp.json()
                for m in data.get("models", []):
                    name = m.get("name", "")
                    size = m.get("details", {}).get("parameter_size", "")
                    ollama_models.append({
                        "id": f"ollama/{name}",
                        "name": name,
                        "provider": "ollama",
                        "parameter_size": size,
                    })
    except Exception:
        pass

    openai_available = bool(os.environ.get("OPENAI_API_KEY", "").startswith("sk-"))

    return {
        "ollama_models": ollama_models,
        "openai_available": openai_available,
        "ollama_reachable": len(ollama_models) > 0,
    }


@app.post("/execute", response_model=CrewExecutionResponse)
async def execute(req: CrewExecutionRequest):
    acquired = _semaphore._value > 0
    if not acquired:
        raise HTTPException(
            status_code=429,
            detail=f"Max concurrent executions ({MAX_CONCURRENT}) reached. Try again later.",
        )

    async with _semaphore:
        try:
            result = await execute_crew(
                agents_yaml=req.agents_yaml,
                tasks_yaml=req.tasks_yaml,
                python_code=req.python_code,
                inputs=req.inputs,
                timeout=EXECUTION_TIMEOUT,
            )
            return CrewExecutionResponse(**result)
        except ExecutionError as e:
            return CrewExecutionResponse(
                status="error",
                error=str(e),
            )
        except Exception as e:
            return CrewExecutionResponse(
                status="error",
                error=f"Unexpected error: {str(e)}",
            )


@app.post("/execute/stream")
async def execute_stream(req: CrewExecutionRequest):
    acquired = _semaphore._value > 0
    if not acquired:
        raise HTTPException(
            status_code=429,
            detail=f"Max concurrent executions ({MAX_CONCURRENT}) reached. Try again later.",
        )

    async def event_generator():
        async with _semaphore:
            try:
                async for line in execute_crew_stream(
                    agents_yaml=req.agents_yaml,
                    tasks_yaml=req.tasks_yaml,
                    python_code=req.python_code,
                    inputs=req.inputs,
                    timeout=EXECUTION_TIMEOUT,
                ):
                    yield {"event": "output", "data": line}
                yield {"event": "done", "data": ""}
            except ExecutionError as e:
                yield {"event": "error", "data": str(e)}
            except Exception as e:
                yield {"event": "error", "data": f"Unexpected error: {str(e)}"}

    return EventSourceResponse(event_generator())
