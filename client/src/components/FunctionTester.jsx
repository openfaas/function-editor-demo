import { useState, useEffect, useCallback, useRef } from 'react';
import Editor from '@monaco-editor/react';
import './FunctionTester.css';

const defaultPayload = `{
  "name": "John Doe",
  "age": 30,
  "email": "john@example.com"
}`;

const FunctionTester = ({ functionName }) => {
  const [payload, setPayload] = useState(defaultPayload);
  const [response, setResponse] = useState(null);
  const [responseText, setResponseText] = useState('');
  const [responseContentType, setResponseContentType] = useState('plaintext');
  const [contentLength, setContentLength] = useState(0);
  const [isInvoking, setIsInvoking] = useState(false);
  const [error, setError] = useState(null);
  const [invocationTime, setInvocationTime] = useState(null);
  const [statusCode, setStatusCode] = useState(null);
  const [headers, setHeaders] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [activeTab, setActiveTab] = useState('payload');
  const [logs, setLogs] = useState('No logs available');
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [logsError, setLogsError] = useState(null);
  const [editorKey, setEditorKey] = useState(0);
  const [isEditorMounted, setIsEditorMounted] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Debounced fetch logs function
  const fetchLogs = useCallback(async () => {
    setIsLoadingLogs(true);
    setLogsError(null);
    
    try {
      const response = await fetch('/api/logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ functionName }),
      });
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch logs');
      }
      
      // Log the number of lines and the last line for debugging
      const logLines = result.logs.split('\n').filter(line => line.trim());
      console.log(`Fetched ${logLines.length} log lines`);
      
      if (logLines.length > 0) {
        console.log('Last log line:', logLines[logLines.length - 1]);
      } else {
        console.log('No log lines found');
      }
      
      if (isEditorMounted) {
        // Update the logs content
        setLogs(result.logs);
        // Increment the editor key to force a re-render
        setEditorKey(prev => prev + 1);
      }
    } catch (error) {
      if (isEditorMounted) {
        setLogsError(error.message);
        console.error('Logs error:', error);
      }
    } finally {
      if (isEditorMounted) {
        // Add a small delay before hiding the loading state to ensure smooth transition
        setTimeout(() => {
          setIsLoadingLogs(false);
        }, 300);
      }
    }
  }, [functionName, isEditorMounted]);

  // Fetch logs when switching to the logs tab
  useEffect(() => {
    let timeoutId;
    if (activeTab === 'logs') {
      setIsLoadingLogs(true);
      timeoutId = setTimeout(fetchLogs, 100);
    }
    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [activeTab, fetchLogs]);

  // Cleanup effect
  useEffect(() => {
    setIsEditorMounted(true);
    return () => {
      setIsEditorMounted(false);
    };
  }, []);

  // Load saved payload from localStorage on component mount or when functionName changes
  useEffect(() => {
    if (functionName) {
      const savedPayload = localStorage.getItem(`function_${functionName}_payload`);
      
      if (savedPayload) {
        setPayload(savedPayload);
      }
      
      // Reset unsaved changes flag when loading a new function
      setHasUnsavedChanges(false);
    }
  }, [functionName]);

  // Save payload to localStorage when component unmounts or when functionName changes
  useEffect(() => {
    // Only save if there are unsaved changes
    if (functionName && hasUnsavedChanges) {
      localStorage.setItem(`function_${functionName}_payload`, payload);
      setHasUnsavedChanges(false);
    }
    
    // Cleanup function to save when component unmounts
    return () => {
      if (functionName && hasUnsavedChanges) {
        localStorage.setItem(`function_${functionName}_payload`, payload);
      }
    };
  }, [functionName, hasUnsavedChanges]);

  // Track changes to payload
  const handlePayloadChange = (value) => {
    setPayload(value);
    setHasUnsavedChanges(true);
  };

  const handleInvoke = async () => {
    // Check if the function name is supported
    if (functionName !== 'fn1') {
      setShowErrorModal(true);
      return;
    }

    setIsInvoking(true);
    setError(null);
    setResponse(null);
    setResponseText('');
    setResponseContentType('plaintext');
    setContentLength(0);
    setInvocationTime(null);
    setStatusCode(null);
    setHeaders(null);

    const startTime = Date.now();
    
    try {
      // Parse the payload to ensure it's valid JSON
      const parsedPayload = JSON.parse(payload);
      
      // Invoke the function through our proxy endpoint
      const response = await fetch('/api/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          functionName,
          payload: parsedPayload
        }),
      });
      
      const result = await response.json();
      
      // Even if the function returns an error status code, we still want to display the response
      // Only treat it as an error if the API call itself failed
      if (!result.success && !result.data) {
        throw new Error(result.error || 'Failed to invoke function');
      }
      
      const endTime = Date.now();
      const timeTaken = (endTime - startTime) / 1000; // Convert to seconds
      
      // Set the response data, even if it's an error response from the function
      setResponse(result.data);
      
      // Determine content type and format response text
      let contentType = 'plaintext';
      let responseText = '';
      let contentLength = 0;
      
      if (result.data) {
        if (typeof result.data === 'object') {
          contentType = 'json';
          responseText = JSON.stringify(result.data, null, 2);
          contentLength = responseText.length;
        } else if (typeof result.data === 'string') {
          // Try to detect if it's JSON
          try {
            JSON.parse(result.data);
            contentType = 'json';
            responseText = JSON.stringify(JSON.parse(result.data), null, 2);
          } catch (e) {
            contentType = 'plaintext';
            responseText = result.data;
          }
          contentLength = responseText.length;
        } else {
          responseText = String(result.data);
          contentLength = responseText.length;
        }
      }
      
      setResponseText(responseText);
      setResponseContentType(contentType);
      setContentLength(contentLength);
      setInvocationTime(timeTaken.toFixed(2));
      setStatusCode(result.statusCode || 200);
      setHeaders(result.headers || {});
    } catch (error) {
      setError(error.message);
      console.error('Invocation error:', error);
    } finally {
      setIsInvoking(false);
    }
  };

  // Auto-scroll logs to bottom when logs change or when loading completes
  const logsRef = useRef(null);
  
  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [logs, isLoadingLogs]);

  return (
    <div className="function-tester">
      <div className="tester-header">
        <p className="tester-description">
          Send a test payload to your function, to see how it responds, or view its logs
        </p>
      </div>
      
      <div className="tabs">
        <button
          className={`tab-button ${activeTab === 'payload' ? 'active' : ''}`}
          onClick={() => setActiveTab('payload')}
        >
          Payload
        </button>
        <button
          className={`tab-button ${activeTab === 'logs' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('logs');
            fetchLogs();
          }}
        >
          Logs
        </button>
      </div>
      
      <div className="tester-container">
        {activeTab === 'payload' ? (
          <div className="payload-section">
            <h3>Request Payload</h3>
            <div className="editor-container">
              <Editor
                height="200px"
                language="json"
                value={payload}
                onChange={handlePayloadChange}
                theme={window.matchMedia('(prefers-color-scheme: dark)').matches ? 'vs-dark' : 'light'}
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
            
            <div className="invoke-button-container">
              <button
                className="invoke-button"
                onClick={handleInvoke}
                disabled={isInvoking}
              >
                {isInvoking ? (
                  <>
                    <span className="spinner"></span>
                    Invoking...
                  </>
                ) : (
                  'Invoke Function'
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="logs-section">
            <div className="logs-header">
              <h3>Function Logs</h3>
              <button
                className="refresh-button"
                onClick={fetchLogs}
                disabled={isLoadingLogs}
                title="Refresh logs"
              >
                {isLoadingLogs ? (
                  <span className="spinner"></span>
                ) : (
                  '↻'
                )}
              </button>
            </div>
            
            <div className="editor-container">
              {isLoadingLogs ? (
                <div className="logs-loading">
                  <span className="spinner"></span>
                  Loading logs...
                </div>
              ) : logsError ? (
                <div className="logs-error">
                  <p>Error: {logsError}</p>
                </div>
              ) : (
                <div className="logs-display" ref={logsRef}>
                  <pre>{logs}</pre>
                </div>
              )}
            </div>
          </div>
        )}
        
        <div className="response-section">
          <h3>Response</h3>
          {isInvoking ? (
            <div className="response-loading">
              <span className="spinner"></span>
              Invoking function...
            </div>
          ) : error ? (
            <div className="response-error">
              <h4>Error</h4>
              <pre>{error}</pre>
            </div>
          ) : (
            <>
              <div className="response-details-container">
                <button 
                  className="details-toggle"
                  onClick={() => setShowDetails(!showDetails)}
                >
                  <span className="toggle-icon">{showDetails ? '▼' : '▶'}</span>
                  Response Details
                  <span className="meta-summary">
                    {statusCode && (
                      <span className={`status-${statusCode >= 200 && statusCode < 300 ? 'success' : 'error'}`}>
                        {statusCode}
                      </span>
                    )}
                    {invocationTime && <span>{invocationTime}s</span>}
                    <span>{contentLength} bytes</span>
                  </span>
                </button>
                
                {showDetails && (
                  <div className="response-meta-grid">
                    <div className="meta-column">
                      <h4>Response Info</h4>
                      <div className="meta-item">
                        <span className="meta-label">Time:</span>
                        <span className="meta-value">{invocationTime || '-'}s</span>
                      </div>
                      <div className="meta-item">
                        <span className="meta-label">Status:</span>
                        <span className={`meta-value status-${statusCode >= 200 && statusCode < 300 ? 'success' : 'error'}`}>
                          {statusCode || '-'}
                        </span>
                      </div>
                      <div className="meta-item">
                        <span className="meta-label">Function:</span>
                        <span className="meta-value">{functionName}</span>
                      </div>
                    </div>
                    
                    <div className="meta-column">
                      <h4>Response Headers</h4>
                      <div className="headers-table">
                        <table>
                          <thead>
                            <tr>
                              <th>Header</th>
                              <th>Value</th>
                            </tr>
                          </thead>
                          <tbody>
                            {headers && Object.entries(headers).map(([key, value]) => (
                              <tr key={key}>
                                <td>{key}</td>
                                <td>{value}</td>
                              </tr>
                            ))}
                            {(!headers || Object.keys(headers).length === 0) && (
                              <tr>
                                <td colSpan="2">No headers available</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              
              <div className="response-editor">
                <h4>Response Body</h4>
                <div className="editor-container">
                  <Editor
                    height="300px"
                    language={responseContentType}
                    value={responseText}
                    theme={window.matchMedia('(prefers-color-scheme: dark)').matches ? 'vs-dark' : 'light'}
                    options={{
                      readOnly: true,
                      minimap: { enabled: false },
                      fontSize: 14,
                      lineNumbers: 'on',
                      roundedSelection: false,
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                    }}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      
      {showErrorModal && (
        <div className="error-modal">
          <div className="error-modal-content">
            <h3>Error Details</h3>
            <pre>{error}</pre>
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

export default FunctionTester; 