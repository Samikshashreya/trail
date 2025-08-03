#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.trail');
const SESSIONS_DIR = path.join(CONFIG_DIR, 'sessions');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const API_BASE_URL = 'http://localhost:4000';

if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

function getActiveSessionId() {
  try {
    const config = readUserConfig();
    return config.activeSession;
  } catch (e) {
    return null;
  }
}

function setActiveSession(sessionId) {
  const config = readUserConfig();
  config.activeSession = sessionId;
  saveConfig(config);
}

function generateSessionId() {
  return Math.random().toString(36).substring(2, 10);
}

function prettyPrintDiff(diff, filePath) {
  console.log(`\n${chalk.underline('Diff for:')} ${chalk.blue(filePath)}`);
  console.log(chalk.gray('-'.repeat(80)));
  
  diff.split('\n').forEach(line => {
    if (line.startsWith('+')) {
      console.log(chalk.green(line));
    } else if (line.startsWith('-')) {
      console.log(chalk.red(line));
    } else if (line.startsWith('@@')) {
      console.log(chalk.blue(line));
    } else {
      console.log(line);
    }
  });
  
  console.log(chalk.gray('-'.repeat(80)));
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function readUserConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (e) {
      console.error('Error reading config:', e.message);
      return {};
    }
  }
  return {};
}

function getToken() {
  return process.env.TRAIL_TOKEN || readUserConfig().token;
}

function isLoggedIn() {
  return !!getToken();
}

