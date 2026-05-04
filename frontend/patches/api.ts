const API_BASE = import.meta.env.VITE_API_URL || '/api';

export interface ExecutionResult {
  status: 'completed' | 'error';
  output: string;
  error: string;
  duration_seconds: number;
  task_outputs: Record<string, string>;
}

export async function executeCrewOnServer(
  agentsYaml: string,
  tasksYaml: string,
  pythonCode: string,
  inputs: Record<string, string> = {},
): Promise<ExecutionResult> {
  const response = await fetch(`${API_BASE}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agents_yaml: agentsYaml,
      tasks_yaml: tasksYaml,
      python_code: pythonCode,
      inputs,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Server error (${response.status}): ${detail}`);
  }

  return response.json();
}

export function executeCrewStream(
  agentsYaml: string,
  tasksYaml: string,
  pythonCode: string,
  inputs: Record<string, string> = {},
  onOutput: (line: string) => void,
  onDone: () => void,
  onError: (error: string) => void,
): () => void {
  const abortController = new AbortController();

  (async () => {
    try {
      const response = await fetch(`${API_BASE}/execute/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agents_yaml: agentsYaml,
          tasks_yaml: tasksYaml,
          python_code: pythonCode,
          inputs,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const detail = await response.text();
        onError(`Server error (${response.status}): ${detail}`);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        onError('No response body');
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            onOutput(data);
          }
          if (line.startsWith('event: done')) {
            onDone();
            return;
          }
          if (line.startsWith('event: error')) {
            // Next data line will have the error
          }
        }
      }

      onDone();
    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError') {
        onError((err as Error).message || 'Unknown error');
      }
    }
  })();

  return () => abortController.abort();
}
