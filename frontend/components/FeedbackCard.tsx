import React, { useMemo } from 'react';
import { PresentationFeedback, ScoreBreakdown } from '../types';

const scoreLabels: Record<keyof ScoreBreakdown, string> = {
  clarity: 'Clarity',
  engagement: 'Engagement',
  structure: 'Structure',
  delivery: 'Delivery',
  audienceConnection: 'Audience Connection',
  slideUsage: 'Slide Usage',
};

const scoreOrder: (keyof ScoreBreakdown)[] = [
  'clarity',
  'engagement',
  'structure',
  'delivery',
  'audienceConnection',
  'slideUsage',
];

const getScoreDescriptor = (score: number) => {
  if (score >= 9) return 'Outstanding';
  if (score >= 7.5) return 'Strong';
  if (score >= 6) return 'Solid';
  if (score >= 4.5) return 'Needs refinement';
  return 'Focus area';
};

const getScoreColor = (score: number) => {
  if (score >= 7.5) return 'bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/40';
  if (score >= 6) return 'bg-amber-500/10 text-amber-300 ring-1 ring-amber-500/40';
  return 'bg-rose-500/10 text-rose-300 ring-1 ring-rose-500/30';
};

const FeedbackCard: React.FC<{ feedback: PresentationFeedback | null }> = ({ feedback }) => {
  if (!feedback) return null;

  const scoreEntries = useMemo(
    () =>
      scoreOrder
        .filter((key) => key in feedback.scoreBreakdown)
        .map((key) => [key, feedback.scoreBreakdown[key]] as [keyof ScoreBreakdown, number]),
    [feedback.scoreBreakdown]
  );

  return (
    <div className="bg-slate-950/70 backdrop-blur-md border border-slate-800/70 rounded-3xl shadow-2xl px-8 py-10 max-w-6xl w-full text-slate-200 animate-fade-in">
      <header className="text-center mb-10">
        <h2 className="text-4xl font-extrabold tracking-tight text-slate-50 mb-3">Presentation Feedback</h2>
        <p className="text-slate-400 text-lg">Detailed AI insights on your recent presentation performance.</p>
      </header>

      <section className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 mb-10 shadow-inner">
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-8">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 flex items-center justify-center rounded-2xl bg-indigo-500/10 border border-indigo-500/40 text-indigo-200">
              <i className="fas fa-star text-2xl"></i>
            </div>
            <div>
              <h3 className="text-sm uppercase tracking-wider text-indigo-300 mb-2">Overall Score</h3>
              <div className="flex items-baseline gap-2">
                <span className="text-5xl font-bold text-indigo-200 leading-none">{feedback.overallScore.toFixed(1)}</span>
                <span className="text-sm text-slate-500">/ 10</span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 flex-1 w-full">
            {scoreEntries.map(([category, score]) => (
              <div
                key={category}
                className="bg-slate-800/70 border border-slate-700 rounded-xl px-4 py-3 flex flex-col gap-1 min-w-0 shadow-sm"
              >
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{scoreLabels[category]}</span>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-slate-100">{score.toFixed(1)}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${getScoreColor(score)}`}>{getScoreDescriptor(score)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <p className="mt-6 text-slate-300 leading-relaxed">{feedback.overallSummary}</p>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-6">
          <h3 className="text-xl font-semibold text-emerald-300 mb-4 flex items-center gap-3">
            <i className="fas fa-thumbs-up"></i>
            Strengths
          </h3>
          <div className="space-y-3">
            {feedback.strengths.map((item, index) => (
              <div key={index} className="bg-slate-950/40 border border-emerald-500/20 rounded-xl p-4 text-sm text-slate-200">
                {item}
              </div>
            ))}
          </div>
        </div>

        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-6">
          <h3 className="text-xl font-semibold text-amber-300 mb-4 flex items-center gap-3">
            <i className="fas fa-lightbulb"></i>
            Areas for Improvement
          </h3>
          <div className="space-y-3">
            {feedback.areasForImprovement.map((item, index) => (
              <div key={index} className="bg-slate-950/40 border border-amber-500/20 rounded-xl p-4 text-sm text-slate-200">
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 mb-10">
        <div className="flex items-center gap-3 mb-6">
          <i className="fas fa-clipboard-check text-indigo-300 text-lg"></i>
          <h3 className="text-2xl font-semibold text-slate-100">Detailed Feedback</h3>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {scoreEntries.map(([category, score]) => {
            const descriptor = getScoreDescriptor(score);
            const reason = feedback.scoreReasons?.[category] ?? 'No additional context provided.';

            return (
              <details
                key={category}
                className="group bg-slate-950/50 border border-slate-800/70 rounded-2xl transition-all hover:border-indigo-500/40"
              >
                <summary className="cursor-pointer list-none flex items-center justify-between gap-4 px-5 py-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-2 w-2 rounded-full bg-indigo-400"></span>
                      <p className="text-lg font-semibold text-slate-100">{scoreLabels[category]}</p>
                    </div>
                    <p className="text-sm text-slate-400">{descriptor}</p>
                  </div>
                  <span className="text-2xl font-bold text-indigo-200">{score.toFixed(1)}</span>
                </summary>
                <div className="px-5 pb-5 text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{reason}</div>
              </details>
            );
          })}
        </div>
      </section>

      <section className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 mb-8">
        <div className="flex items-center gap-3 mb-4">
          <i className="fas fa-question-circle text-sky-300 text-lg"></i>
          <h3 className="text-2xl font-semibold text-slate-100">Relevant Questions</h3>
        </div>
        <p className="text-sm text-slate-400 mb-5">Here are the top questions your audience is likely to ask.</p>
        <div className="space-y-3">
          {feedback.questionsAsked.length > 0 ? (
            feedback.questionsAsked.map((question, index) => (
              <div
                key={index}
                className="bg-slate-950/50 border border-sky-500/20 rounded-xl px-5 py-4 text-sm text-slate-200 flex items-start gap-3"
              >
                <span className="text-sky-300 mt-1">
                  <i className="fas fa-comment-dots"></i>
                </span>
                <span>{question}</span>
              </div>
            ))
          ) : (
            <p className="text-slate-400">No audience questions were generated for this session.</p>
          )}
        </div>
      </section>

      <div className="flex justify-center">
        <button
          type="button"
          className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-500 hover:bg-indigo-400 text-slate-50 font-semibold rounded-full shadow-lg shadow-indigo-500/20 transition focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500/70 focus:ring-offset-slate-950"
          onClick={() => window.print()}
        >
          <i className="fas fa-download"></i>
          Download Full Report
        </button>
      </div>
    </div>
  );
};

export default FeedbackCard;