async function detectErrors(filePath) {
  const spinner = ora('Analyzing code for potential errors...').start();
  
  const createError = (message, details = {}) => ({
    message: message.trim(),
    filePath: path.relative(process.cwd(), details.filePath || filePath),
    line: details.line || 1,
    column: details.column || 1,
    source: details.source || 'trail-cli',
    sourceCode: details.sourceCode || null,
    toString() {
      const location = `${this.filePath}:${this.line}:${this.column}`;
      return `${this.message} (${this.source}) at ${location}`;
    }
  });

  try {
    const { execSync } = await import('child_process');
    const fs = await import('fs');
    
    try {
      const eslintCmd = `npx eslint --format json "${filePath}"`;
      const eslintOutput = execSync(eslintCmd, { 
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      const eslintResults = JSON.parse(eslintOutput);
      if (eslintResults.length > 0 && eslintResults[0].messages.length > 0) {
        const errors = [];
        
        for (const result of eslintResults) {
          const fileContent = fs.existsSync(result.filePath) ? 
            fs.readFileSync(result.filePath, 'utf-8').split('\n') : [];
            
          for (const msg of result.messages.filter(m => m.severity === 2)) {
            errors.push(createError(msg.message, {
              filePath: result.filePath,
              line: msg.line,
              column: msg.column,
              source: `eslint:${msg.ruleId || 'unknown'}`,
              sourceCode: fileContent[msg.line - 1]?.trim()
            }));
          }
        }
        
        if (errors.length > 0) {
          const errorMsg = errors.length === 1 ? 
            `Found 1 error using ESLint` : 
            `Found ${errors.length} errors using ESLint`;
          
          spinner.succeed(chalk.yellow(errorMsg));
          return errors;
        }
      }
    } catch (e) {
      if (process.env.DEBUG) {
        console.error(chalk.dim('ESLint error:'), e.message);
      }
    }
    
    try {
      const { stderr } = execSync(`node -c "${filePath}"`, { 
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        maxBuffer: 10 * 1024 * 1024
      });
      
      spinner.succeed('No syntax errors found in the code');
      return [];
      
    } catch (e) {
      const errorOutput = (e.stderr || e.message || '').toString();
      
      if (!errorOutput) {
        spinner.info('No error details found');
        return [];
      }
      
      const errorPatterns = [
        /^([^:\n]+?):(\d+):(\d+)[\s\S]*?\n([^\n]+)/,
        /^([^:]+):\s*([\s\S]*)(?:\n\s*at [^\n]+\s\(([^:]+):(\d+):(\d+)\))?/,
        /^([^:]+):\s*([^\n]+)(?:\n\s*at [^\n]+\s\(([^:]+):(\d+):(\d+)\))?/,
        /(?:Error: )?(Cannot find module '[^']+')/i
      ];
      
      for (const pattern of errorPatterns) {
        const match = errorOutput.match(pattern);
        if (match) {
          let errorDetails = {
            message: match[2] || match[1],
            filePath: match[3] || filePath,
            line: parseInt(match[4] || match[2] || 1, 10),
            column: parseInt(match[5] || match[3] || 1, 10),
            source: 'node-syntax'
          };
          
          try {
            const fileContent = fs.readFileSync(errorDetails.filePath, 'utf-8').split('\n');
            if (fileContent[errorDetails.line - 1]) {
              errorDetails.sourceCode = fileContent[errorDetails.line - 1].trim();
            }
          } catch (readError) {
          }
          
          spinner.succeed(chalk.red(`Found error: ${errorDetails.message}`));
          return [createError(errorDetails.message, errorDetails)];
        }
      }
      
      return [createError(errorOutput.split('\n')[0], {
        filePath: filePath,
        source: 'node-runtime'
      })];
    }
    
  } catch (error) {
    if (process.env.DEBUG) {
      console.error(chalk.dim('Error in detectErrors:'), error);
    }
    spinner.fail('Error during code analysis');
    return [createError(error.message, {
      filePath: filePath,
      source: 'trail-cli'
    })];
  }
  
  spinner.succeed('No errors detected in the code');
  return [];
}

program
  .command('lookup')
  .description('Automatically detect and look up solutions for errors in your code')
  .option('-f, --file <filePath>', 'The path to the file to analyze (default: all modified files)')
  .option('-e, --error <errorMessage>', 'Optional: Specific error message to look up')
  .action(async (options) => {
    const spinner = ora('Analyzing your code...').start();
    try {
      let filesToAnalyze = [];
      if (options.file) {
        filesToAnalyze = [options.file];
      } else {
        const { execSync } = await import('child_process');
        const gitStatus = execSync('git status --porcelain', { encoding: 'utf-8' });
        filesToAnalyze = gitStatus
          .split('\n')
          .filter(line => line.match(/^[MA]\s+(.*\.(js|jsx|ts|tsx|py|java|rb|go|rs|php)$)/))
          .map(line => line.substring(3).trim());
        
        if (filesToAnalyze.length === 0) {
          spinner.info('No modified files detected. Please specify a file with -f option.');
          return;
        }
      }

      let allErrors = [];
      for (const file of filesToAnalyze) {
        const errors = await detectErrors(file);
        allErrors = [...allErrors, ...errors.map(e => ({ ...e, file }))];
      }

      if (allErrors.length === 0) {
        if (options.error) {
          spinner.info('No code issues found. Using provided error message for lookup.');
          allErrors = [{
            message: options.error,
            file: options.file || 'unknown',
            line: 0,
            column: 0,
            source: 'user-provided'
          }];
        } else {
          spinner.succeed('No errors detected in the code.');
          console.log('\nIf you\'re still experiencing issues, try:');
          console.log('1. Run with a specific error message: trail lookup -e "your error message"');
          console.log('2. Check runtime logs for additional error details');
          return;
        }
      }

      for (const error of allErrors) {
        spinner.text = `Looking up solutions for: ${error.message.substring(0, 50)}${error.message.length > 50 ? '...' : ''}`;
        
        try {
          const response = await axios.get(`${API_BASE_URL}/api/resolutions/lookup`, {
            params: {
              error: error.message,
              file: error.file,
              line: error.line,
              column: error.line > 0 ? error.column : undefined
            },
            headers: { Authorization: `Bearer ${getToken()}` }
          });

          console.log('\n' + chalk.underline(`Found in ${chalk.blue(error.file)}${error.line ? `:${error.line}` : ''}`));
          console.log(chalk.red(`✗ ${error.message}`));
          
          if (response.data.resolutions?.length > 0) {
            console.log(chalk.green('\n🔍 Found matching solutions:'));
            response.data.resolutions.slice(0, 3).forEach((res, i) => {
              console.log(`\n${i + 1}. ${res.solution}`);
              if (res.codeSnippet) {
                console.log(chalk.gray('   ' + res.codeSnippet.split('\n').join('\n   ')));
              }
              if (res.sourceSession) {
                console.log(`   From session: ${chalk.dim(res.sourceSession)}`);
              }
            });
          } else {
            console.log(chalk.yellow('\nNo exact matches found. Try these general debugging steps:'));
            console.log('1. Check for typos or syntax errors in the code');
            console.log('2. Verify all required dependencies are installed');
            console.log('3. Check the documentation for the relevant libraries');
            console.log('\nOr get AI help: trail ai --error "' + error.message + '" --file ' + error.file);
          }
          
        } catch (error) {
          console.error(chalk.red('\nError searching for solutions:'), error.message);
        }
      }
      
      spinner.succeed('Analysis complete');
      
    } catch (error) {
      spinner.fail('Failed to analyze code');
      console.error(chalk.red(error.response?.data?.error || error.message));
      
      if (error.code === 'ENOENT' && error.path === 'git') {
        console.log('\nGit not found. Please install Git or specify files with -f option.');
      } else if (error.code === 'ENOENT') {
        console.log('\nFile not found. Please check the file path.');
      }
    }
  });

program
  .command('which')
  .description('Show current debugging session ID')
  .action(() => {
    const sessionId = getActiveSessionId();
    if (sessionId) {
      console.log(chalk.green(`\n🆔 Current session ID: ${chalk.bold(sessionId)}`));
    } else {
      console.log(chalk.yellow('\nℹ️ No active session. Start one with `trail start`.'));
    }
  });

program
  .command('checkout <session_id>')
  .description('Checkout a specific debugging session')
  .action((sessionId) => {
    const sessionPath = getSessionPath(sessionId);
    if (fs.existsSync(sessionPath)) {
      setActiveSession(sessionId);
      console.log(chalk.green(`\n🔍 Checked out session: ${chalk.bold(sessionId)}`));
      console.log(chalk.dim('Use `trail replay` to replay this session.'));
    } else {
      console.error(chalk.red(`\n❌ Session not found: ${sessionId}`));
    }
  });

program
  .command('resolve')
  .description('Mark the current debugging session as resolved')
  .option('-m, --message <message>', 'Resolution message')
  .action((options) => {
    const sessionId = getActiveSessionId();
    if (!sessionId) {
      console.error(chalk.red('\n❌ No active session. Start one with `trail start`.'));
      return;
    }
    
    const message = options.message || 'Fixed the issue';
    console.log(chalk.green(`\n✅ Marked session ${chalk.bold(sessionId)} as resolved: "${message}"`));
  });

program
  .command('ai')
  .description('Get AI-powered suggestions for current issue using local Ollama AI')
  .option('-e, --error <errorMessage>', 'Error message to analyze')
  .option('-f, --file <file>', 'File where the error occurred')
  .option('-d, --diff', 'Include git diff in the analysis', false)
  .option('-m, --model <model>', 'Ollama model to use (default: llama2, try: codellama, mistral, etc.)', 'llama2')
  .option('--cloud', 'Use cloud AI service (requires TRAIL_TOKEN) instead of local Ollama', false)
  .action(async (options) => {
    const spinner = ora('Analyzing code and error with AI...').start();
    
    try {
      if (!options.error) {
        const detectedErrors = await detectErrors(process.cwd());
        if (!detectedErrors || detectedErrors.length === 0) {
          console.log(chalk.green('\n✅ No errors detected in the code.'));
          return;
        }
        
        const error = detectedErrors[0];
        options.error = error.toString();
        
        console.log('\n' + chalk.red.bold('Error Details:'));
        console.log(chalk.gray('┌' + '─'.repeat(78) + '┐'));
        console.log(`  ${chalk.bold('File:')}    ${chalk.cyan(error.filePath)}`);
        console.log(`  ${chalk.bold('Line:')}    ${error.line}:${error.column}`);
        if (error.sourceCode) {
          console.log(`  ${chalk.bold('Code:')}    ${error.sourceCode}`);
        }
        console.log(`  ${chalk.bold('Error:')}   ${chalk.red(error.message)}`);
        console.log(chalk.gray('└' + '─'.repeat(78) + '┘\n'));
      }
      
      let codeContext = '';
      if (options.file) {
        try {
          const fileContent = fs.readFileSync(options.file, 'utf-8').split('\n');
          const contextLines = parseInt(options.contextLines) || 10;
          const lineNum = parseInt(options.line) || 1;
          
          const startLine = Math.max(0, lineNum - 1 - Math.floor(contextLines / 2));
          const endLine = Math.min(fileContent.length, lineNum + Math.floor(contextLines / 2));
          
          codeContext = '\n```' + options.file.split('/').pop() + '\n' +
            fileContent
              .slice(startLine, endLine)
              .map((line, i) => {
                const currentLine = startLine + i + 1;
                const prefix = currentLine === lineNum ? '→ ' : '  ';
                return `${prefix}${currentLine.toString().padEnd(4)} ${line}`;
              })
              .join('\n') +
            '\n```\n';
        } catch (e) {
        }
      }

      let gitContext = '';
      try {
        const { execSync } = await import('child_process');
        const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
        const diff = execSync('git diff --unified=0', { encoding: 'utf-8' });
        
        gitContext = `\nGit Branch: ${branch}\n` +
          'Recent Changes:\n```diff\n' + 
          diff.split('\n').slice(0, 50).join('\n') +
          (diff.includes('\n') ? '\n... (truncated)' : '') +
          '\n```';
      } catch (e) {
      }

      const prompt = `You are a senior software engineer helping to debug an issue. Be concise and specific.

Error: ${options.error || 'No error message provided'}

Code Context:${codeContext || ' No code context available.'}
${gitContext}

Provide a clear, step-by-step solution. If you need more information, ask specific questions.`;

      if (!options.cloud) {
        try {
          const modelName = options.model.replace('ollama/', '');
          spinner.text = `🧠 Querying Ollama (${modelName})...`;
          
          const { execSync } = await import('child_process');
          const enhancedPrompt = `${prompt}

Please format your response using the following markdown structure:

## 🔍 Analysis
[Briefly analyze the error]

## 🛠️ Suggested Fix
\`\`\`diff
[Show minimal code changes in unified diff format if applicable]
\`\`\`

## 📝 Explanation
[Explain why this fixes the issue and any important context]

## 🚀 Next Steps
[Any additional recommendations or checks]`;

          const tempFile = path.join(os.tmpdir(), `trail-prompt-${Date.now()}.txt`);
          fs.writeFileSync(tempFile, enhancedPrompt, 'utf-8');
          
          if (process.env.DEBUG) {
            console.log(chalk.dim('\n[DEBUG] Created temporary prompt file:', tempFile));
            console.log(chalk.dim(`[DEBUG] Prompt file size: ${fs.statSync(tempFile).size} bytes`));
          }
          
          const command = `cat "${tempFile}" | ollama run ${modelName} --nowordwrap`;
          
          if (process.env.DEBUG) {
            console.log(chalk.dim('\n[DEBUG] Executing Ollama command...'));
            console.log(chalk.dim(`[DEBUG] Command: ${command}`));
            console.log(chalk.dim(`[DEBUG] Current directory: ${process.cwd()}`));
          }
          
          let response = '';
          try {
            const { execSync } = await import('child_process');
            if (process.env.DEBUG) {
              console.log(chalk.dim('[DEBUG] Running command...'));
            }
            
            response = execSync(command, { 
              encoding: 'utf-8',
              stdio: ['ignore', 'pipe', 'pipe'],
              maxBuffer: 10 * 1024 * 1024,
              shell: '/bin/zsh',
              timeout: 30000
            });
            
            if (process.env.DEBUG) {
              console.log(chalk.dim('[DEBUG] Command execution completed'));
              console.log(chalk.dim(`[DEBUG] Response length: ${response?.length || 0}`));
            }
            
            try {
              fs.unlinkSync(tempFile);
              if (process.env.DEBUG) {
                console.log(chalk.dim('[DEBUG] Removed temporary prompt file'));
              }
            } catch (e) {
              if (process.env.DEBUG) {
                console.error(chalk.yellow('[WARN] Failed to remove temporary file:', e.message));
              }
            }
            
            if (process.env.DEBUG) {
              console.log(chalk.dim(`[DEBUG] Ollama command executed successfully`));
              console.log(chalk.dim(`[DEBUG] Response length: ${response ? response.length : 0}`));
              
              if (response) {
                console.log(chalk.dim(`[DEBUG] Response preview: ${response.substring(0, 100)}...`));
                
                const hasMarkdown = /```/.test(response);
                console.log(chalk.dim(`[DEBUG] Contains markdown code blocks: ${hasMarkdown}`));
              }
            }
          } catch (e) {
            console.error(chalk.red('[DEBUG] Error executing Ollama command:'));
            console.error(chalk.red(e.message));
            if (e.stderr) {
              console.error(chalk.red('STDERR:'), e.stderr.toString());
            }
            if (e.stdout) {
              console.error(chalk.red('STDOUT:'), e.stdout.toString());
            }
            throw e;
          }
          
          spinner.succeed('🤖 AI Suggestion (from Ollama)');
          
          console.log('\n' + chalk.bold.blue('='.repeat(process.stdout.columns || 80)));
          console.log(chalk.bold.green('🚀 TRAIL AI DEBUGGING ASSISTANT'));
          console.log(chalk.blue('='.repeat(process.stdout.columns || 80)));
          
          const formattedResponse = response
            .replace(/^##\s+(.*?)$/gm, (_, m) => chalk.bold.cyan('\n' + m + ':')) // Format headers
            .replace(/```diff\n([\s\S]*?)\n```/g, (_, code) => {
              const formattedCode = code.split('\n').map(line => {
                if (line.startsWith('+')) return chalk.green(line);
                if (line.startsWith('-')) return chalk.red(line);
                if (line.startsWith('@@')) return chalk.blue(line);
                return line;
              }).join('\n');
              return chalk.gray('```diff\n') + formattedCode + chalk.gray('\n```');
            })
            .replace(/`([^`]+)`/g, (_, code) => chalk.yellow(code));
            
          console.log(formattedResponse);
          console.log(chalk.blue('='.repeat(process.stdout.columns || 80)));
          
          console.log(chalk.dim('\n💡 Run `trail ai` again with more context or use `trail lookup` to search for similar issues.'));
          return;
        } catch (e) {
          const errorMsg = e.stderr ? e.stderr.toString() : e.message;
          console.error(chalk.yellow(`\n⚠️  Failed to use Ollama model ${options.model}:`));
          console.error(chalk.dim(errorMsg));
          
          if (!options.cloud) {
            console.log(chalk.yellow('\nFalling back to cloud AI...'));
            console.log(chalk.dim('  (Install Ollama for local AI: https://ollama.ai/download)'));
            console.log(chalk.dim('  Or use --cloud flag to force cloud AI'));
          }
        }
      }

      if (options.cloud) {
        const token = process.env.TRAIL_TOKEN || readUserConfig()?.token;
        if (!token) {
          throw new Error('TRAIL_TOKEN environment variable is not set. Please set it to use cloud AI, or remove --cloud flag to use local Ollama.');
        }

      spinner.text = '🤖 Getting AI suggestions from cloud...';
      
        try {
          const response = await axios({
          method: 'POST',
          url: `${API_BASE_URL}/api/ai/suggest`,
          headers: { 
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          data: {
            prompt: prompt,
            error: options.error,
            file: options.file,
            line: options.line,
            model: options.model
          },
          timeout: 60000
        });

        spinner.succeed('🤖 AI Suggestion:');
        console.log('\n' + response.data.suggestion);
        
        if (response.data.related_issues?.length > 0) {
          console.log('\n🔍 Related Issues:');
          response.data.related_issues.forEach((issue, i) => {
            console.log(`\n${i + 1}. ${issue.title}`);
            console.log(`   ${chalk.blue(issue.url)}`);
          });
        }
        } catch (error) {
          spinner.fail('❌ Failed to get AI suggestions from cloud');
          
          if (error.response) {
            console.error(chalk.red(`\nError: ${error.response.data?.error || error.response.statusText}`));
            if (error.response.status === 401) {
              console.log(chalk.yellow('\nPlease ensure your TRAIL_TOKEN is valid.'));
            }
            
            if (error.response.data?.suggestion) {
              console.log('\n🤖 Suggestion:');
              console.log(error.response.data.suggestion);
            }
          } else if (error.request) {
            console.error(chalk.red('\nCould not connect to the AI service. Please check your internet connection.'));
          } else {
            console.error(chalk.red(`\nError: ${error.message}`));
          }
          
          if (error.config) {
            console.log(chalk.dim(`\nRequest URL: ${error.config.url}`));
          }
          
          console.log('\n💡 Try installing Ollama for local AI: https://ollama.ai/download');
          console.log('   Or check your internet connection if using --cloud flag');
        }
      } else {
        console.log('\n💡 Install Ollama for local AI: https://ollama.ai/download');
        console.log('   Or use --cloud flag with a valid TRAIL_TOKEN for cloud AI');
      }
    } catch (error) {
      spinner.fail('❌ An unexpected error occurred');
      console.error(chalk.red(`\nError: ${error.message}`));
      if (process.env.DEBUG) {
        console.error(chalk.dim('\nStack trace:'));
        console.error(chalk.dim(error.stack));
      }
    }
  });

const record = program.command('record')
  .description('Record debugging steps in current session');

record.command('start')
  .description('Start recording a debugging session')
  .action(() => {
    const sessionId = getActiveSessionId();
    if (!sessionId) {
      console.error(chalk.red('\n❌ No active session. Start one with `trail start`.'));
      return;
    }
    
    const sessionPath = getSessionPath(sessionId);
    const sessionData = {
      id: sessionId,
      startTime: new Date().toISOString(),
      commands: [],
      isRecording: true
    };
    
    fs.writeFileSync(sessionPath, JSON.stringify(sessionData, null, 2));
    console.log(chalk.green('\n🔴 Started recording debugging session'));
    console.log(chalk.dim('Run `trail record stop` to stop recording'));
  });

record.command('stop')
  .description('Stop recording the current debugging session')
  .action(() => {
    const sessionId = getActiveSessionId();
    if (!sessionId) {
      console.error(chalk.red('\n❌ No active session. Start one with `trail start`.'));
      return;
    }
    
    const sessionPath = getSessionPath(sessionId);
    if (!fs.existsSync(sessionPath)) {
      console.error(chalk.red('\n❌ No active recording session found.'));
      return;
    }
    
    const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
    if (!sessionData.isRecording) {
      console.error(chalk.yellow('\nℹ️ No active recording to stop.'));
      return;
    }
    
    sessionData.endTime = new Date().toISOString();
    sessionData.isRecording = false;
    fs.writeFileSync(sessionPath, JSON.stringify(sessionData, null, 2));
    
    console.log(chalk.green('\n⏹️  Stopped recording debugging session'));
    console.log(chalk.dim(`Session saved with ${sessionData.commands.length} recorded commands`));
  });

record.action(() => {
  console.log(chalk.yellow('\nℹ️ Please specify a subcommand:'));
  console.log('  start    Start recording a debugging session');
  console.log('  stop     Stop the current recording');
  console.log('\nExample: trail record start');
});

program
  .command('replay [sessionId]')
  .description('Replay a recorded debugging session')
  .action(async (sessionId) => {
    const spinner = ora('Loading session...').start();
    const targetSessionId = sessionId || getActiveSessionId();
    
    if (!targetSessionId) {
      spinner.fail('No session ID provided and no active session found.');
      console.log('\nStart a new session with:');
      console.log('  trail start');
      console.log('\nOr specify a session ID:');
      console.log('  trail replay <session-id>');
      return;
    }
    
    const sessionPath = getSessionPath(targetSessionId);
    if (!fs.existsSync(sessionPath)) {
      spinner.fail(`Session not found: ${targetSessionId}`);
      
      const token = getToken();
      if (token) {
        spinner.start(`Session not found locally. Checking remote...`);
        try {
          const response = await axios({
            method: 'GET',
            url: `${API_BASE_URL}/api/sessions/${targetSessionId}`,
            headers: { 'Authorization': `Bearer ${token}` }
          });
          
          fs.writeFileSync(sessionPath, JSON.stringify(response.data, null, 2));
          spinner.succeed('Session downloaded from remote');
        } catch (error) {
          if (error.response?.status === 404) {
            spinner.fail(`Session not found locally or on remote: ${targetSessionId}`);
          } else {
            spinner.fail(`Failed to fetch session: ${error.message}`);
          }
          return;
        }
      } else {
        return;
      }
    }
    
    try {
      const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
      spinner.succeed(`Replaying session: ${chalk.bold(targetSessionId)}`);
      
      console.log(`\n${chalk.bold('Session:')} ${sessionData.id}`);
      console.log(`${chalk.bold('Started:')} ${new Date(sessionData.startTime).toLocaleString()}`);
      if (sessionData.endTime) {
        console.log(`${chalk.bold('Ended:')} ${new Date(sessionData.endTime).toLocaleString()}`);
      }
      console.log(`${chalk.bold('Status:')} ${sessionData.isRecording ? chalk.yellow('Recording') : chalk.green('Completed')}`);
      
      if (sessionData.notes) {
        console.log(`\n${chalk.underline('Notes:')}`);
        console.log(sessionData.notes);
      }
      
      if (sessionData.commands && sessionData.commands.length > 0) {
        console.log(`\n${chalk.underline('Command History:')}`);
        sessionData.commands.forEach((cmd, index) => {
          console.log(`\n${chalk.dim(`${index + 1}.`)} ${chalk.bold(cmd.command)}`);
          if (cmd.output) {
            console.log(chalk.dim(cmd.output.split('\n').map(l => `   ${l}`).join('\n')));
          }
        });
      }
      
      if (sessionData.diffs && sessionData.diffs.length > 0) {
        console.log(`\n${chalk.underline('File Changes:')}`);
        sessionData.diffs.forEach(diff => {
          console.log(`\n${chalk.bold(diff.filePath)}`);
          prettyPrintDiff(diff.diff, diff.filePath);
        });
      }
      
      if (sessionData.resolution) {
        console.log(`\n${chalk.green('✅ Resolution:')} ${sessionData.resolution}`);
      }
      
      console.log('');
      
    } catch (error) {
      console.error(chalk.red('❌ Error replaying session:'), error.message);
      if (error.stack) {
        console.error(chalk.gray(error.stack));
      }
    }
  });

program
  .command('end')
  .description('End the current debugging session')
  .action(() => {
    const sessionId = getActiveSessionId();
    if (!sessionId) {
      console.error(chalk.red('\n❌ No active session to end. Start one with `trail start`.'));
      return;
    }
    
    const sessionPath = getSessionPath(sessionId);
    if (!fs.existsSync(sessionPath)) {
      console.error(chalk.red(`\n❌ Session not found: ${sessionId}`));
      return;
    }
    
    try {
      const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
      sessionData.endTime = new Date().toISOString();
      sessionData.isRecording = false;
      fs.writeFileSync(sessionPath, JSON.stringify(sessionData, null, 2));
      
      setActiveSession(null);
      console.log(chalk.green(`\n✅ Ended debugging session: ${chalk.bold(sessionId)}`));
    } catch (error) {
      console.error(chalk.red(`\n❌ Failed to end session: ${error.message}`));
    }
  });

function formatVariables(variables) {
  if (!variables || Object.keys(variables).length === 0) {
    return chalk.dim('No variables in scope');
  }
  return Object.entries(variables)
    .map(([name, value]) => {
      let formattedValue = typeof value === 'string' ? `"${value}"` : JSON.stringify(value);
      if (formattedValue.length > 50) {
        formattedValue = formattedValue.substring(0, 47) + '...';
      }
      return `${chalk.blue(name)}: ${chalk.yellow(formattedValue)}`;
    })
    .join('\n   ');
}

program
  .command('push')
  .description('Push the current session to remote for sharing')
  .action(async () => {
    const sessionId = getActiveSessionId();
    if (!sessionId) {
      console.error(chalk.red('❌ No active session. Start a new session with `trail start`'));
      return;
    }
if (!sessionId) {
console.error(chalk.red(' No active session. Start a new session with `trail start`'));
return;
}

const sessionPath = path.join(SESSIONS_DIR, `${sessionId}.json`);
if (!fs.existsSync(sessionPath)) {
console.error(chalk.red(' Session data not found. Please start a new session.'));
return;
}

const spinner = ora(' Pushing session to remote...').start();
try {
const token = process.env.TRAIL_TOKEN || readUserConfig().token;
if (!token) {
throw new Error('TRAIL_TOKEN environment variable is not set');
}

const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
if (!sessionData.steps || sessionData.steps.length === 0) {
throw new Error('Session has no recorded steps. Use `trail record start` first.');
}
if (!sessionData.metadata) {
sessionData.metadata = {
createdAt: new Date().toISOString(),
updatedAt: new Date().toISOString(),
status: 'active'
};
}

try {
const { execSync } = await import('child_process');
sessionData.git = {
branch: execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim(),
commit: execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim(),
remote: execSync('git remote get-url origin', { encoding: 'utf-8' }).trim()
};
} catch (e) {
}

const response = await axios({
method: 'POST',
url: `${API_BASE_URL}/api/sessions`,
data: sessionData,
headers: {
'Content-Type': 'application/json',
'Authorization': `Bearer ${token}`
},
timeout: 30000 
});

spinner.succeed(' Session pushed successfully!');
console.log(`\n Share this session ID with your team: ${chalk.green(sessionId)}`);
console.log(`   Team members can access it with: ${chalk.cyan(`trail checkout ${sessionId}`)}`);
console.log(`\n${chalk.dim('View in browser:')} ${chalk.blue(`${API_BASE_URL}/sessions/${sessionId}`)}`);
} catch (error) {
spinner.fail(' Failed to push session');

if (error.response) {
console.error(chalk.red(`\nError: ${error.response.data?.error || error.response.statusText}`));
if (error.response.status === 401) {
console.log(chalk.yellow('\nPlease ensure your TRAIL_TOKEN is valid and has the correct permissions.'));
}
} else if (error.request) {
console.error(chalk.red('\nCould not connect to the server. Please check your internet connection.'));
} else {
console.error(chalk.red(`\nError: ${error.message}`));
}

if (error.config) {
console.log(chalk.dim(`\nRequest URL: ${error.config.url}`));
}
}
});

program
  .command('help')
  .description('Show help information')
  .action(() => {
    console.log('\n' + chalk.bold('Trail - Your git for debugging!\n'));
    console.log(chalk.underline('Available commands:'));
    console.log('  start       Start a new debugging session');
    console.log('  which       Show current debugging session ID');
    console.log('  lookup      Lookup resolutions for current error');
    console.log('  checkout    Checkout a specific debugging session');
    console.log('  resolve     Mark session as resolved');
    console.log('  end         End the current debugging session');
    console.log('  push        Push session to remote for sharing');
    console.log('  ai          Get AI suggestions');
    console.log('  record      Record debugging session');
    console.log('  replay      Replay a debugging session');
    console.log('  help        Show this help message\n');
    console.log(chalk.dim('Run `trail <command> --help` for more information on a command.'));
  });

program
  .name('trail')
  .description('Trail - Your git for debugging')
  .version('1.0.0');
if (process.argv.length <= 2) {
  program.help();
}

program.parse(process.argv);
