import React, { useState, useEffect } from 'react';
import PostTranscriptionService, { TranscriptionResult } from '../services/postTranscriptionService';

interface TranscriptViewerProps {
  sessionId?: string;
  transcript?: string;
  isProcessing?: boolean;
}

export const TranscriptViewer: React.FC<TranscriptViewerProps> = ({ 
  sessionId, 
  transcript,
  isProcessing = false 
}) => {
  const [savedTranscripts, setSavedTranscripts] = useState<Array<{ sessionId: string; timestamp: number; text: string }>>([]);
  const [selectedTranscript, setSelectedTranscript] = useState<TranscriptionResult | null>(null);
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    // Load saved transcripts
    const service = new PostTranscriptionService();
    const transcripts = service.getAllSavedTranscripts();
    setSavedTranscripts(transcripts);
  }, [transcript]); // Refresh when new transcript is added

  const loadTranscript = (loadSessionId: string) => {
    const service = new PostTranscriptionService();
    const loaded = service.loadTranscript(loadSessionId);
    if (loaded) {
      setSelectedTranscript(loaded);
    }
  };

  const formatTimestamp = (ms: number): string => {
    const date = new Date(ms);
    return date.toLocaleString();
  };

  if (isProcessing) {
    return (
      <div className="bg-gray-900 rounded-lg p-6">
        <div className="flex items-center space-x-3">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
          <p className="text-gray-300">Processing audio and generating transcript...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-lg p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-white">Presentation Transcript</h2>
        <button
          onClick={() => setShowSaved(!showSaved)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
        >
          {showSaved ? 'Hide' : 'View'} Saved Transcripts ({savedTranscripts.length})
        </button>
      </div>

      {showSaved && savedTranscripts.length > 0 && (
        <div className="bg-gray-800 rounded-lg p-4 space-y-2 max-h-60 overflow-y-auto">
          <h3 className="text-sm font-semibold text-gray-400 mb-2">Previous Sessions</h3>
          {savedTranscripts.map((saved) => (
            <div
              key={saved.sessionId}
              onClick={() => loadTranscript(saved.sessionId)}
              className="p-3 bg-gray-700 hover:bg-gray-600 rounded cursor-pointer transition-colors"
            >
              <div className="text-xs text-gray-400">{formatTimestamp(saved.timestamp)}</div>
              <div className="text-sm text-gray-200 truncate">{saved.text}</div>
            </div>
          ))}
        </div>
      )}

      {(transcript || selectedTranscript) && (
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-semibold text-gray-400">
              {selectedTranscript ? 'Saved Transcript' : 'Current Transcript'}
            </h3>
            {transcript && (
              <button
                onClick={() => {
                  const blob = new Blob([transcript], { type: 'text/plain' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `transcript-${sessionId || Date.now()}.txt`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
              >
                Download
              </button>
            )}
          </div>
          
          <div className="prose prose-invert max-w-none">
            {selectedTranscript ? (
              <div className="space-y-3">
                {selectedTranscript.segments.map((segment, idx) => (
                  <div key={idx} className="flex gap-3">
                    <span className="text-xs text-gray-500 mt-1">
                      {Math.floor(segment.start / 60)}:{(segment.start % 60).toFixed(0).padStart(2, '0')}
                    </span>
                    <p className="text-gray-200 flex-1">{segment.text}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-gray-200 whitespace-pre-wrap">
                {transcript}
              </div>
            )}
          </div>
        </div>
      )}

      {!transcript && !selectedTranscript && !showSaved && (
        <div className="text-center py-8 text-gray-500">
          <p>No transcript available yet.</p>
          <p className="text-sm mt-2">Complete a presentation to generate a transcript.</p>
        </div>
      )}
    </div>
  );
};

export default TranscriptViewer;
