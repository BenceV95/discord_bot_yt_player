#!/bin/bash

echo "🚀 Deploying slash commands..."
node deploy-commands.js

echo "🎧 Starting Discord bot..."
node index.js