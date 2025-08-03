# Changelog

All notable changes to the Trail CLI will be documented in this file.

## [Unreleased]

### Added
- Automatic error detection for `trail lookup` and `trail ai` commands
- Enhanced `trail replay` with IDE debug console, variables, and watch section support
- New `trail push` command for sharing sessions remotely
- New `trail end` command to properly close debugging sessions
- AI integration with Ollama/Copilot for real-time debugging suggestions
- Improved error handling and user feedback
- Comprehensive build and development documentation

### Changed
- Consolidated CLI entry points into a single `cli.js` file
- Removed `trail login` command in favor of environment variable authentication
- Updated dependencies to their latest versions
- Improved command-line interface and help text

### Fixed
- Fixed `trail push` command to properly upload sessions
- Resolved various linting and syntax issues
- Improved error handling for network requests
- Fixed session management issues

## [1.0.0] - 2025-08-03

### Added
- Initial release of Trail CLI
- Core debugging session management
- Basic AI-powered error resolution
- Session recording and replay functionality
