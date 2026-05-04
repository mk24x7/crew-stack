import { useState, useRef, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box,
  Typography, Tabs, Tab, IconButton, Tooltip, Snackbar, Alert,
  TextField, CircularProgress,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DownloadIcon from '@mui/icons-material/Download';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import { COLORS } from '../../theme';
import { executeCrewStream } from '../../utils/api';

interface ExportModalProps {
  open: boolean;
  onClose: () => void;
  agentsYaml: string;
  tasksYaml: string;
  pythonCode: string;
  mode: 'yaml' | 'python';
}

function CodeBlock({ content, filename }: { content: string; filename: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
  };

  const handleDownload = () => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Box sx={{ position: 'relative' }}>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          px: 1.5,
          py: 0.5,
          bgcolor: `${COLORS.surface.elevated}80`,
          borderRadius: '8px 8px 0 0',
          border: `1px solid ${COLORS.surface.border}`,
          borderBottom: 'none',
        }}
      >
        <Typography variant="caption" sx={{ color: COLORS.text.muted, fontFamily: 'monospace', fontSize: '0.7rem' }}>
          {filename}
        </Typography>
        <Box>
          <Tooltip title="Copy to clipboard">
            <IconButton size="small" onClick={handleCopy} aria-label={`Copy ${filename} to clipboard`}>
              <ContentCopyIcon sx={{ fontSize: 14, color: COLORS.text.muted }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Download file">
            <IconButton size="small" onClick={handleDownload} aria-label={`Download ${filename}`}>
              <DownloadIcon sx={{ fontSize: 14, color: COLORS.text.muted }} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
      <Box
        component="pre"
        sx={{
          m: 0,
          p: 2,
          bgcolor: COLORS.surface.bg,
          border: `1px solid ${COLORS.surface.border}`,
          borderRadius: '0 0 8px 8px',
          overflow: 'auto',
          maxHeight: 400,
          fontFamily: '"JetBrains Mono", "Fira Code", "Consolas", monospace',
          fontSize: '0.75rem',
          lineHeight: 1.6,
          color: COLORS.text.primary,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          '&::-webkit-scrollbar': { width: 4, height: 4 },
          '&::-webkit-scrollbar-thumb': {
            background: COLORS.surface.elevated,
            borderRadius: 2,
          },
        }}
      >
        {content}
      </Box>
      <Snackbar
        open={copied}
        autoHideDuration={2000}
        onClose={() => setCopied(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" sx={{ fontSize: '0.8rem' }}>
          Copied to clipboard
        </Alert>
      </Snackbar>
    </Box>
  );
}

function extractInputVariables(code: string): string[] {
  const matches = code.match(/\{(\w+)\}/g);
  if (!matches) return [];
  const unique = [...new Set(matches.map(m => m.slice(1, -1)))];
  // Filter out common Python format patterns that aren't crew inputs
  return unique.filter(v => !['self', 'topic', '0', '1', '2'].includes(v) && !/^\d+$/.test(v));
}

export default function ExportModal({
  open,
  onClose,
  agentsYaml,
  tasksYaml,
  pythonCode,
  mode,
}: ExportModalProps) {
  const [activeTab, setActiveTab] = useState(mode === 'yaml' ? 0 : 2);
  const [yamlTab, setYamlTab] = useState(0);

  // Execution state
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionOutput, setExecutionOutput] = useState<string[]>([]);
  const [executionError, setExecutionError] = useState('');
  const [showExecuteTab, setShowExecuteTab] = useState(false);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const cancelRef = useRef<(() => void) | null>(null);
  const outputEndRef = useRef<HTMLDivElement>(null);

  const inputVars = extractInputVariables(agentsYaml + tasksYaml);

  const handleExecute = useCallback(() => {
    setIsExecuting(true);
    setExecutionOutput([]);
    setExecutionError('');
    setShowExecuteTab(true);
    setActiveTab(3);

    const cancel = executeCrewStream(
      agentsYaml,
      tasksYaml,
      pythonCode,
      inputs,
      (line) => {
        setExecutionOutput(prev => [...prev, line]);
        outputEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      },
      () => {
        setIsExecuting(false);
      },
      (error) => {
        setExecutionError(error);
        setIsExecuting(false);
      },
    );

    cancelRef.current = cancel;
  }, [agentsYaml, tasksYaml, pythonCode, inputs]);

  const handleCancel = () => {
    if (cancelRef.current) {
      cancelRef.current();
      cancelRef.current = null;
    }
    setIsExecuting(false);
    setExecutionOutput(prev => [...prev, '\n[Cancelled by user]']);
  };

  const handleDownloadAll = () => {
    const files = activeTab <= 1
      ? [
          { name: 'agents.yaml', content: agentsYaml },
          { name: 'tasks.yaml', content: tasksYaml },
        ]
      : [{ name: 'crew.py', content: pythonCode }];

    files.forEach(({ name, content }) => {
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      aria-labelledby="export-dialog-title"
    >
      <DialogTitle
        id="export-dialog-title"
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          pb: 0,
        }}
      >
        <Typography variant="h6" sx={{ fontSize: '1rem', fontWeight: 600 }}>
          Export & Execute Crew
        </Typography>
        <IconButton onClick={onClose} size="small" aria-label="Close export dialog">
          <CloseIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </DialogTitle>

      <Box sx={{ px: 3, borderBottom: `1px solid ${COLORS.surface.border}` }}>
        <Tabs
          value={activeTab}
          onChange={(_e, v) => setActiveTab(v)}
          aria-label="Export format tabs"
          sx={{
            minHeight: 36,
            '& .MuiTab-root': { minHeight: 36, fontSize: '0.8rem', textTransform: 'none' },
          }}
        >
          <Tab label="YAML Config" value={0} />
          <Tab label="Python Code" value={2} />
          {showExecuteTab && <Tab label="Execution Output" value={3} />}
        </Tabs>
      </Box>

      <DialogContent sx={{ pt: 2 }}>
        {activeTab === 0 && (
          <Box>
            <Tabs
              value={yamlTab}
              onChange={(_e, v) => setYamlTab(v)}
              aria-label="YAML file tabs"
              sx={{
                mb: 2,
                minHeight: 28,
                '& .MuiTab-root': {
                  minHeight: 28,
                  fontSize: '0.7rem',
                  textTransform: 'none',
                  px: 1.5,
                  py: 0.5,
                },
              }}
            >
              <Tab label="agents.yaml" />
              <Tab label="tasks.yaml" />
            </Tabs>
            {yamlTab === 0 && <CodeBlock content={agentsYaml} filename="agents.yaml" />}
            {yamlTab === 1 && <CodeBlock content={tasksYaml} filename="tasks.yaml" />}
          </Box>
        )}

        {activeTab === 2 && (
          <CodeBlock content={pythonCode} filename="crew.py" />
        )}

        {activeTab === 3 && (
          <Box>
            {inputVars.length > 0 && !isExecuting && executionOutput.length === 0 && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" sx={{ color: COLORS.text.muted, mb: 1, display: 'block' }}>
                  Crew Input Variables
                </Typography>
                {inputVars.map(v => (
                  <TextField
                    key={v}
                    label={v}
                    size="small"
                    fullWidth
                    sx={{ mb: 1 }}
                    value={inputs[v] || ''}
                    onChange={(e) => setInputs(prev => ({ ...prev, [v]: e.target.value }))}
                  />
                ))}
              </Box>
            )}

            <Box
              sx={{
                bgcolor: '#0d1117',
                border: `1px solid ${COLORS.surface.border}`,
                borderRadius: '8px',
                p: 2,
                minHeight: 200,
                maxHeight: 400,
                overflow: 'auto',
                fontFamily: '"JetBrains Mono", "Fira Code", "Consolas", monospace',
                fontSize: '0.73rem',
                lineHeight: 1.7,
                color: '#c9d1d9',
                '&::-webkit-scrollbar': { width: 4 },
                '&::-webkit-scrollbar-thumb': { background: '#30363d', borderRadius: 2 },
              }}
            >
              {executionOutput.length === 0 && !isExecuting && !executionError && (
                <Typography variant="caption" sx={{ color: '#8b949e' }}>
                  Click "Execute on Server" to run this crew...
                </Typography>
              )}
              {isExecuting && executionOutput.length === 0 && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CircularProgress size={14} sx={{ color: '#58a6ff' }} />
                  <Typography variant="caption" sx={{ color: '#8b949e' }}>
                    Starting crew execution...
                  </Typography>
                </Box>
              )}
              {executionOutput.map((line, i) => (
                <div key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {line}
                </div>
              ))}
              {executionError && (
                <div style={{ color: '#f85149', marginTop: 8 }}>
                  Error: {executionError}
                </div>
              )}
              {isExecuting && executionOutput.length > 0 && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                  <CircularProgress size={12} sx={{ color: '#58a6ff' }} />
                  <span style={{ color: '#8b949e', fontSize: '0.7rem' }}>Running...</span>
                </Box>
              )}
              <div ref={outputEndRef} />
            </Box>
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
        {activeTab !== 3 && (
          <Button
            onClick={handleDownloadAll}
            variant="contained"
            size="small"
            startIcon={<DownloadIcon sx={{ fontSize: 16 }} />}
            aria-label="Download all files"
          >
            Download {activeTab === 0 ? 'YAML Files' : 'Python File'}
          </Button>
        )}
        {!isExecuting ? (
          <Button
            onClick={handleExecute}
            variant="contained"
            size="small"
            color="success"
            startIcon={<PlayArrowIcon sx={{ fontSize: 16 }} />}
            aria-label="Execute crew on server"
          >
            Execute on Server
          </Button>
        ) : (
          <Button
            onClick={handleCancel}
            variant="outlined"
            size="small"
            color="error"
            startIcon={<StopIcon sx={{ fontSize: 16 }} />}
            aria-label="Cancel execution"
          >
            Cancel
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
