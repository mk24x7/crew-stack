import ast
import asyncio
import os
import shutil
import subprocess
import tempfile
import time
import textwrap
from typing import AsyncGenerator

ALLOWED_IMPORTS = {
    "crewai", "crewai_tools", "crewai.project",
    "pydantic", "typing", "os", "json", "yaml",
    "datetime", "pathlib", "re", "math",
}

BLOCKED_PATTERNS = [
    "__import__",
    "importlib",
    "subprocess",
    "shutil",
    "socket",
    "http.server",
    "xmlrpc",
    "ctypes",
    "multiprocessing",
    "signal",
]

ENV_PASSTHROUGH_KEYS = [
    "OPENAI_API_KEY",
    "OPENAI_API_BASE",
    "OPENAI_API_BASE_URL",
    "OPENAI_BASE_URL",
    "OPENAI_DEFAULT_MODEL_NAME",
    "ANTHROPIC_API_KEY",
    "SERPER_API_KEY",
    "BROWSERLESS_API_KEY",
    "GROQ_API_KEY",
    "GOOGLE_API_KEY",
    "MISTRAL_API_KEY",
    "XAI_API_KEY",
    "OPENROUTER_API_KEY",
    "OLLAMA_HOST",
    "HOME",
    "PATH",
    "LANG",
    "LC_ALL",
]


class ExecutionError(Exception):
    pass


def validate_python_code(code: str) -> None:
    """Parse and validate the generated Python code using AST analysis."""
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        raise ExecutionError(f"Syntax error in generated code: {e}")

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root_module = alias.name.split(".")[0]
                if alias.name in BLOCKED_PATTERNS or root_module in BLOCKED_PATTERNS:
                    raise ExecutionError(f"Blocked import: {alias.name}")

        elif isinstance(node, ast.ImportFrom):
            if node.module:
                root_module = node.module.split(".")[0]
                if node.module in BLOCKED_PATTERNS or root_module in BLOCKED_PATTERNS:
                    raise ExecutionError(f"Blocked import: {node.module}")

        elif isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name):
                if node.func.id in ("exec", "eval", "compile"):
                    raise ExecutionError(f"Blocked builtin call: {node.func.id}()")
            elif isinstance(node.func, ast.Attribute):
                if node.func.attr in ("system", "popen"):
                    raise ExecutionError(f"Blocked method call: .{node.func.attr}()")

        elif isinstance(node, ast.Constant) and isinstance(node.value, str):
            for pattern in BLOCKED_PATTERNS:
                if pattern in node.value and "__import__" in node.value:
                    raise ExecutionError(f"Blocked pattern in string: {pattern}")


def _build_runner_script(crew_filename: str, inputs: dict[str, str]) -> str:
    """Generate the runner script that imports and executes the crew."""
    inputs_repr = repr(inputs)
    return textwrap.dedent(f"""\
        import sys
        import importlib.util
        import json

        # Load the crew module
        spec = importlib.util.spec_from_file_location("crew_module", "{crew_filename}")
        mod = importlib.util.module_from_spec(spec)
        sys.modules["crew_module"] = mod
        spec.loader.exec_module(mod)

        # Find the class decorated with @CrewBase
        crew_class = None
        for name in dir(mod):
            obj = getattr(mod, name)
            if isinstance(obj, type) and hasattr(obj, "crew"):
                crew_class = obj
                break

        if crew_class is None:
            print("ERROR: No CrewBase class found in the module", file=sys.stderr)
            sys.exit(1)

        # Instantiate and run
        instance = crew_class()
        crew = instance.crew()
        inputs = {inputs_repr}
        result = crew.kickoff(inputs=inputs if inputs else {{}})

        # Output the result
        print("\\n=== CREW RESULT ===")
        print(str(result))
    """)


def _get_safe_env() -> dict[str, str]:
    """Build an environment dict with only approved keys."""
    env = {}
    for key in ENV_PASSTHROUGH_KEYS:
        val = os.environ.get(key)
        if val:
            env[key] = val
    return env


