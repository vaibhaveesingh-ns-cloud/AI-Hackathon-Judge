import { TranscriptionEntry } from '../types';

export interface TranscriptAnalysis {
  // Content Analysis
  totalWords: number;
  uniqueWords: number;
  vocabularyRichness: number; // unique/total ratio
  averageSentenceLength: number;
  
  // Speaking Patterns
  speakingDuration: number; // in seconds
  wordsPerMinute: number;
  pauseCount: number;
  longPauseCount: number; // pauses > 3 seconds
  fillerWordCount: number;
  
  // Content Structure
  keyTopics: string[];
  technicalTermsUsed: string[];
  transitionPhrases: string[];
  
  // Engagement Indicators
  questionCount: number;
  emphasisCount: number; // exclamations, strong statements
  
  // Clarity Metrics
  clarityScore: number; // 0-100
  coherenceScore: number; // 0-100
}

const FILLER_WORDS = [
  'um', 'uh', 'like', 'you know', 'actually', 'basically', 
  'literally', 'right', 'so', 'well', 'I mean', 'kind of', 
  'sort of', 'you see', 'you know what I mean'
];

const TRANSITION_PHRASES = [
  'first', 'second', 'third', 'next', 'then', 'finally',
  'in conclusion', 'to summarize', 'furthermore', 'moreover',
  'however', 'on the other hand', 'for example', 'for instance',
  'as a result', 'therefore', 'consequently', 'in addition'
];

const TECHNICAL_INDICATORS = [
  'algorithm', 'api', 'framework', 'database', 'architecture',
  'implementation', 'optimization', 'performance', 'scalability',
  'security', 'authentication', 'deployment', 'integration',
  'machine learning', 'artificial intelligence', 'neural network',
  'data structure', 'complexity', 'efficiency', 'latency'
];

