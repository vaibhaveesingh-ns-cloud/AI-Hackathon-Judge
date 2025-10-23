import React from 'react';
import type { SessionEngagementAnalysis } from '../types';

type Props = {
  analysis: SessionEngagementAnalysis | null;
  isPending: boolean;
};

const formatTimestamp = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

const EngagementDashboard: React.FC<Props> = ({ analysis, isPending }) => {
  if (isPending) {
    return (
      <section className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 shadow-2xl">
        <div className="flex items-center gap-3 text-indigo-300">
          <i className="fas fa-spinner fa-spin" />
          <h3 className="text-lg font-semibold">Processing Engagement Metrics...</h3>
        </div>
        <p className="mt-3 text-sm text-slate-400">
          We are analyzing facial expressions and vocal cues to build the engagement timeline.
        </p>
      </section>
    );
  }

  if (!analysis) {
    return null;
  }

  const { summary, presenterTimeline, audienceTimeline, voiceTimeline } = analysis;

  return (
    <section className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-100">Engagement Intelligence</h3>
          <p className="text-xs uppercase tracking-wide text-slate-500">
            MediaPipe facemesh &amp; openSMILE insights
          </p>
        </div>
        <span className="text-xs text-slate-400">
          Generated {new Date(summary.generatedAt).toLocaleString()}
        </span>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="bg-slate-950/50 border border-slate-800 rounded-2xl p-4">
          <h4 className="text-sm font-semibold text-indigo-300 uppercase tracking-wide mb-2">
            Presenter Snapshot
          </h4>
          <ul className="space-y-1 text-sm text-slate-300">
            <li>Dominant emotion: <strong className="text-indigo-200">{summary.presenterDominantEmotion}</strong></li>
            <li>Average smile score: {summary.averagePresenterSmile.toFixed(3)}</li>
            <li>Voice energy: <strong className="text-indigo-200">{summary.voiceEnergyLevel}</strong></li>
          </ul>
        </div>
        <div className="bg-slate-950/50 border border-slate-800 rounded-2xl p-4">
          <h4 className="text-sm font-semibold text-indigo-300 uppercase tracking-wide mb-2">
            Audience Snapshot
          </h4>
          <ul className="space-y-1 text-sm text-slate-300">
            <li>Dominant emotion: <strong className="text-indigo-200">{summary.audienceDominantEmotion}</strong></li>
            <li>Overall engagement: <strong className="text-indigo-200">{summary.engagementOverall}</strong></li>
            <li>Faces detected (avg): {audienceTimeline.length > 0
              ? (audienceTimeline.reduce((acc, item) => acc + item.faceCount, 0) / audienceTimeline.length).toFixed(1)
              : 'N/A'}</li>
          </ul>
        </div>
      </div>

      <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4">
        <h4 className="text-sm font-semibold text-indigo-300 uppercase tracking-wide mb-3">
          Key Observations
        </h4>
        <ul className="list-disc pl-6 space-y-2 text-sm text-slate-300">
          {summary.keyObservations.map((observation, index) => (
            <li key={index}>{observation}</li>
          ))}
        </ul>
      </div>

      <div className="space-y-4">
        <div>
          <h4 className="text-sm font-semibold text-indigo-300 uppercase tracking-wide mb-2">
            Presenter Timeline
          </h4>
          <div className="bg-slate-950/60 border border-slate-800 rounded-2xl max-h-56 overflow-y-auto divide-y divide-slate-800">
            {presenterTimeline.map((entry, index) => (
              <div key={index} className="p-3 flex items-center justify-between text-sm text-slate-200">
                <span className="font-mono text-xs text-slate-500 w-16">{formatTimestamp(entry.timestamp)}</span>
                <span className="flex-1 px-3">
                  <span className="block text-indigo-200 font-semibold">{entry.emotion}</span>
                  <span className="text-slate-400 text-xs">
                    Engagement {entry.engagement} · Smile {entry.smileScore.toFixed(3)} · Eye {entry.eyeOpenness.toFixed(3)}
                  </span>
                </span>
                <span className="text-xs text-slate-500">Faces {entry.faceCount}</span>
              </div>
            ))}
            {presenterTimeline.length === 0 && (
              <p className="p-4 text-sm text-slate-500">No presenter faces detected in sampled frames.</p>
            )}
          </div>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-indigo-300 uppercase tracking-wide mb-2">
            Audience Timeline
          </h4>
          <div className="bg-slate-950/60 border border-slate-800 rounded-2xl max-h-56 overflow-y-auto divide-y divide-slate-800">
            {audienceTimeline.map((entry, index) => (
              <div key={index} className="p-3 flex items-center justify-between text-sm text-slate-200">
                <span className="font-mono text-xs text-slate-500 w-16">{formatTimestamp(entry.timestamp)}</span>
                <span className="flex-1 px-3">
                  <span className="block text-indigo-200 font-semibold">{entry.emotion}</span>
                  <span className="text-slate-400 text-xs">
                    Engagement {entry.engagement} · Faces {entry.faceCount}
                  </span>
                </span>
              </div>
            ))}
            {audienceTimeline.length === 0 && (
              <p className="p-4 text-sm text-slate-500">Audience camera data was not available.</p>
            )}
          </div>
        </div>

        <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4">
          <h4 className="text-sm font-semibold text-indigo-300 uppercase tracking-wide mb-2">
            Voice Energy Timeline
          </h4>
          {voiceTimeline.length > 0 ? (
            <div className="flex gap-2 overflow-x-auto">
              {voiceTimeline.map((value, index) => (
                <div key={index} className="flex flex-col items-center text-xs text-slate-400">
                  <span className="w-10 h-24 bg-indigo-500/30 border border-indigo-500/40 rounded-t-md" style={{ height: `${Math.min(100, value * 120)}px` }} />
                  <span className="mt-1">{value.toFixed(2)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No voice energy samples captured.</p>
          )}
        </div>
      </div>
    </section>
  );
};

export default EngagementDashboard;
