# Trail CLI

A powerful command-line tool for collaborative debugging and issue resolution. Trail helps you track, share, and resolve coding issues with your team.

## Features

- **Session Management**: Start, track, and end debugging sessions
- **AI-Powered Help**: Get intelligent suggestions for fixing errors
- **Collaboration**: Share debugging sessions with your team
- **History**: Replay past debugging sessions
- **Git Integration**: Works seamlessly with your git repository

## Installation

### Using Homebrew (Recommended)

```bash
brew install trail
```

### Manual Installation

1. Make sure you have Node.js (v16 or later) installed
2. Install the package globally:

```bash
npm install -g @trail/cli
```

## Development

### Prerequisites

- Node.js v16 or later
- npm v7 or later
- Git

### Building from Source

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/trail.git
   cd trail/packages/trail-cli
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the project:
   ```bash
   npm run build
   ```
   This will run the linter and verify the code quality.

4. Link the package for local development:
   ```bash
   npm link
   ```
   This will make the `trail` command available globally on your system.

### Development Workflow

- Run linting:
  ```bash
  npm run lint
  ```
  
- Automatically fix linting issues:
  ```bash
  npm run lint:fix
  ```

- Run tests (when available):
  ```bash
  npm test
  ```

### Building for Distribution

1. Update the version in `package.json`
2. Run the build process:
   ```bash
   npm run build
   ```
3. Publish to npm (requires authentication):
   ```bash
   npm publish --access public
   ```

## Getting Started

### Start a New Session

```bash
trail start
```

### Look Up Solutions

```bash
# Automatically detect errors in your code
trail lookup

# Or provide specific error details
trail lookup -e "Your error message" -f path/to/file.js
```

### Get AI Help

```bash
# Get AI-powered debugging help
trail ai

# Or provide specific error details
trail ai -e "Your error message" -f path/to/file.js

# Use a specific AI model
trail ai --model ollama/llama2
```

### Record Debugging Steps

```bash
# Start recording
trail record start

# Run your debugging commands...

# Stop recording
trail record stop
```

### Replay a Session

```bash
# Replay current session
trail replay

# Replay specific session
trail replay <session-id>
```

### Share Your Session

```bash
# Push session to remote
trail push

# Share the session ID with your team
```

## Commands

```
$ trail --help
Usage: trail [options] [command]

Trail - Your git for debugging

Options:
  -V, --version              output the version number
  -h, --help                 display help for command

Commands:
  start                      Start a new debugging session
  which                      Show current debugging session ID
  lookup                     Look up a resolution for an error from your team or AI.
  checkout <session_id>       Checkout a specific debugging session
  resolve                    Mark session as resolved
  end                        End the current debugging session
  push                       Push the current session to remote for sharing
  ai                         Get AI-powered suggestions for current issue
  record                     Record debugging steps in current session
  replay [sessionId]          Replay a recorded debugging session
  login                      Log in to Trail service
  help [command]             display help for command
```

## Configuration

Trail stores its configuration in `~/.trail/config.json`. You can customize the following settings:

- `activeSession`: The currently active debugging session
- `token`: Authentication token for the Trail service

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request

## License

MIT
