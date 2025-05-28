import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';
import axios from 'axios';
import crypto from 'crypto';
import { spawn } from 'child_process';
import * as tar from 'tar';
import os from 'os';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const imagePrefix = process.env.IMAGE_PREFIX || "ttl.sh/openfaas"
const builderPayloadSecret = process.env.BUILDER_PAYLOAD_SECRET || ".secrets/payload.txt"
const builderURL = process.env.BUILDER_URL || 'http://127.0.0.1:8081'
const basicAuthSecret = process.env.BASIC_AUTH_SECRET || ".secrets/basic-auth-password.txt"
const gatewayURL = process.env.GATEWAY_URL || 'http://127.0.0.1:8080'

// Define templates directory
const TEMPLATES_DIR = path.join(__dirname, 'templates');

// Function to download templates at server startup
async function downloadTemplates() {
  console.log('Downloading node20 template...');
  console.log(`Templates directory: ${TEMPLATES_DIR}`);
  
  // Create templates directory if it doesn't exist
  try {
    await fs.mkdir(TEMPLATES_DIR, { recursive: true });
    console.log(`Created templates directory: ${TEMPLATES_DIR}`);
  } catch (err) {
    if (err.code !== 'EEXIST') {
      console.error('Error creating templates directory:', err);
      return;
    } else {
      console.log(`Templates directory already exists: ${TEMPLATES_DIR}`);
    }
  }
  
  const template = 'node20';
  // The template is actually downloaded to templates/template/node20
  const templateDir = path.join(TEMPLATES_DIR, 'template', template);
  console.log(`Template directory: ${templateDir}`);
  
  // Check if template already exists
  try {
    await fs.access(templateDir);
    console.log(`Template ${template} already exists at ${templateDir}, skipping download`);
    
    // List contents of the template directory
    try {
      const files = await fs.readdir(templateDir);
    } catch (err) {
      console.error(`Error reading template directory: ${err.message}`);
    }
    
    return;
  } catch (err) {
    // Template doesn't exist, download it
    console.log(`Template ${template} not found at ${templateDir}, downloading...`);
    
    try {
      // Pull the template using faas-cli with absolute path
      await new Promise((resolve, reject) => {
        const cmd = spawn('faas-cli', ['template', 'store', 'pull', template], {
          cwd: TEMPLATES_DIR,
          env: { ...process.env, PATH: process.env.PATH }
        });
        
        cmd.stdout.on('data', (data) => {
          console.log(data.toString());
        });
        
        cmd.stderr.on('data', (data) => {
          console.error(data.toString());
        });
        
        cmd.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Failed to pull template: ${code}`));
          }
        });
      });
      
      // Verify the template was downloaded
      try {
        await fs.access(templateDir);
        console.log(`Template ${template} downloaded successfully to ${templateDir}`);
        
        // List contents of the template directory
        try {
          const files = await fs.readdir(templateDir);
        } catch (err) {
          console.error(`Error reading template directory: ${err.message}`);
        }
      } catch (err) {
        console.error(`Template ${template} was not found at ${templateDir} after download`);
        throw new Error(`Template download failed: ${template} not found at ${templateDir}`);
      }
    } catch (err) {
      console.error(`Error downloading template ${template}:`, err);
    }
  }
  
  console.log('Template download complete');
}

// Call downloadTemplates at server startup
downloadTemplates().catch(err => {
  console.error('Error downloading templates:', err);
});

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

// Store deployed functions in memory for demo
const deployedFunctions = new Map();

// Generate a random string of specified length
function generateRandomString(length) {
  const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}
// Build function using OpenFaaS CLI
async function buildFunction(functionName, handler, lang, packageJson = null) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'builder-'));
  
  try {
    // Generate a random tag
    const tag = generateRandomString(8);
    
    // Create the full image name
    const image = `${imagePrefix}/${functionName}:${tag}`;
    
    // Create stack.yaml first
    const stackYaml = `version: 1.0
provider:
  name: openfaas
  gateway: http://127.0.0.1:8080
functions:
  ${functionName}:
    lang: ${lang}
    handler: ./${functionName}
    image: ${image}`;
    
    await fs.writeFile(path.join(tempDir, 'stack.yaml'), stackYaml, 'utf8');
    
    // Create function directory
    const functionDir = path.join(tempDir, functionName);
    await fs.mkdir(functionDir, { recursive: true });
    
    // Write handler.js file
    await fs.writeFile(path.join(functionDir, 'handler.js'), handler, 'utf8');
    
    // Create package.json
    const packageJsonContent = packageJson || {
      "name": functionName,
      "version": "1.0.0",
      "description": "OpenFaaS function",
      "main": "handler.js",
      "scripts": {
            "test": "echo 'Skipping tests' && exit 0"
      },
      "keywords": [],
      "author": "",
      "license": "ISC",
      "dependencies": {}
    };
    
    await fs.writeFile(
      path.join(functionDir, 'package.json'), 
      JSON.stringify(packageJsonContent, null, 2), 
      'utf8'
    );
    
    // Copy the template instead of pulling it
    console.log(`Copying ${lang} template...`);
    // Update the path to match where the template is actually stored
    const templateSourceDir = path.join(TEMPLATES_DIR, 'template', lang);
    const templateDestDir = path.join(tempDir, 'template', lang);
    
    try {
      // Check if template exists
      await fs.access(templateSourceDir);
      
      // Create the template directory if it doesn't exist
      await fs.mkdir(path.join(tempDir, 'template'), { recursive: true });
      
      // Copy the template directory
      await fs.cp(templateSourceDir, templateDestDir, { recursive: true });
      console.log(`Template ${lang} copied successfully to ${templateDestDir}`);
      
      // List the contents of the template directory for debugging
      const templateFiles = await fs.readdir(templateDestDir);
      console.log(`Template directory contents: ${templateFiles.join(', ')}`);
    } catch (err) {
      console.error(`Template not found at ${templateSourceDir}`);
      throw new Error(`Template ${lang} not found. Please ensure it was downloaded during server startup.`);
    }
    
    // Create build config
    let buildConfig = { image, buildArgs: {}, push: false };
    console.log(buildConfig)
    await fs.writeFile(
      path.join(tempDir, 'com.openfaas.docker.config'),
      JSON.stringify(buildConfig),
      'utf8'
    );
    
    // Run shrinkwrap to create the build directory
    console.log('Running shrinkwrap...');
    await new Promise((resolve, reject) => {
      const cmd = spawn('faas-cli', ['build', '--shrinkwrap'], {
        cwd: tempDir
      });
      
      cmd.stdout.on('data', (data) => {
        console.log(data.toString());
      });
      
      cmd.stderr.on('data', (data) => {
        console.error(data.toString());
      });
      
      cmd.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Failed to shrinkwrap: ${code}`));
        }
      });
    });
    
    // Create tar file from the build directory
    const buildDir = path.join(tempDir, 'build', functionName);
    const tarFile = path.join(tempDir, 'req.tar');
    
    // Make sure the build directory exists
    try {
      await fs.access(buildDir);
    } catch (err) {
      console.error(`Build directory ${buildDir} does not exist. Available directories:`, 
        await fs.readdir(path.join(tempDir, 'build')));
      throw new Error(`Build directory ${buildDir} does not exist`);
    }
    
    // Create a temporary directory for the tar contents
    const tarDir = path.join(tempDir, 'tar-contents');
    await fs.mkdir(tarDir, { recursive: true });
    
    // Copy the build directory to the tar directory as "context"
    await fs.cp(buildDir, path.join(tarDir, 'context'), { recursive: true });
    
    // Copy the config file to the root of the tar directory
    await fs.copyFile(
      path.join(tempDir, 'com.openfaas.docker.config'),
      path.join(tarDir, 'com.openfaas.docker.config')
    );
    
    // Create the tar file from the tar directory
    await tar.c(
      {
        cwd: tarDir,
        file: tarFile,
      },
      ['.']
    );
    
    // Read secret and calculate hash
    let secret = await fs.readFile(builderPayloadSecret, 'utf8');
    let data = await fs.readFile(tarFile);
    let hash = crypto
      .createHmac('sha256', secret.trim())
      .update(data)
      .digest('hex');
    
    // Send build request
    try {
      let res = await axios({
        data: data,
        method: 'post',
        url: `${builderURL}/build`,
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Build-Signature': 'sha256=' + hash,
        }
      });
      
      return {
        success: true,
        image: res.data.image,
        message: `Success building image ${res.data.image}`
      };
    } catch (err) {
      return {
        success: false,
        error: `Building image ${image} failed: ${err.response?.data?.status || err.message}`
      };
    }
  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  } finally {
    // Clean up temp directory
    // await fs.rm(tempDir, { recursive: true, force: true });
    console.log("Wrote to: ", tempDir);
  }
}

