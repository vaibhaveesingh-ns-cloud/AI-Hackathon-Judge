import React from 'react';
import { PresentationFeedback, ScoreBreakdown } from '../types';

const categoryIcons: Record<keyof ScoreBreakdown, string> = {
  Structure: 'fas fa-sitemap',
  Clarity: 'fas fa-bullseye',
  Engagement: 'fas fa-comments',
  Delivery: 'fas fa-microphone-alt',
  'Slide Usage': 'fas fa-file-powerpoint',
  'Q&A': 'fas fa-question-circle',
};

const OverallScoreDonut: React.FC<{ score: number }> = ({ score }) => {
  const normalizedScore = score / 10;
  const circumference = 2 * Math.PI * 52;
  const offset = circumference - normalizedScore * circumference;

  const color = score > 7 ? 'stroke-green-400' : score > 4 ? 'stroke-yellow-400' : 'stroke-red-400';
  const textColor = score > 7 ? 'text-green-400' : score > 4 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="relative flex items-center justify-center w-52 h-52">
      <svg className="absolute w-full h-full" viewBox="0 0 120 120">
        <circle
          className="stroke-slate-700"
          strokeWidth="10"
          fill="transparent"
          r="52"
          cx="60"
          cy="60"
        />
        <circle
          className={`${color} transition-all duration-1000 ease-out`}
          strokeWidth="10"
          strokeLinecap="round"
          fill="transparent"
          r="52"
          cx="60"
          cy="60"
          style={{
            strokeDasharray: circumference,
            strokeDashoffset: offset,
            transform: 'rotate(-90deg)',
            transformOrigin: '50% 50%',
          }}
        />
      </svg>
      <div className="flex flex-col items-center">
        <span className={`text-5xl font-bold ${textColor}`}>{score.toFixed(1)}</span>
        <span className="text-sm font-medium text-slate-400">Overall Score</span>
      </div>
    </div>
  );
};

const ScoreBar: React.FC<{ label: keyof ScoreBreakdown; score: number }> = ({ label, score }) => {
    const color = score > 7 ? 'bg-green-500' : score > 4 ? 'bg-yellow-500' : 'bg-red-500';
    return (
        <div>
            <div className="flex justify-between items-center mb-1">
                <p className="text-sm font-medium text-slate-300">{label}</p>
                <p className="text-sm font-bold text-slate-200">{score.toFixed(1)}</p>
            </div>
            <div className="w-full bg-slate-700 rounded-full h-2">
                <div className={`${color} h-2 rounded-full transition-all duration-1000 ease-out`} style={{ width: `${score * 10}%` }}></div>
            </div>
        </div>
    );
};

const FeedbackCard: React.FC<{ feedback: PresentationFeedback | null }> = ({ feedback }) => {
  if (!feedback) return null;

  return (
    <div className="bg-slate-900/50 backdrop-blur-sm border border-slate-800 rounded-2xl shadow-2xl p-8 max-w-4xl w-full animate-fade-in">
      <h2 className="text-4xl font-extrabold text-center text-slate-100 mb-2">Evaluation Scorecard</h2>
      <p className="text-center text-slate-400 mb-8">A dynamic breakdown of your presentation performance.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-10">
        <div className="bg-slate-800/50 p-6 rounded-xl flex flex-col items-center justify-center border border-slate-700">
          <OverallScoreDonut score={feedback.overallScore} />
        </div>
        <div className="bg-slate-800/50 p-6 rounded-xl flex flex-col justify-center space-y-4 border border-slate-700">
            <h3 className="text-xl font-bold text-center text-slate-200 mb-2">Score Breakdown</h3>
            {Object.entries(feedback.scoreBreakdown).map(([key, value]) => (
                <ScoreBar key={key} label={key as keyof ScoreBreakdown} score={value} />
            ))}
        </div>
      </div>
      
      <div className="bg-slate-800/50 p-6 rounded-xl border border-slate-700 mb-8">
        <h3 className="text-xl font-bold text-slate-200 mb-4">Overall Assessment</h3>
        <p className="text-slate-300 leading-relaxed">{feedback.overallSummary}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-green-900/20 border border-green-700/50 p-6 rounded-xl">
          <h3 className="text-xl font-semibold text-green-400 mb-3 flex items-center"><i className="fas fa-thumbs-up mr-3"></i> Strengths</h3>
          <ul className="list-disc list-inside space-y-2 text-slate-300">
            {feedback.strengths.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
        <div className="bg-yellow-900/20 border border-yellow-700/50 p-6 rounded-xl">
          <h3 className="text-xl font-semibold text-yellow-400 mb-3 flex items-center"><i className="fas fa-lightbulb mr-3"></i> Areas for Improvement</h3>
          <ul className="list-disc list-inside space-y-2 text-slate-300">
            {feedback.areasForImprovement.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </div>
      </div>
    </div>
  );
};

export default FeedbackCard;
