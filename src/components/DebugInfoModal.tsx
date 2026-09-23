import React, { useEffect, useRef, useState, useCallback } from 'react';

interface DebugInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface LlmMetricSummary {
  model_name: string;
  request_count: number;
  avg_cold_start_ms: number | null;
  avg_generation_time_ms: number | null;
  avg_tokens_per_second: number | null;
  max_vram_bytes: number | null;
  max_total_bytes: number | null;
  latest_timestamp: string | null;
}

interface LlmMetricEntry {
  id: number;
  model_name: string;
  cold_start_ms: number;
  generation_time_ms: number;
  tokens_per_second: number;
  vram_bytes: number;
  total_bytes: number;
  eval_count: number;
  timestamp: string;
}

function formatBytesAsMb(bytes: number | null | undefined): string {
  if (!bytes) return '0 MB';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return 'N/A';
  return `${ms.toFixed(0)} ms`;
}

function formatTps(tps: number | null | undefined): string {
  if (tps === null || tps === undefined) return 'N/A';
  return `${tps.toFixed(1)} tok/s`;
}

function formatTimestamp(ts: string | null | undefined): string {
  if (!ts) return 'Never';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

/**
 * Debug Info panel: surfaces the LLM comparison telemetry captured in
 * server/assistant/telemetry.js as plain accessible data tables. No charts
 * or visualizations — every value here must be readable, in document
 * order, by a screen reader without relying on color or shape.
 */
export function DebugInfoModal({ isOpen, onClose }: DebugInfoModalProps) {
  const [summary, setSummary] = useState<LlmMetricSummary[]>([]);
  const [recent, setRecent] = useState<LlmMetricEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusAnnouncement, setStatusAnnouncement] = useState('');

  const modalContentRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const loadMetrics = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [summaryRes, recentRes] = await Promise.all([
        fetch('/api/assistant/metrics/summary'),
        fetch('/api/assistant/metrics?limit=20'),
      ]);

      if (!summaryRes.ok) throw new Error(`Summary request failed (HTTP ${summaryRes.status}).`);
      if (!recentRes.ok) throw new Error(`Recent metrics request failed (HTTP ${recentRes.status}).`);

      const summaryData = await summaryRes.json();
      const recentData = await recentRes.json();

      setSummary(Array.isArray(summaryData) ? summaryData : []);
      setRecent(Array.isArray(recentData) ? recentData : []);
      setStatusAnnouncement(
        `Loaded debug info: ${Array.isArray(summaryData) ? summaryData.length : 0} models compared, ${Array.isArray(recentData) ? recentData.length : 0} recent requests.`
      );
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setLoadError(errorMsg);
      setStatusAnnouncement(`Failed to load debug info: ${errorMsg}`);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      // Deferred via setTimeout (rather than called synchronously here) so
      // loadMetrics's setIsLoading(true) doesn't run synchronously within
      // the effect body, which can trigger cascading renders.
      const timer = setTimeout(() => {
        loadMetrics();
        headingRef.current?.focus();
      }, 30);
      return () => clearTimeout(timer);
    }
  }, [isOpen, loadMetrics]);

  if (!isOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }

    if (e.key === 'Tab' && modalContentRef.current) {
      const focusable = modalContentRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length > 0) {
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first || document.activeElement === headingRef.current || !modalContentRef.current.contains(document.activeElement)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last || !modalContentRef.current.contains(document.activeElement)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    }
  };

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="debug-info-title"
      onKeyDown={handleKeyDown}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.7)',
        zIndex: 4000,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '1rem',
      }}
    >
      <div
        ref={modalContentRef}
        className="modal-content"
        style={{
          backgroundColor: '#fff',
          color: '#222',
          padding: '2rem',
          borderRadius: '8px',
          width: '95%',
          maxWidth: '900px',
          maxHeight: '85vh',
          overflowY: 'auto',
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        }}
      >
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
          style={{ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0,0,0,0)' }}
        >
          {statusAnnouncement}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
          <h2 id="debug-info-title" ref={headingRef} tabIndex={-1} style={{ outline: 'none', marginTop: 0 }}>
            Debug Info: LLM Comparison Metrics
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Debug Info"
            style={{ background: '#444', color: 'white', border: 'none', padding: '0.4rem 0.8rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', flexShrink: 0 }}
          >
            Close (Esc)
          </button>
        </div>

        <p>
          These are the timing, throughput, and memory-footprint metrics captured for every Assistant Oracle
          request, grouped by model, so different local LLMs can be compared. This panel is text and tables
          only &mdash; there are no charts or graphs here so the numbers stay usable with a screen reader.
        </p>

        <button
          type="button"
          onClick={loadMetrics}
          disabled={isLoading}
          style={{ padding: '0.5rem 1rem', fontWeight: 'bold', cursor: isLoading ? 'not-allowed' : 'pointer', marginBottom: '1.5rem' }}
        >
          {isLoading ? 'Refreshing…' : 'Refresh Metrics'}
        </button>

        {loadError && (
          <p role="alert" style={{ color: '#a30000', fontWeight: 'bold' }}>
            Error loading metrics: {loadError}
          </p>
        )}

        <h3>Model Comparison Summary</h3>
        {summary.length === 0 && !isLoading ? (
          <p>No LLM metrics have been recorded yet. Ask the Assistant Oracle a question to generate data.</p>
        ) : (
          <div tabIndex={0} role="region" aria-label="Model comparison summary table" style={{ overflowX: 'auto', marginBottom: '2rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <caption style={{ textAlign: 'left', marginBottom: '0.5rem', fontStyle: 'italic' }}>
                Averages across all recorded requests per model, most-used model first.
              </caption>
              <thead>
                <tr>
                  <th scope="col" style={{ textAlign: 'left', padding: '0.4rem', borderBottom: '2px solid #333' }}>Model</th>
                  <th scope="col" style={{ textAlign: 'left', padding: '0.4rem', borderBottom: '2px solid #333' }}>Requests</th>
                  <th scope="col" style={{ textAlign: 'left', padding: '0.4rem', borderBottom: '2px solid #333' }}>Avg Cold Start</th>
                  <th scope="col" style={{ textAlign: 'left', padding: '0.4rem', borderBottom: '2px solid #333' }}>Avg Generation Time</th>
                  <th scope="col" style={{ textAlign: 'left', padding: '0.4rem', borderBottom: '2px solid #333' }}>Avg Speed</th>
                  <th scope="col" style={{ textAlign: 'left', padding: '0.4rem', borderBottom: '2px solid #333' }}>Peak VRAM</th>
                  <th scope="col" style={{ textAlign: 'left', padding: '0.4rem', borderBottom: '2px solid #333' }}>Peak Total Memory</th>
                  <th scope="col" style={{ textAlign: 'left', padding: '0.4rem', borderBottom: '2px solid #333' }}>Last Used</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((row) => (
                  <tr key={row.model_name}>
                    <th scope="row" style={{ textAlign: 'left', padding: '0.4rem', borderBottom: '1px solid #ddd', fontWeight: 'bold' }}>{row.model_name}</th>
                    <td style={{ padding: '0.4rem', borderBottom: '1px solid #ddd' }}>{row.request_count}</td>
                    <td style={{ padding: '0.4rem', borderBottom: '1px solid #ddd' }}>{formatMs(row.avg_cold_start_ms)}</td>
                    <td style={{ padding: '0.4rem', borderBottom: '1px solid #ddd' }}>{formatMs(row.avg_generation_time_ms)}</td>
                    <td style={{ padding: '0.4rem', borderBottom: '1px solid #ddd' }}>{formatTps(row.avg_tokens_per_second)}</td>
                    <td style={{ padding: '0.4rem', borderBottom: '1px solid #ddd' }}>{formatBytesAsMb(row.max_vram_bytes)}</td>
                    <td style={{ padding: '0.4rem', borderBottom: '1px solid #ddd' }}>{formatBytesAsMb(row.max_total_bytes)}</td>
                    <td style={{ padding: '0.4rem', borderBottom: '1px solid #ddd' }}>{formatTimestamp(row.latest_timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h3>Recent Requests</h3>
        {recent.length === 0 && !isLoading ? (
          <p>No recent requests recorded.</p>
        ) : (
          <div tabIndex={0} role="region" aria-label="Recent LLM requests table" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <caption style={{ textAlign: 'left', marginBottom: '0.5rem', fontStyle: 'italic' }}>
                The most recent {recent.length} recorded Assistant Oracle requests, newest first.
              </caption>
              <thead>
                <tr>
                  <th scope="col" style={{ textAlign: 'left', padding: '0.4rem', borderBottom: '2px solid #333' }}>Time</th>
                  <th scope="col" style={{ textAlign: 'left', padding: '0.4rem', borderBottom: '2px solid #333' }}>Model</th>
                  <th scope="col" style={{ textAlign: 'left', padding: '0.4rem', borderBottom: '2px solid #333' }}>Cold Start</th>
                  <th scope="col" style={{ textAlign: 'left', padding: '0.4rem', borderBottom: '2px solid #333' }}>Generation Time</th>
                  <th scope="col" style={{ textAlign: 'left', padding: '0.4rem', borderBottom: '2px solid #333' }}>Speed</th>
                  <th scope="col" style={{ textAlign: 'left', padding: '0.4rem', borderBottom: '2px solid #333' }}>Tokens</th>
                  <th scope="col" style={{ textAlign: 'left', padding: '0.4rem', borderBottom: '2px solid #333' }}>VRAM</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((row) => (
                  <tr key={row.id}>
                    <th scope="row" style={{ textAlign: 'left', padding: '0.4rem', borderBottom: '1px solid #ddd', fontWeight: 'normal' }}>{formatTimestamp(row.timestamp)}</th>
                    <td style={{ padding: '0.4rem', borderBottom: '1px solid #ddd' }}>{row.model_name}</td>
                    <td style={{ padding: '0.4rem', borderBottom: '1px solid #ddd' }}>{formatMs(row.cold_start_ms)}</td>
                    <td style={{ padding: '0.4rem', borderBottom: '1px solid #ddd' }}>{formatMs(row.generation_time_ms)}</td>
                    <td style={{ padding: '0.4rem', borderBottom: '1px solid #ddd' }}>{formatTps(row.tokens_per_second)}</td>
                    <td style={{ padding: '0.4rem', borderBottom: '1px solid #ddd' }}>{row.eval_count}</td>
                    <td style={{ padding: '0.4rem', borderBottom: '1px solid #ddd' }}>{formatBytesAsMb(row.vram_bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