async def execute_crew(
    agents_yaml: str,
    tasks_yaml: str,
    python_code: str,
    inputs: dict[str, str],
    timeout: int = 300,
) -> dict:
    """Execute a crew definition and return the result."""
    validate_python_code(python_code)

    tmpdir = tempfile.mkdtemp(prefix="crew_exec_")
    try:
        # Write crew files
        config_dir = os.path.join(tmpdir, "config")
        os.makedirs(config_dir)

        with open(os.path.join(config_dir, "agents.yaml"), "w") as f:
            f.write(agents_yaml)
        with open(os.path.join(config_dir, "tasks.yaml"), "w") as f:
            f.write(tasks_yaml)
        with open(os.path.join(tmpdir, "crew.py"), "w") as f:
            f.write(python_code)

        runner_script = _build_runner_script("crew.py", inputs)
        with open(os.path.join(tmpdir, "run.py"), "w") as f:
            f.write(runner_script)

        start_time = time.time()
        proc = await asyncio.create_subprocess_exec(
            sys.executable if hasattr(sys, "executable") else "python3",
            "run.py",
            cwd=tmpdir,
            env=_get_safe_env(),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=timeout
            )
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise ExecutionError(
                f"Execution timed out after {timeout} seconds"
            )

        duration = time.time() - start_time

        stdout_text = stdout.decode("utf-8", errors="replace")
        stderr_text = stderr.decode("utf-8", errors="replace")

        if proc.returncode != 0:
            return {
                "status": "error",
                "output": stdout_text,
                "error": stderr_text,
                "duration_seconds": round(duration, 2),
                "task_outputs": {},
            }

        return {
            "status": "completed",
            "output": stdout_text,
            "error": "",
            "duration_seconds": round(duration, 2),
            "task_outputs": {},
        }

    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


async def execute_crew_stream(
    agents_yaml: str,
    tasks_yaml: str,
    python_code: str,
    inputs: dict[str, str],
    timeout: int = 300,
) -> AsyncGenerator[str, None]:
    """Execute a crew and yield output lines as they arrive."""
    validate_python_code(python_code)

    tmpdir = tempfile.mkdtemp(prefix="crew_exec_")
    try:
        config_dir = os.path.join(tmpdir, "config")
        os.makedirs(config_dir)

        with open(os.path.join(config_dir, "agents.yaml"), "w") as f:
            f.write(agents_yaml)
        with open(os.path.join(config_dir, "tasks.yaml"), "w") as f:
            f.write(tasks_yaml)
        with open(os.path.join(tmpdir, "crew.py"), "w") as f:
            f.write(python_code)

        runner_script = _build_runner_script("crew.py", inputs)
        with open(os.path.join(tmpdir, "run.py"), "w") as f:
            f.write(runner_script)

        start_time = time.time()

        import sys as _sys
        proc = await asyncio.create_subprocess_exec(
            _sys.executable if hasattr(_sys, "executable") else "python3",
            "-u", "run.py",
            cwd=tmpdir,
            env=_get_safe_env(),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        async def read_stream(stream, prefix=""):
            while True:
                line = await stream.readline()
                if not line:
                    break
                yield prefix + line.decode("utf-8", errors="replace").rstrip("\n")

        try:
            deadline = time.time() + timeout
            async for line in read_stream(proc.stdout):
                if time.time() > deadline:
                    proc.kill()
                    yield "[ERROR] Execution timed out"
                    break
                yield line

            async for line in read_stream(proc.stderr, prefix="[STDERR] "):
                yield line

            await proc.wait()
            duration = time.time() - start_time
            yield f"\n[Completed in {round(duration, 1)}s with exit code {proc.returncode}]"

        except Exception as e:
            proc.kill()
            yield f"[ERROR] {str(e)}"

    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


# Need sys for the executable path
import sys
