import React, { useState, useRef } from 'react';
import VideoOptimizationService from '../services/videoOptimizationService';

interface VideoUploadProps {
  onVideoProcessed: (videoFile: File, extractedFrames: string[], duration: number) => void;
  isProcessing: boolean;
}

export const VideoUpload: React.FC<VideoUploadProps> = ({ onVideoProcessed, isProcessing }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [extractionProgress, setExtractionProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleVideoFile(files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleVideoFile(files[0]);
    }
  };

  const handleVideoFile = async (file: File) => {
    // Validate video using optimization service
    const validation = await VideoOptimizationService.validateVideo(file);
    
    if (!validation.valid) {
      alert(validation.error);
      return;
    }
    
    // Show warnings if any
    if (validation.warnings) {
      validation.warnings.forEach(warning => {
        console.warn('[VideoUpload]', warning);
      });
    }
    
    // Log file info
    console.log(`[VideoUpload] Processing video: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)}MB)`);
    
    // Check if optimization is needed
    if (VideoOptimizationService.needsOptimization(file)) {
      console.log('[VideoUpload] Large file detected, optimization recommended');
    }

    setVideoFile(file);
    
    // Create preview URL
    const url = URL.createObjectURL(file);
    setVideoPreview(url);

    // Extract frames and process video
    await extractFramesFromVideo(file, url);
  };

  const extractFramesFromVideo = async (file: File, videoUrl: string) => {
    return new Promise<void>((resolve) => {
      const video = document.createElement('video');
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        console.error('Could not get canvas context');
        resolve();
        return;
      }

      video.src = videoUrl;
      video.muted = true;
      
      const frames: string[] = [];
      const frameInterval = 5; // Extract frame every 5 seconds
      let currentTime = 0;
      
      video.addEventListener('loadedmetadata', () => {
        const duration = video.duration;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        const extractFrame = () => {
          if (currentTime > duration) {
            // Finished extracting frames
            onVideoProcessed(file, frames, duration);
            setExtractionProgress(100);
            resolve();
            return;
          }
          
          video.currentTime = currentTime;
          setExtractionProgress((currentTime / duration) * 100);
        };
        
        video.addEventListener('seeked', () => {
          // Draw current frame to canvas
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          
          // Convert to base64
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
          const base64 = dataUrl.split(',')[1];
          frames.push(base64);
          
          // Move to next frame
          currentTime += frameInterval;
          extractFrame();
        });
        
        // Start extraction
        extractFrame();
      });
      
      video.load();
    });
  };

  const removeVideo = () => {
    if (videoPreview) {
      URL.revokeObjectURL(videoPreview);
    }
    setVideoFile(null);
    setVideoPreview(null);
    setExtractionProgress(0);
  };

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 shadow-2xl">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-slate-100">Upload Video Presentation</h3>
        <p className="text-xs uppercase tracking-wide text-slate-500 mt-1">
          Upload a pre-recorded presentation for analysis
        </p>
      </div>

      {!videoFile ? (
        <div
          className={`relative border-2 border-dashed rounded-2xl p-8 text-center transition-all ${
            isDragging
              ? 'border-indigo-500 bg-indigo-500/10'
              : 'border-slate-700 hover:border-slate-600 bg-slate-950/40'
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            onChange={handleFileSelect}
            className="hidden"
            disabled={isProcessing}
          />
          
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-indigo-500/20 flex items-center justify-center">
              <i className="fas fa-video text-indigo-400 text-2xl"></i>
            </div>
            
            <div>
              <p className="text-slate-200 font-medium mb-1">
                Drop your video here or click to browse
              </p>
              <p className="text-slate-500 text-sm">
                Supported formats: MP4, WebM, MOV (max 1.5GB)
              </p>
            </div>
            
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-6 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl transition-colors font-medium text-sm"
              disabled={isProcessing}
            >
              Select Video
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {videoPreview && (
            <div className="relative rounded-xl overflow-hidden bg-black">
              <video
                ref={videoRef}
                src={videoPreview}
                controls
                className="w-full max-h-64 object-contain"
              />
              
              {!isProcessing && (
                <button
                  type="button"
                  onClick={removeVideo}
                  className="absolute top-2 right-2 w-8 h-8 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center transition-colors"
                >
                  <i className="fas fa-times"></i>
                </button>
              )}
            </div>
          )}
          
          <div className="bg-slate-950/60 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-slate-300 font-medium">
                {videoFile.name}
              </span>
              <span className="text-xs text-slate-500">
                {(videoFile.size / (1024 * 1024)).toFixed(2)} MB
              </span>
            </div>
            
            {extractionProgress > 0 && extractionProgress < 100 && (
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                  <span>Extracting frames...</span>
                  <span>{Math.round(extractionProgress)}%</span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-2">
                  <div
                    className="bg-indigo-500 h-2 rounded-full transition-all"
                    style={{ width: `${extractionProgress}%` }}
                  />
                </div>
              </div>
            )}
            
            {extractionProgress === 100 && (
              <div className="mt-3 flex items-center gap-2 text-sm text-green-400">
                <i className="fas fa-check-circle"></i>
                <span>Video ready for analysis</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoUpload;
