/**
 * Service for optimizing video files before upload
 */

export class VideoOptimizationService {
  /**
   * Check if video needs optimization
   */
  static needsOptimization(file: File): boolean {
    const MAX_OPTIMAL_SIZE = 100 * 1024 * 1024; // 100MB
    return file.size > MAX_OPTIMAL_SIZE;
  }

  /**
   * Get video metadata using HTML5 video element
   */
  static async getVideoMetadata(file: File): Promise<{
    duration: number;
    width: number;
    height: number;
    hasAudio: boolean;
  }> {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      const url = URL.createObjectURL(file);
      
      video.preload = 'metadata';
      
      video.onloadedmetadata = () => {
        // Check for audio tracks
        const hasAudio = (video as any).mozHasAudio || 
                        Boolean((video as any).webkitAudioDecodedByteCount) ||
                        Boolean((video as any).audioTracks?.length);
        
        const metadata = {
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
          hasAudio: hasAudio !== false // Default to true if we can't detect
        };
        
        URL.revokeObjectURL(url);
        resolve(metadata);
      };
      
      video.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load video metadata'));
      };
      
      video.src = url;
    });
  }

  /**
   * Estimate processing time based on file size and duration
   */
  static estimateProcessingTime(fileSize: number, duration: number): number {
    // Base estimate: 1 second per 10MB + 0.5 seconds per second of video
    const sizeBasedTime = (fileSize / (10 * 1024 * 1024)) * 1000; // ms
    const durationBasedTime = duration * 500; // ms
    
    return Math.max(sizeBasedTime, durationBasedTime);
  }

  /**
   * Validate video file before processing
   */
  static async validateVideo(file: File): Promise<{
    valid: boolean;
    error?: string;
    warnings?: string[];
  }> {
    const warnings: string[] = [];
    
    // Check file size
    const MAX_SIZE = 1.5 * 1024 * 1024 * 1024; // 1.5GB
    if (file.size > MAX_SIZE) {
      return {
        valid: false,
        error: `File size (${(file.size / (1024 * 1024 * 1024)).toFixed(2)}GB) exceeds maximum allowed size of 1.5GB`
      };
    }
    
    // Check file type
    if (!file.type.startsWith('video/')) {
      return {
        valid: false,
        error: 'File is not a video'
      };
    }
    
    try {
      const metadata = await this.getVideoMetadata(file);
      
      // Check if video has audio
      if (!metadata.hasAudio) {
        warnings.push('Video appears to have no audio track. Transcription may fail.');
      }
      
      // Check duration
      if (metadata.duration > 3600) { // 1 hour
        warnings.push(`Video is ${Math.round(metadata.duration / 60)} minutes long. Processing may take a while.`);
      }
      
      // Check resolution
      if (metadata.width > 1920 || metadata.height > 1080) {
        warnings.push('Video resolution is higher than 1080p. Consider reducing resolution for faster processing.');
      }
      
      return {
        valid: true,
        warnings: warnings.length > 0 ? warnings : undefined
      };
    } catch (error) {
      return {
        valid: false,
        error: 'Failed to read video file. File may be corrupted.'
      };
    }
  }

  /**
   * Create a preview/thumbnail from video
   */
  static async createThumbnail(file: File, timestamp: number = 2): Promise<string> {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        reject(new Error('Could not get canvas context'));
        return;
      }
      
      const url = URL.createObjectURL(file);
      
      video.onloadedmetadata = () => {
        video.currentTime = Math.min(timestamp, video.duration / 2);
      };
      
      video.onseeked = () => {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        const thumbnailUrl = canvas.toDataURL('image/jpeg', 0.7);
        URL.revokeObjectURL(url);
        resolve(thumbnailUrl);
      };
      
      video.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to create thumbnail'));
      };
      
      video.src = url;
    });
  }
}

export default VideoOptimizationService;
