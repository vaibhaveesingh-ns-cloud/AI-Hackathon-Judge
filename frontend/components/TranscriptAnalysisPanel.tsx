import React from 'react';
import { TranscriptionEntry } from '../types';
import { analyzeTranscript, generateTranscriptInsights, compareTranscriptSections, TranscriptAnalysis } from '../services/transcriptAnalysisService';

interface TranscriptAnalysisPanelProps {
  transcriptionHistory: TranscriptionEntry[];
  showComparison?: boolean;
}

export const TranscriptAnalysisPanel: React.FC<TranscriptAnalysisPanelProps> = ({
  transcriptionHistory,
  showComparison = false
}) => {
  const presentationAnalysis = analyzeTranscript(transcriptionHistory, 'presentation');
  const qaAnalysis = analyzeTranscript(transcriptionHistory, 'q&a');
  const overallAnalysis = analyzeTranscript(transcriptionHistory, 'all');
  
  const presentationInsights = generateTranscriptInsights(presentationAnalysis);
  const qaInsights = generateTranscriptInsights(qaAnalysis);
  const comparisons = showComparison ? compareTranscriptSections(presentationAnalysis, qaAnalysis) : [];
  
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  
  const renderAnalysisCard = (title: string, analysis: TranscriptAnalysis, insights: string[]) => (
    <div className="bg-gray-800 rounded-lg p-4 space-y-3">
      <h3 className="text-lg font-semibold text-white">{title}</h3>
      
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="space-y-1">
          <div className="flex justify-between">
            <span className="text-gray-400">Words Spoken:</span>
            <span className="text-white font-medium">{analysis.totalWords}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Speaking Time:</span>
            <span className="text-white font-medium">{formatDuration(analysis.speakingDuration)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Words/Minute:</span>
            <span className="text-white font-medium">{Math.round(analysis.wordsPerMinute)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Filler Words:</span>
            <span className={`font-medium ${analysis.fillerWordCount > 10 ? 'text-yellow-400' : 'text-green-400'}`}>
              {analysis.fillerWordCount}
            </span>
          </div>
        </div>
        
        <div className="space-y-1">
          <div className="flex justify-between">
            <span className="text-gray-400">Clarity:</span>
            <span className={`font-medium ${analysis.clarityScore > 70 ? 'text-green-400' : analysis.clarityScore > 50 ? 'text-yellow-400' : 'text-red-400'}`}>
              {Math.round(analysis.clarityScore)}%
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Coherence:</span>
            <span className={`font-medium ${analysis.coherenceScore > 70 ? 'text-green-400' : analysis.coherenceScore > 50 ? 'text-yellow-400' : 'text-red-400'}`}>
              {Math.round(analysis.coherenceScore)}%
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Vocabulary:</span>
            <span className={`font-medium ${analysis.vocabularyRichness > 0.3 ? 'text-green-400' : 'text-yellow-400'}`}>
              {(analysis.vocabularyRichness * 100).toFixed(1)}%
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Pauses:</span>
            <span className="text-white font-medium">{analysis.pauseCount}</span>
          </div>
        </div>
      </div>
      
      {analysis.keyTopics.length > 0 && (
        <div>
          <p className="text-gray-400 text-sm mb-1">Key Topics:</p>
          <div className="flex flex-wrap gap-1">
            {analysis.keyTopics.slice(0, 6).map((topic, i) => (
              <span key={i} className="px-2 py-1 bg-blue-900 text-blue-200 rounded text-xs">
                {topic}
              </span>
            ))}
          </div>
        </div>
      )}
      
      {analysis.technicalTermsUsed.length > 0 && (
        <div>
          <p className="text-gray-400 text-sm mb-1">Technical Terms:</p>
          <div className="flex flex-wrap gap-1">
            {analysis.technicalTermsUsed.slice(0, 6).map((term, i) => (
              <span key={i} className="px-2 py-1 bg-purple-900 text-purple-200 rounded text-xs">
                {term}
              </span>
            ))}
          </div>
        </div>
      )}
      
      {insights.length > 0 && (
        <div className="border-t border-gray-700 pt-3">
          <p className="text-gray-400 text-sm mb-2">Insights:</p>
          <ul className="space-y-1">
            {insights.map((insight, i) => (
              <li key={i} className="text-sm text-gray-300 flex items-start">
                <span className="text-blue-400 mr-2">•</span>
                <span>{insight}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
  
  return (
    <div className="space-y-4">
      <div className="bg-gray-900 rounded-lg p-4">
        <h2 className="text-xl font-bold text-white mb-4">Transcript Analysis</h2>
        
        {transcriptionHistory.length === 0 ? (
          <p className="text-gray-400">No transcript data available yet. Start speaking to see analysis.</p>
        ) : (
          <div className="space-y-4">
            {presentationAnalysis.totalWords > 0 && 
              renderAnalysisCard('Presentation Analysis', presentationAnalysis, presentationInsights)
            }
            
            {qaAnalysis.totalWords > 0 && 
              renderAnalysisCard('Q&A Analysis', qaAnalysis, qaInsights)
            }
            
            {presentationAnalysis.totalWords === 0 && qaAnalysis.totalWords === 0 &&
              renderAnalysisCard('Overall Analysis', overallAnalysis, generateTranscriptInsights(overallAnalysis))
            }
            
            {showComparison && comparisons.length > 0 && (
              <div className="bg-gray-800 rounded-lg p-4">
                <h3 className="text-lg font-semibold text-white mb-3">Comparative Insights</h3>
                <ul className="space-y-2">
                  {comparisons.map((comparison, i) => (
                    <li key={i} className="text-sm text-gray-300 flex items-start">
                      <span className="text-green-400 mr-2">→</span>
                      <span>{comparison}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default TranscriptAnalysisPanel;
