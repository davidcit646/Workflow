#!/bin/bash

unset ELECTRON_RUN_AS_NODE

# Workflow App Launcher
# Quick start script for debugging the Electron application

echo "Starting Workflow App..."
echo "============================"

# Check if we're in the right directory
if [ ! -f "package.json" ] || [ ! -f "main.js" ]; then
    echo "Error: Please run this script from the project root directory"
    echo "   (where package.json and main.js are located)"
    exit 1
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed"
    exit 1
fi

# Check if Python is installed
if ! command -v python3 &> /dev/null && ! command -v python &> /dev/null; then
    echo "Error: Python is not installed"
    exit 1
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        echo "Error: Failed to install dependencies"
        exit 1
    fi
fi

echo "Environment check passed"
echo "Starting Electron application..."
echo ""

# Start the application
npm start

echo ""
echo "Application stopped"
