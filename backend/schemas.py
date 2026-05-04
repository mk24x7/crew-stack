from pydantic import BaseModel, Field


class CrewExecutionRequest(BaseModel):
    agents_yaml: str = Field(..., description="Contents of agents.yaml")
    tasks_yaml: str = Field(..., description="Contents of tasks.yaml")
    python_code: str = Field(..., description="Contents of crew.py")
    inputs: dict[str, str] = Field(default_factory=dict, description="Input variables for the crew")


class CrewExecutionResponse(BaseModel):
    status: str = Field(..., description="completed or error")
    output: str = Field("", description="Final crew output")
    error: str = Field("", description="Error message if failed")
    duration_seconds: float = Field(0.0, description="Execution duration")
    task_outputs: dict[str, str] = Field(default_factory=dict, description="Per-task outputs")