// Publish endpoint - Builds the function and returns the image
app.post('/api/publish', async (req, res) => {
  const startTime = Date.now();
  try {
    const { functionName, handler, lang, packageJson } = req.body;
    
    if (!functionName || !handler || !lang) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: functionName, handler, and lang are required'
      });
    }
    
    const result = await buildFunction(functionName, handler, lang, packageJson);
    
    const endTime = Date.now();
    const publishTime = (endTime - startTime) / 1000; // Convert to seconds
    
    if (result.success) {
      res.json({
        ...result,
        publishTime: publishTime.toFixed(2)
      });
    } else {
      res.status(500).json({
        ...result,
        publishTime: publishTime.toFixed(2)
      });
    }
  } catch (error) {
    const endTime = Date.now();
    const publishTime = (endTime - startTime) / 1000; // Convert to seconds
    
    console.error('Build error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      publishTime: publishTime.toFixed(2)
    });
  }
});

// Deploy endpoint - Deploys the function to OpenFaaS gateway
app.post('/api/deploy', async (req, res) => {
  const startTime = Date.now();
  try {
    const { functionName, image } = req.body;
    
    if (!functionName || !image) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: functionName and image are required'
      });
    }
    
    // Deploy the function to OpenFaaS gateway
    try {
      // Read the password from the basic-auth-password.txt file
      let password = '';
      try {
        password = await fs.readFile(basicAuthSecret, 'utf8');
        password = password.trim(); // Remove any whitespace
      } catch (err) {
        console.warn('Could not read basic-auth-password.txt, using empty password');
        password = '';
      }
      
      // Set up common headers and data
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(`admin:${password}`).toString('base64')}`
      };
      
      const functionData = {
        service: functionName,
        image: image,
        envProcess: "node index.js",
        labels: {
          "com.openfaas.scale.zero": "true",
          "com.openfaas.scale.zero-duration": "5m"
        },
        annotations: {},
        limits:{
          "memory": "90Mi",
        }
      };
      
      // First check if the function exists
      let functionExists = false;
      try {
        const checkResponse = await axios({
          method: 'GET',
          url: `${gatewayURL}/system/function/${functionName}`,
          headers: headers
        });
        
        if (checkResponse.status === 200) {
          functionExists = true;
        }
      } catch (err) {
        // If we get a 404, the function doesn't exist
        if (err.response && err.response.status === 404) {
          functionExists = false;
        } else {
          // For other errors, log them but continue with the deployment
          console.warn(`Error checking if function exists: ${err.message}`);
        }
      }
      
      // Deploy the function using PUT or POST based on whether it exists
      const deployResponse = await axios({
        method: functionExists ? 'PUT' : 'POST',
        url: `${gatewayURL}/system/functions`,
        headers: headers,
        data: functionData
      });
      
      const endTime = Date.now();
      const deployTime = (endTime - startTime) / 1000; // Convert to seconds
      
      return res.json({
        success: true,
        message: `Function ${functionName} ${functionExists ? 'updated' : 'deployed'} successfully to OpenFaaS gateway`,
        data: deployResponse.data,
        deployTime: deployTime.toFixed(2)
      });
    } catch (error) {
      const endTime = Date.now();
      const deployTime = (endTime - startTime) / 1000; // Convert to seconds
      
      console.error('Deployment error:', error.response?.data || error.message);
      return res.status(500).json({
        success: false,
        error: `Failed to deploy function: ${error.response?.data?.error || error.message}`,
        deployTime: deployTime.toFixed(2)
      });
    }
  } catch (error) {
    const endTime = Date.now();
    const deployTime = (endTime - startTime) / 1000; // Convert to seconds
    
    console.error('Deployment error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      deployTime: deployTime.toFixed(2)
    });
  }
});

// Invoke endpoint - Proxies function invocations to avoid CORS issues
app.post('/api/invoke', async (req, res) => {
  try {
    const { functionName, payload } = req.body;
    
    if (!functionName) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: functionName is required'
      });
    }
    
    // Read the password from the basic-auth-password.txt file
    let password = '';
    try {
      password = await fs.readFile(basicAuthSecret, 'utf8');
      password = password.trim(); // Remove any whitespace
    } catch (err) {
      console.warn('Could not read basic-auth-password.txt, using empty password');
      password = '';
    }
    
    // Set up headers for the request
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${Buffer.from(`admin:${password}`).toString('base64')}`
    };
    
    // Invoke the function
    try {
      const invokeResponse = await axios({
        method: 'POST',
        url: `${gatewayURL}/function/${functionName}`,
        headers: headers,
        data: payload || {},
        validateStatus: false, // This ensures we get headers even for error responses
        maxRedirects: 0, // Prevent following redirects to capture original headers
      });
      
      // Pass through ALL headers exactly as they come from the OpenFaaS gateway
      return res.json({
        success: invokeResponse.status >= 200 && invokeResponse.status < 300,
        data: invokeResponse.data,
        statusCode: invokeResponse.status,
        headers: invokeResponse.headers
      });
    } catch (error) {
      console.error('Invocation error:', error.response?.data || error.message);
      
      // For errors, pass through all headers if available
      return res.status(500).json({
        success: false,
        error: `Failed to invoke function: ${error.response?.data?.error || error.message}`,
        statusCode: error.response?.status || 500,
        headers: error.response?.headers || {}
      });
    }
  } catch (error) {
    console.error('Invocation error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Logs endpoint - Fetches function logs from OpenFaaS
app.post('/api/logs', async (req, res) => {
  try {
    const { functionName } = req.body;
    
    if (!functionName) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: functionName is required'
      });
    }
    
    // Read the password from the basic-auth-password.txt file
    let password = '';
    try {
      password = await fs.readFile(basicAuthSecret, 'utf8');
      password = password.trim(); // Remove any whitespace
    } catch (err) {
      console.warn('Could not read basic-auth-password.txt, using empty password');
      password = '';
    }
    
    // Build query parameters
    const params = new URLSearchParams({
      name: functionName,
      follow: 'false',
      tail: -1
    });

    console.log(`Server: Fetching logs for ${functionName} with tail=-1`);
    
    // Fetch logs from OpenFaaS
    const logsResponse = await fetch(
      `${gatewayURL}/system/logs?${params.toString()}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${Buffer.from(`admin:${password}`).toString('base64')}`,
          'User-Agent': 'OpenFaaS/1.0'
        }
      }
    );

    if (!logsResponse.ok) {
      throw new Error(`Failed to fetch logs: ${logsResponse.statusText}`);
    }

    const logsText = await logsResponse.text();
    console.log(`Server: Raw logs text length: ${logsText.length} characters`);
    
    // Format the logs into a string
    let formattedLogs = '';
    let logCount = 0;
    
    try {
      // Split the logs into lines and process each line
      const logLines = logsText.split('\n').filter(line => line.trim());
      logCount = logLines.length;
      
      // Log the number of lines and the last line for debugging
      console.log(`Server: Fetched ${logCount} log lines for function ${functionName}`);
      
      if (logCount > 0) {
        console.log(`Server: First log line: ${logLines[0]}`);
        console.log(`Server: Last log line: ${logLines[logCount - 1]}`);
        
        // Check for duplicate log lines
        const uniqueLines = new Set(logLines);
        if (uniqueLines.size !== logCount) {
          console.log(`Server: Warning: Found ${logCount - uniqueLines.size} duplicate log lines`);
        }
      } else {
        console.log(`Server: No log lines found for function ${functionName}`);
      }
      
      formattedLogs = logLines.map(line => {
        try {
          // Try to parse as JSON first
          const log = JSON.parse(line);
          // Just return the text content
          return log.text;
        } catch (e) {
          // If not JSON, return the line as is
          return line;
        }
      }).join('\n');
    } catch (e) {
      // If parsing fails, return the raw logs
      formattedLogs = logsText;
      console.error(`Server: Error parsing logs: ${e.message}`);
    }
    
    // Pass through the response with formatted logs
    return res.json({
      success: true,
      logs: formattedLogs || 'No logs available',
      statusCode: logsResponse.status,
      logCount: logCount
    });
  } catch (error) {
    console.error('Logs error:', error.message);
    return res.status(500).json({
      success: false,
      error: `Failed to fetch logs: ${error.message}`,
      statusCode: error.response?.status || 500
    });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
}); 