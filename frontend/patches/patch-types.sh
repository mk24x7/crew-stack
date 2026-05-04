#!/bin/sh
# Patch types.ts to add Ollama models and change defaults
TYPES_FILE="./src/types.ts"

# 1. Add Ollama models at the top of AVAILABLE_LLMS array (after the opening bracket)
sed -i "s|export const AVAILABLE_LLMS: LLMInfo\[\] = \[|export const AVAILABLE_LLMS: LLMInfo[] = [\n  // Ollama (Local - Free)\n  { value: 'ollama/qwen3.6:35b', label: 'Qwen 3.6 35B (Local)', provider: 'Ollama' },\n  { value: 'ollama/qwen3:14b', label: 'Qwen 3 14B (Local)', provider: 'Ollama' },\n  { value: 'ollama/qwen3:8b', label: 'Qwen 3 8B (Local)', provider: 'Ollama' },\n  { value: 'ollama/llama3.1:8b', label: 'Llama 3.1 8B (Local)', provider: 'Ollama' },\n  { value: 'ollama/deepseek-v4-pro:cloud', label: 'DeepSeek V4 Pro (Ollama Cloud)', provider: 'Ollama' },\n|" "$TYPES_FILE"

# 2. Change default agent LLM from gpt-4o to ollama/qwen3.6:35b
sed -i "s|llm: 'gpt-4o',|llm: 'ollama/qwen3.6:35b',|" "$TYPES_FILE"

# 3. Set manager LLM default to gpt-4o (for high-level orchestration tasks)
sed -i "s|managerLlm: '',|managerLlm: 'gpt-4o',|" "$TYPES_FILE"

# 4. Set planner LLM default to gpt-4o
sed -i "s|plannerLlm: '',|plannerLlm: 'gpt-4o',|" "$TYPES_FILE"

echo "types.ts patched: Ollama models added, defaults set"
