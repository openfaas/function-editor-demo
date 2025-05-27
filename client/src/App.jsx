import { useState } from 'react'
import './App.css'
import FunctionEditor from './components/FunctionEditor'
import FunctionTester from './components/FunctionTester'
import './components/FunctionEditor.css'
import './components/FunctionTester.css'

function App() {
  const [activePage, setActivePage] = useState('editor');
  const [functionName, setFunctionName] = useState('fn1');

  return (
    <div className="app">
      <div className="header">
        <h1 className="title">Function Editor</h1>
        <div className="branding">Powered by OpenFaaS</div>
      </div>
      
      <div className="navigation">
        <button 
          className={`nav-button ${activePage === 'editor' ? 'active' : ''}`}
          onClick={() => setActivePage('editor')}
        >
          Edit Function
        </button>
        <button 
          className={`nav-button ${activePage === 'tester' ? 'active' : ''}`}
          onClick={() => setActivePage('tester')}
        >
          Test Function
        </button>
      </div>
      
      {activePage === 'editor' ? (
        <FunctionEditor functionName={functionName} setFunctionName={setFunctionName} />
      ) : (
        <FunctionTester functionName={functionName} />
      )}
    </div>
  )
}

export default App
