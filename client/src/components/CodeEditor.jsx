import { useState } from 'react';
import Editor from '@monaco-editor/react';
import './CodeEditor.css';

const defaultHandler = `'use strict'

module.exports = async (event, context) => {
  const result = {
    'body': JSON.stringify(event.body),
    'content-type': event.headers["content-type"]
  }

  return context
    .status(200)
    .succeed(result)
}`;

const defaultPackageJson = `{
  "name": "openfaas-function",
  "version": "1.0.0",
  "description": "OpenFaaS Function",
  "main": "handler.js",
  "scripts": {
    "test": "echo 'Skipping tests' && exit 0"
  },
  "keywords": [],
  "author": "OpenFaaS Ltd",
  "license": "MIT"
}`;

const CodeEditor = ({ functionName, setFunctionName }) => {
  const [activeTab, setActiveTab] = useState('handler');
  const [handlerCode, setHandlerCode] = useState(defaultHandler);
  const [packageJson, setPackageJson] = useState(defaultPackageJson);
  const [isDeploying, setIsDeploying] = useState(false);
  const [logs, setLogs] = useState([]);
  const [showLogs, setShowLogs] = useState(false);
  const lang = 'node20'; // Hard-coded language

  const handleDeploy = async () => {
    setIsDeploying(true);
    setShowLogs(true);
    setLogs([]);
    const startTime = performance.now();

    try {
      // First publish the function
      setLogs(prev => [...prev, 'Building function using OpenFaaS sandbox builder...']);
      
      const publishResponse = await fetch('/api/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          functionName,
          handler: handlerCode,
          lang,
          packageJson: JSON.parse(packageJson),
        }),
      });
      
      const publishResult = await publishResponse.json();
      
      if (!publishResult.success) {
        throw new Error(`Build failed: ${publishResult.error}`);
      }
      
      setLogs(prev => [...prev, `Published new version in ${publishResult.publishTime}s`]);
      
      // Then deploy the function
      setLogs(prev => [...prev, 'Deploying function to OpenFaaS gateway...']);
      
      const deployResponse = await fetch('/api/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          functionName,
          image: publishResult.image,
        }),
      });
      
      const deployResult = await deployResponse.json();
      
      if (!deployResponse.ok) {
        throw new Error(`Deployment failed: ${deployResult.error || 'Unknown error'}`);
      }
      
      setLogs(prev => [...prev, `Function deployed in ${deployResult.deployTime}s`]);
      
      // Calculate and add total time
      const totalTime = (parseFloat(publishResult.publishTime) + parseFloat(deployResult.deployTime)).toFixed(1);
      setLogs(prev => [...prev, `Total: ${totalTime}s`]);
      
      console.log('Deployment successful:', deployResult);
    } catch (error) {
      setLogs(prev => [...prev, `Error: ${error.message}`]);
      console.error('Deployment error:', error);
    } finally {
      setIsDeploying(false);
    }
  };

  return (
    <div className="code-editor">
      <div className="tabs">
        <button
          className={`tab-button ${activeTab === 'handler' ? 'active' : ''}`}
          onClick={() => setActiveTab('handler')}
        >
          Handler
        </button>
        <button
          className={`tab-button ${activeTab === 'package' ? 'active' : ''}`}
          onClick={() => setActiveTab('package')}
        >
          Package.json
        </button>
      </div>

      <input
        type="text"
        value={functionName}
        onChange={(e) => setFunctionName(e.target.value)}
        placeholder="Function name"
        className="function-name-input"
      />

      <div className="editor-container">
        <Editor
          height="400px"
          language={activeTab === 'handler' ? 'javascript' : 'json'}
          value={activeTab === 'handler' ? handlerCode : packageJson}
          onChange={activeTab === 'handler' ? setHandlerCode : setPackageJson}
          theme="vs-dark"
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            lineNumbers: 'on',
            roundedSelection: false,
            scrollBeyondLastLine: false,
            automaticLayout: true
          }}
        />
      </div>

      <button
        className="deploy-button"
        onClick={handleDeploy}
        disabled={isDeploying}
      >
        {isDeploying ? 'Deploying...' : 'Deploy Function'}
      </button>

      {showLogs && (
        <div className="logs-container">
          <pre>{logs.join('\n')}</pre>
        </div>
      )}
    </div>
  );
};

export default CodeEditor; 