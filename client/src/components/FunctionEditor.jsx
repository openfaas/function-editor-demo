import { useEffect, useMemo, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import './FunctionEditor.css';
import { apiFetch } from '../api';

const storageKey = (functionName) => `function_${functionName}_workspace`;

const calculateSourceHash = async (templateId, files) => {
  const source = JSON.stringify({
    templateId,
    files: files
      .map(({ name, content }) => ({ name, content }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const FunctionEditor = ({ functionName, onNavigateTest }) => {
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('node24');
  const [files, setFiles] = useState([]);
  const [activeFile, setActiveFile] = useState('');
  const [currentHash, setCurrentHash] = useState('');
  const [deployedHash, setDeployedHash] = useState(null);
  const [isCheckingDeployment, setIsCheckingDeployment] = useState(true);
  const [isDeploying, setIsDeploying] = useState(false);
  const [build, setBuild] = useState(null);
  const [isConsoleOpen, setIsConsoleOpen] = useState(false);
  const consoleOutput = useRef(null);

  const template = useMemo(
    () => templates.find((candidate) => candidate.id === templateId),
    [templates, templateId],
  );
  const currentFile = files.find((file) => file.name === activeFile) || files[0];

  useEffect(() => {
    if (isConsoleOpen && consoleOutput.current) {
      consoleOutput.current.scrollTop = consoleOutput.current.scrollHeight;
    }
  }, [build?.logs, build?.error, isConsoleOpen]);

  const updateBuild = (nextBuild) => {
    setBuild(nextBuild);
  };

  useEffect(() => {
    apiFetch('/api/templates')
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json()).error || 'Unable to load templates');
        return response.json();
      })
      .then(({ templates: availableTemplates }) => {
        setTemplates(availableTemplates);
        const key = storageKey(functionName);
        let saved = null;

        try {
          saved = JSON.parse(localStorage.getItem(key) || 'null');
        } catch {
          localStorage.removeItem(key);
        }

        const selected = availableTemplates.find((item) => item.id === saved?.templateId)
          || availableTemplates[0];
        setTemplateId(selected.id);
        setFiles(saved?.templateId === selected.id && saved.files?.length ? saved.files : selected.files);
        setActiveFile(
          saved?.templateId === selected.id && saved.activeFile
            ? saved.activeFile
            : selected.files[0].name,
        );
      })
      .catch((error) => {
        updateBuild({
          id: `load-${Date.now()}`,
          status: 'failed',
          title: 'Unable to load templates',
          error: error.message,
          logs: [],
          startedAt: new Date().toISOString(),
        });
      });
  }, [functionName]);

  useEffect(() => {
    if (!templateId || files.length === 0) return;
    localStorage.setItem(storageKey(functionName), JSON.stringify({
      templateId,
      files,
      activeFile,
    }));
  }, [activeFile, files, functionName, templateId]);

  useEffect(() => {
    if (!templateId || files.length === 0) return;
    let cancelled = false;
    calculateSourceHash(templateId, files).then((hash) => {
      if (!cancelled) setCurrentHash(hash);
    });
    return () => { cancelled = true; };
  }, [files, templateId]);

  useEffect(() => {
    let cancelled = false;
    setIsCheckingDeployment(true);
    apiFetch(`/api/functions/${encodeURIComponent(functionName)}/deployment-hash`)
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json()).error || 'Unable to check deployment');
        return response.json();
      })
      .then(({ hash }) => {
        if (!cancelled) setDeployedHash(hash);
      })
      .catch(() => {
        if (!cancelled) setDeployedHash(null);
      })
      .finally(() => {
        if (!cancelled) setIsCheckingDeployment(false);
      });
    return () => { cancelled = true; };
  }, [functionName]);

  const switchTemplate = (nextTemplateId) => {
    if (nextTemplateId === templateId) return;
    const nextTemplate = templates.find((item) => item.id === nextTemplateId);
    if (!nextTemplate) return;
    if (!window.confirm(`Switch to ${nextTemplate.label}? This replaces the current function source.`)) {
      return;
    }
    setTemplateId(nextTemplate.id);
    setFiles(nextTemplate.files);
    setActiveFile(nextTemplate.files[0].name);
    setBuild(null);
  };

  const updateFile = (content) => {
    setFiles((current) => current.map((file) => (
      file.name === currentFile.name ? { ...file, content: content ?? '' } : file
    )));
  };

  const deploy = async () => {
    const sourceHash = await calculateSourceHash(templateId, files);
    const buildId = `build-${Date.now()}`;
    const startedAt = new Date().toISOString();
    let nextBuild = {
      id: buildId,
      status: 'in_progress',
      title: `Building ${functionName}`,
      template: template?.label,
      logs: [],
      startedAt,
    };
    updateBuild(nextBuild);
    setIsDeploying(true);
    setIsConsoleOpen(true);

    try {
      const response = await apiFetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ functionName, lang: templateId, files }),
      });
      if (!response.ok || !response.body) throw new Error(`Build request failed with HTTP ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let image = '';
      let failed = '';

      const consume = (line) => {
        if (!line.trim()) return;
        const event = JSON.parse(line);
        const logs = event.log || [];
        image = event.image || image;
        failed = event.error || failed;
        nextBuild = {
          ...nextBuild,
          status: event.status || nextBuild.status,
          image,
          error: failed,
          publishTime: event.publishTime || nextBuild.publishTime,
          logs: [...nextBuild.logs, ...logs],
        };
        updateBuild(nextBuild);
      };

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        lines.forEach(consume);
        if (done) break;
      }
      consume(buffer);

      if (nextBuild.status !== 'success' || !image) {
        throw new Error(failed || 'The build did not complete successfully');
      }

      nextBuild = { ...nextBuild, status: 'deploying', logs: [...nextBuild.logs, 'Deploying function to OpenFaaS'] };
      updateBuild(nextBuild);
      const deployResponse = await apiFetch('/api/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ functionName, image, sourceHash }),
      });
      const deployResult = await deployResponse.json();
      if (!deployResponse.ok || !deployResult.success) {
        throw new Error(deployResult.error || 'Unable to deploy the function');
      }

      nextBuild = {
        ...nextBuild,
        status: 'success',
        completedAt: new Date().toISOString(),
        logs: [...nextBuild.logs, 'Function deployed successfully'],
      };
      updateBuild(nextBuild);
      setDeployedHash(sourceHash);
      setCurrentHash(sourceHash);
    } catch (error) {
      updateBuild({
        ...nextBuild,
        status: 'failed',
        error: error.message,
        completedAt: new Date().toISOString(),
      });
    } finally {
      setIsDeploying(false);
    }
  };

  if (!template || !currentFile) {
    return <div className="editor-loading"><span className="spinner"></span>Loading templates…</div>;
  }

  return (
    <div className="function-editor">
      <div className="editor-toolbar">
        <label className="template-picker">
          <span>Template</span>
          <select value={templateId} onChange={(event) => switchTemplate(event.target.value)} disabled={isDeploying}>
            {templates.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <div className="editor-toolbar-actions">
          <div className="editor-state" aria-live="polite">
            {build?.status === 'in_progress'
              ? <span className="deployment-indicator working">Building image…</span>
              : build?.status === 'deploying'
                ? <span className="deployment-indicator working">Deploying function…</span>
                : build?.status === 'failed'
                  ? <span className="deployment-indicator failed">Deployment failed</span>
                  : isCheckingDeployment || !currentHash
                    ? <span className="deployment-indicator checking">Checking deployment…</span>
                    : currentHash === deployedHash
                      ? <span className="deployment-indicator deployed">Deployed</span>
                      : <span className="deployment-indicator undeployed">Undeployed changes</span>}
          </div>
          <button
            className="publish-button"
            onClick={deploy}
            disabled={isDeploying || isCheckingDeployment || !currentHash || currentHash === deployedHash}
          >
            {isDeploying ? 'Deploying…' : 'Deploy'}
          </button>
        </div>
      </div>

      {build?.status === 'failed' && (
        <div className="deploy-error-detail" role="alert">{build.error}</div>
      )}

      <div className="file-tabs" role="tablist" aria-label="Function source files">
        {files.map((file) => (
          <button
            key={file.name}
            role="tab"
            aria-selected={currentFile.name === file.name}
            className={currentFile.name === file.name ? 'active' : ''}
            onClick={() => setActiveFile(file.name)}
          >
            {file.name}
          </button>
        ))}
      </div>

      <div className={`editor-stage ${isConsoleOpen ? 'console-open' : ''}`}>
        <div className="editor-workbench">
          <div className="editor-container">
            <Editor
              height="100%"
              language={currentFile.language}
              value={currentFile.content}
              onChange={updateFile}
              theme="light"
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                lineNumbers: 'on',
                wordWrap: 'on',
                wrappingIndent: 'indent',
                roundedSelection: false,
                scrollBeyondLastLine: false,
                automaticLayout: true,
              }}
            />
          </div>
        </div>
        <section className={`build-console ${isConsoleOpen ? 'expanded' : 'collapsed'}`} aria-label="Build output">
          <button
            className="build-console-toggle"
            onClick={() => setIsConsoleOpen((open) => !open)}
            aria-expanded={isConsoleOpen}
          >
            <span>Build output</span>
            <strong>
              {build?.status === 'in_progress'
                ? 'Building'
                : build?.status === 'deploying'
                  ? 'Deploying'
                  : build?.status || 'Idle'}
            </strong>
            <i aria-hidden="true">{isConsoleOpen ? '⌄' : '⌃'}</i>
          </button>
          <pre ref={consoleOutput} aria-live="polite">
            {build?.logs.length ? build.logs.join('\n') : 'No build output yet.'}
            {build?.error ? `\n\nError: ${build.error}` : ''}
          </pre>
          {build?.status === 'success' && (
            <footer>
              <button className="test-page-link" onClick={onNavigateTest}>
                Test function <span aria-hidden="true">→</span>
              </button>
            </footer>
          )}
        </section>
      </div>
    </div>
  );
};

export default FunctionEditor;