export function analyzeTranscript(
  transcriptionHistory: TranscriptionEntry[],
  context: 'presentation' | 'q&a' | 'all' = 'all'
): TranscriptAnalysis {
  // Filter entries based on context
  const entries = context === 'all' 
    ? transcriptionHistory 
    : transcriptionHistory.filter(entry => entry.context === context);
  
  if (entries.length === 0) {
    return getEmptyAnalysis();
  }
  
  // Combine all text
  const fullText = entries.map(entry => entry.text).join(' ');
  const words = fullText.toLowerCase().split(/\s+/).filter(w => w.length > 0);
  const sentences = fullText.split(/[.!?]+/).filter(s => s.trim().length > 0);
  
  // Calculate timing
  const firstEntry = entries[0];
  const lastEntry = entries[entries.length - 1];
  const durationMs = (lastEntry.endMs || 0) - (firstEntry.startMs || 0);
  const durationSeconds = durationMs / 1000;
  
  // Detect pauses (gaps between entries)
  let pauseCount = 0;
  let longPauseCount = 0;
  
  for (let i = 1; i < entries.length; i++) {
    const gap = (entries[i].startMs || 0) - (entries[i-1].endMs || 0);
    if (gap > 1000) { // 1 second pause
      pauseCount++;
      if (gap > 3000) { // 3 second pause
        longPauseCount++;
      }
    }
  }
  
  // Count filler words
  const fillerWordCount = FILLER_WORDS.reduce((count, filler) => {
    const regex = new RegExp(`\\b${filler.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    const matches = fullText.match(regex);
    return count + (matches ? matches.length : 0);
  }, 0);
  
  // Find transition phrases
  const transitionPhrases = TRANSITION_PHRASES.filter(phrase => {
    const regex = new RegExp(`\\b${phrase}\\b`, 'gi');
    return regex.test(fullText);
  });
  
  // Find technical terms
  const technicalTermsUsed = TECHNICAL_INDICATORS.filter(term => {
    const regex = new RegExp(`\\b${term}\\b`, 'gi');
    return regex.test(fullText);
  });
  
  // Extract key topics (simple frequency analysis)
  const wordFrequency = new Map<string, number>();
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'was', 'are', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those', 'i', 'you', 'we', 'they', 'it']);
  
  words.forEach(word => {
    if (word.length > 3 && !stopWords.has(word) && !FILLER_WORDS.includes(word)) {
      wordFrequency.set(word, (wordFrequency.get(word) || 0) + 1);
    }
  });
  
  const keyTopics = Array.from(wordFrequency.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);
  
  // Count questions and emphasis
  const questionCount = (fullText.match(/\?/g) || []).length;
  const emphasisCount = (fullText.match(/!/g) || []).length;
  
  // Calculate clarity score (based on filler words and sentence structure)
  const fillerRatio = fillerWordCount / Math.max(words.length, 1);
  const avgSentenceLength = words.length / Math.max(sentences.length, 1);
  const sentenceLengthPenalty = Math.abs(avgSentenceLength - 15) / 15; // 15 words is ideal
  const clarityScore = Math.max(0, Math.min(100, 
    100 * (1 - fillerRatio * 2) * (1 - sentenceLengthPenalty * 0.5)
  ));
  
  // Calculate coherence score (based on transitions and structure)
  const transitionRatio = transitionPhrases.length / Math.max(sentences.length, 1);
  const pauseRatio = pauseCount / Math.max(entries.length - 1, 1);
  const coherenceScore = Math.max(0, Math.min(100,
    100 * (0.5 + transitionRatio * 2) * (1 - pauseRatio * 0.5)
  ));
  
  // Calculate vocabulary richness
  const uniqueWords = new Set(words);
  const vocabularyRichness = uniqueWords.size / Math.max(words.length, 1);
  
  // Calculate words per minute
  const wordsPerMinute = durationSeconds > 0 
    ? (words.length / durationSeconds) * 60 
    : 0;
  
  return {
    totalWords: words.length,
    uniqueWords: uniqueWords.size,
    vocabularyRichness,
    averageSentenceLength: avgSentenceLength,
    speakingDuration: durationSeconds,
    wordsPerMinute,
    pauseCount,
    longPauseCount,
    fillerWordCount,
    keyTopics,
    technicalTermsUsed,
    transitionPhrases,
    questionCount,
    emphasisCount,
    clarityScore,
    coherenceScore
  };
}

function getEmptyAnalysis(): TranscriptAnalysis {
  return {
    totalWords: 0,
    uniqueWords: 0,
    vocabularyRichness: 0,
    averageSentenceLength: 0,
    speakingDuration: 0,
    wordsPerMinute: 0,
    pauseCount: 0,
    longPauseCount: 0,
    fillerWordCount: 0,
    keyTopics: [],
    technicalTermsUsed: [],
    transitionPhrases: [],
    questionCount: 0,
    emphasisCount: 0,
    clarityScore: 0,
    coherenceScore: 0
  };
}

export function generateTranscriptInsights(analysis: TranscriptAnalysis): string[] {
  const insights: string[] = [];
  
  // Speaking pace insights
  if (analysis.wordsPerMinute > 0) {
    if (analysis.wordsPerMinute < 100) {
      insights.push('Speaking pace is quite slow. Consider speaking more fluently.');
    } else if (analysis.wordsPerMinute > 180) {
      insights.push('Speaking pace is very fast. Consider slowing down for better clarity.');
    } else if (analysis.wordsPerMinute >= 140 && analysis.wordsPerMinute <= 160) {
      insights.push('Excellent speaking pace - clear and engaging.');
    }
  }
  
  // Filler word insights
  if (analysis.totalWords > 0) {
    const fillerRatio = analysis.fillerWordCount / analysis.totalWords;
    if (fillerRatio > 0.05) {
      insights.push(`High use of filler words (${analysis.fillerWordCount} occurrences). Practice to reduce "um", "uh", and "like".`);
    } else if (fillerRatio < 0.02 && analysis.totalWords > 50) {
      insights.push('Excellent fluency with minimal filler words.');
    }
  }
  
  // Pause insights
  if (analysis.longPauseCount > 3) {
    insights.push('Multiple long pauses detected. Consider better preparation or use pauses strategically.');
  }
  
  // Vocabulary insights
  if (analysis.vocabularyRichness > 0.4) {
    insights.push('Rich vocabulary usage demonstrates good command of the topic.');
  } else if (analysis.vocabularyRichness < 0.2 && analysis.totalWords > 100) {
    insights.push('Consider using more varied vocabulary to keep the audience engaged.');
  }
  
  // Structure insights
  if (analysis.transitionPhrases.length > 3) {
    insights.push('Good use of transition phrases for clear structure.');
  } else if (analysis.transitionPhrases.length === 0 && analysis.totalWords > 100) {
    insights.push('Add transition phrases to improve presentation flow.');
  }
  
  // Technical content
  if (analysis.technicalTermsUsed.length > 5) {
    insights.push('Strong technical content. Ensure explanations are accessible to the audience.');
  }
  
  // Engagement
  if (analysis.questionCount > 2) {
    insights.push('Good use of rhetorical questions to engage the audience.');
  }
  
  if (analysis.emphasisCount > 3) {
    insights.push('Effective use of emphasis to highlight key points.');
  }
  
  // Overall scores
  if (analysis.clarityScore > 80) {
    insights.push('Excellent clarity in speech delivery.');
  } else if (analysis.clarityScore < 50) {
    insights.push('Work on speech clarity by reducing fillers and improving sentence structure.');
  }
  
  if (analysis.coherenceScore > 80) {
    insights.push('Very coherent presentation with logical flow.');
  } else if (analysis.coherenceScore < 50) {
    insights.push('Improve presentation coherence with better transitions and structure.');
  }
  
  return insights;
}

export function compareTranscriptSections(
  presentationAnalysis: TranscriptAnalysis,
  qaAnalysis: TranscriptAnalysis
): string[] {
  const comparisons: string[] = [];
  
  if (presentationAnalysis.wordsPerMinute > 0 && qaAnalysis.wordsPerMinute > 0) {
    const paceDiff = Math.abs(presentationAnalysis.wordsPerMinute - qaAnalysis.wordsPerMinute);
    if (paceDiff > 30) {
      if (qaAnalysis.wordsPerMinute > presentationAnalysis.wordsPerMinute) {
        comparisons.push('Speaking pace increased during Q&A - shows confidence in knowledge.');
      } else {
        comparisons.push('Speaking pace decreased during Q&A - may indicate careful consideration of answers.');
      }
    }
  }
  
  if (qaAnalysis.fillerWordCount / Math.max(qaAnalysis.totalWords, 1) > 
      presentationAnalysis.fillerWordCount / Math.max(presentationAnalysis.totalWords, 1) * 1.5) {
    comparisons.push('More filler words during Q&A - practice impromptu speaking.');
  }
  
  if (qaAnalysis.clarityScore > presentationAnalysis.clarityScore + 10) {
    comparisons.push('Improved clarity during Q&A session - excellent adaptability.');
  }
  
  return comparisons;
}
