#!/bin/bash

echo "=== Checking Transcription Configuration ==="
echo ""

# Check if .env files exist
echo "1. Checking environment files..."
if [ -f "frontend/.env" ]; then
    echo "✓ Frontend .env exists"
    # Check for API keys (without showing the actual values)
    if grep -q "VITE_GEMINI_API_KEY=" frontend/.env && grep -q "VITE_GEMINI_API_KEY=your_" frontend/.env; then
        echo "⚠ VITE_GEMINI_API_KEY appears to be a placeholder"
    elif grep -q "VITE_GEMINI_API_KEY=" frontend/.env; then
        echo "✓ VITE_GEMINI_API_KEY is set"
    else
        echo "✗ VITE_GEMINI_API_KEY is missing"
    fi
    
    if grep -q "VITE_OPENAI_API_KEY=" frontend/.env && grep -q "VITE_OPENAI_API_KEY=your_" frontend/.env; then
        echo "⚠ VITE_OPENAI_API_KEY appears to be a placeholder"
    elif grep -q "VITE_OPENAI_API_KEY=" frontend/.env; then
        echo "✓ VITE_OPENAI_API_KEY is set"
    else
        echo "✗ VITE_OPENAI_API_KEY is missing"
    fi
else
    echo "✗ Frontend .env file missing - copy from .env.example"
fi

echo ""

if [ -f "backend/.env" ]; then
    echo "✓ Backend .env exists"
    if grep -q "OPENAI_API_KEY=" backend/.env && grep -q "OPENAI_API_KEY=your_" backend/.env; then
        echo "⚠ OPENAI_API_KEY appears to be a placeholder"
    elif grep -q "OPENAI_API_KEY=" backend/.env; then
        echo "✓ OPENAI_API_KEY is set"
    else
        echo "✗ OPENAI_API_KEY is missing"
    fi
else
    echo "✗ Backend .env file missing - copy from .env.example"
fi

echo ""
echo "2. Checking Docker containers..."
docker compose ps

echo ""
echo "3. Testing backend health..."
curl -s http://localhost:8000/health | jq . || echo "Backend health check failed"

echo ""
echo "=== Recommendations ==="
echo ""
echo "To fix real-time transcription, you need to:"
echo ""
echo "1. Choose your transcription method:"
echo "   Option A: Use OpenAI Realtime API (recommended)"
echo "   - Add OPENAI_API_KEY to backend/.env"
echo "   - The app will use OpenAI's WebSocket for transcription"
echo ""
echo "   Option B: Use Gemini API"
echo "   - Add VITE_GEMINI_API_KEY to frontend/.env"
echo "   - Note: Gemini Live API may have limitations"
echo ""
echo "2. After adding API keys, restart the containers:"
echo "   docker compose down"
echo "   docker compose up --build"
echo ""
echo "3. To switch between Gemini and OpenAI, edit frontend/App.tsx line 681:"
echo "   const useGemini = false;  // Set to false for OpenAI, true for Gemini"
echo ""
echo "4. Check browser console for errors when starting a presentation"
