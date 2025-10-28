#!/usr/bin/env python3
"""
Test script to verify video upload and transcription
"""
import requests
import sys
from pathlib import Path

def test_video_upload(video_path):
    """Test uploading a video file to the transcription endpoint"""
    
    # Check if file exists
    if not Path(video_path).exists():
        print(f"Error: File {video_path} does not exist")
        return
    
    # Prepare the request
    url = "http://localhost:8000/transcribe"
    
    with open(video_path, 'rb') as f:
        files = {
            'audio': (Path(video_path).name, f, 'video/mp4')
        }
        data = {
            'start_ms': 0,
            'duration_ms': 0
        }
        
        print(f"Uploading {video_path} to {url}")
        print(f"File size: {Path(video_path).stat().st_size / 1024 / 1024:.2f} MB")
        
        try:
            response = requests.post(url, files=files, data=data)
            
            print(f"Response status: {response.status_code}")
            
            if response.status_code == 200:
                result = response.json()
                print("Success!")
                print(f"Transcription text length: {len(result.get('text', ''))}")
                print(f"Number of segments: {len(result.get('segments', []))}")
                if result.get('text'):
                    print(f"First 200 chars: {result['text'][:200]}...")
            else:
                print(f"Error: {response.text}")
                
        except Exception as e:
            print(f"Request failed: {e}")

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python test_video_upload.py <video_file_path>")
        sys.exit(1)
    
    test_video_upload(sys.argv[1])
