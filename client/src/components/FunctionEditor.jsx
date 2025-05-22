import { useState, useEffect, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import './FunctionEditor.css';

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
  "license": "MIT",
  "dependencies": {}
}`;

const FunctionEditor = ({ functionName }) => {
  const [handlerCode, setHandlerCode] = useState(defaultHandler);
  const [packageJson, setPackageJson] = useState(defaultPackageJson);
  const [activeTab, setActiveTab] = useState('handler');
  const [isPublishing, setIsPublishing] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [publishStatus, setPublishStatus] = useState('');
  const [deployStatus, setDeployStatus] = useState('');
  const [publishError, setPublishError] = useState(null);
  const [deployError, setDeployError] = useState(null);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [currentImageTag, setCurrentImageTag] = useState(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isOperationInProgress, setIsOperationInProgress] = useState(false);
  const [operationTimeout, setOperationTimeout] = useState(null);
  const [operationStartTime, setOperationStartTime] = useState(null);

  // Add a useEffect to monitor currentImageTag changes
  useEffect(() => {
    console.log('currentImageTag changed to:', currentImageTag);
  }, [currentImageTag]);

  // Load saved code from localStorage on component mount or when functionName changes
  useEffect(() => {
    if (functionName) {
      const savedHandler = localStorage.getItem(`function_${functionName}_handler`);
      const savedPackage = localStorage.getItem(`function_${functionName}_package`);
      const savedImageTag = localStorage.getItem(`function_${functionName}_image`);
      
      if (savedHandler) {
        setHandlerCode(savedHandler);
      }
      
      if (savedPackage) {
        setPackageJson(savedPackage);
      }
      
      if (savedImageTag) {
        console.log('Loading saved image tag:', savedImageTag);
        setCurrentImageTag(savedImageTag);
      }
      
      // Reset unsaved changes flag when loading a new function
      setHasUnsavedChanges(false);
    }
  }, [functionName]);

  // Save code to localStorage when component unmounts or when functionName changes
  useEffect(() => {
    // Only save if there are unsaved changes
    if (functionName && hasUnsavedChanges) {
      localStorage.setItem(`function_${functionName}_handler`, handlerCode);
      localStorage.setItem(`function_${functionName}_package`, packageJson);
      setHasUnsavedChanges(false);
    }
    
    // Cleanup function to save when component unmounts
    return () => {
      if (functionName && hasUnsavedChanges) {
        localStorage.setItem(`function_${functionName}_handler`, handlerCode);
        localStorage.setItem(`function_${functionName}_package`, packageJson);
      }
    };
  }, [functionName, hasUnsavedChanges]);

  // Track changes to handler and package.json
  const handleHandlerChange = (value) => {
    setHandlerCode(value);
    setHasUnsavedChanges(true);
  };

  const handlePackageJsonChange = (value) => {
    setPackageJson(value);
    setHasUnsavedChanges(true);
  };

  // Function to cancel ongoing operation
  const cancelOperation = useCallback(() => {
    if (operationTimeout) {
      clearTimeout(operationTimeout);
      setOperationTimeout(null);
    }
    
    setIsPublishing(false);
    setIsDeploying(false);
    setIsOperationInProgress(false);
    setOperationStartTime(null);
    
    setPublishStatus('Operation cancelled');
    setDeployStatus('');
  }, [operationTimeout]);

  // Check for operation timeout
  useEffect(() => {
    if (isOperationInProgress && operationStartTime) {
      const elapsedTime = Date.now() - operationStartTime;
      
      // If operation takes more than 2 minutes, show a warning
      if (elapsedTime > 120000) {
        setPublishStatus(prev => prev + ' (Taking longer than expected...)');
      }
      
      // If operation takes more than 5 minutes, automatically cancel
      if (elapsedTime > 300000) {
        cancelOperation();
        setPublishError('Operation timed out after 5 minutes. Please try again.');
      }
    }
  }, [isOperationInProgress, operationStartTime, cancelOperation]);

  const handlePublish = async () => {
    // Clear any previous errors and status messages
    setPublishError(null);
    setDeployError(null);
    setPublishStatus('');
    setDeployStatus('');
    
    // Set operation in progress
    setIsPublishing(true);
    setIsOperationInProgress(true);
    setOperationStartTime(Date.now());
    
    try {
      // Validate function name
      if (functionName !== 'fn1') {
        throw new Error('Only fn1 is supported for this demo');
      }
      
      // Parse package.json to ensure it's valid JSON
      let parsedPackageJson;
      try {
        parsedPackageJson = JSON.parse(packageJson);
        // Ensure dependencies property exists
        if (!parsedPackageJson.dependencies) {
          parsedPackageJson.dependencies = {};
        }
      } catch (error) {
        throw new Error(`Invalid package.json: ${error.message}`);
      }
      
      // Send the function code and package.json to the server
      const response = await fetch('/api/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          functionName,
          handler: handlerCode,
          lang: 'node20',
          packageJson: parsedPackageJson
        }),
      });
      
      const result = await response.json();
      
      if (!result.success) {
        // Format error message for better readability
        let errorMessage = result.error || 'Unknown error occurred';
        
        // Extract npm error messages if present
        if (errorMessage.includes('npm')) {
          const npmErrorMatch = errorMessage.match(/npm ERR!.*/g);
          if (npmErrorMatch) {
            errorMessage = 'npm error:\n' + npmErrorMatch.join('\n');
          }
        }
        
        throw new Error(errorMessage);
      }
      
      // Store the image tag for deployment
      setCurrentImageTag(result.image);
      
      // Show success message with publish time
      setPublishStatus(`Published successfully in ${result.publishTime}s. Image: ${result.image}`);
      
      // Auto-deploy after successful publish
      const timeoutId = setTimeout(() => {
        handleDeploy(result.image);
      }, 1000);
      
      setOperationTimeout(timeoutId);
      
    } catch (error) {
      console.error('Publish error:', error);
      setPublishError(error.message);
      setIsPublishing(false);
      setIsOperationInProgress(false);
      setOperationStartTime(null);
    }
  };

  const handleDeploy = async (imageTag = null) => {
    // Clear deploy-related messages only
    setDeployError(null);
    setDeployStatus('');
    
    // Set deploying state
    setIsDeploying(true);
    
    try {
      // Use the provided image tag or fall back to the current one
      const tagToUse = imageTag || currentImageTag;
      
      if (!tagToUse) {
        throw new Error('No image tag provided for deployment');
      }
      
      console.log('Deploying with currentImageTag:', tagToUse);
      
      // Send the deployment request
      const response = await fetch('/api/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          functionName,
          image: tagToUse
        }),
      });
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Unknown error occurred during deployment');
      }
      
      // Show success message with deploy time
      setDeployStatus(`Deployed successfully in ${result.deployTime}s`);
      
      // Clear operation in progress state
      setIsPublishing(false);
      setIsDeploying(false);
      setIsOperationInProgress(false);
      setOperationStartTime(null);
      
      if (operationTimeout) {
        clearTimeout(operationTimeout);
        setOperationTimeout(null);
      }
      
    } catch (error) {
      console.error('Deploy error:', error);
      setDeployError(error.message);
      setIsDeploying(false);
      setIsOperationInProgress(false);
      setOperationStartTime(null);
      
      if (operationTimeout) {
        clearTimeout(operationTimeout);
        setOperationTimeout(null);
      }
    }
  };

  const resetToDefaults = () => {
    if (window.confirm('Are you sure you want to reset to default code? This will discard your changes.')) {
      setHandlerCode(defaultHandler);
      setPackageJson(defaultPackageJson);
      localStorage.removeItem(`function_${functionName}_handler`);
      localStorage.removeItem(`function_${functionName}_package`);
    }
  };

  return (
    <div className="function-editor">
      <div className="editor-description">
        Write your function logic in <code>handler.js</code> and specify npm modules in <code>packages.json</code>.
      </div>
      
      <div className="tabs">
        <button
          className={`tab-button ${activeTab === 'handler' ? 'active' : ''}`}
          onClick={() => setActiveTab('handler')}
        >
          handler.js
        </button>
        <button
          className={`tab-button ${activeTab === 'package' ? 'active' : ''}`}
          onClick={() => setActiveTab('package')}
        >
          packages.json
        </button>
      </div>
      
      <div className="editor-container">
        {activeTab === 'handler' ? (
          <Editor
            height="400px"
            language="javascript"
            value={handlerCode}
            onChange={handleHandlerChange}
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
        ) : (
          <Editor
            height="400px"
            language="json"
            value={packageJson}
            onChange={handlePackageJsonChange}
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
        )}
      </div>
      
      <div className="editor-actions">
        <div className="action-buttons">
          <button 
            className="publish-button" 
            onClick={handlePublish}
            disabled={isOperationInProgress}
          >
            {isOperationInProgress ? (
              <>
                <span className="spinner"></span>
                {isPublishing ? 'Publishing...' : 'Deploying...'}
              </>
            ) : (
              'Publish & Deploy'
            )}
          </button>
          
          {isOperationInProgress && (
            <button 
              className="cancel-button" 
              onClick={cancelOperation}
            >
              Cancel
            </button>
          )}
          
          <button 
            className="reset-button" 
            onClick={resetToDefaults}
            disabled={isOperationInProgress}
          >
            Reset to Template
          </button>
        </div>
        
        {hasUnsavedChanges && (
          <div className="unsaved-changes">
            <span className="unsaved-icon">●</span> Unsaved changes
          </div>
        )}
      </div>
      
      {(publishStatus || deployStatus) && (
        <div className="status-container">
          {publishStatus && (
            <div className={`status-message ${publishError ? 'error' : 'success'}`}>
              <span className="status-icon">{publishError ? '✕' : '✓'}</span>
              {publishStatus}
            </div>
          )}
          
          {deployStatus && (
            <div className={`status-message ${deployError ? 'error' : 'success'}`}>
              <span className="status-icon">{deployError ? '✕' : '✓'}</span>
              {deployStatus}
            </div>
          )}
        </div>
      )}
      
      {/* Error display box */}
      {(publishError || deployError) && (
        <div className="error-box">
          <div className="error-header">
            <span className="error-icon">⚠️</span>
            <span className="error-title">Error Details</span>
          </div>
          <div className="error-content">
            <pre>{publishError || deployError}</pre>
          </div>
        </div>
      )}
      
      {showErrorModal && (
        <div className="error-modal">
          <div className="error-modal-content">
            <h3>Error Details</h3>
            <pre>{errorMessage}</pre>
            <button 
              className="close-modal-button"
              onClick={() => setShowErrorModal(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default FunctionEditor;