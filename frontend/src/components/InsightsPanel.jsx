function normalizeToList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item.trim()
        if (item && typeof item === 'object') return JSON.stringify(item)
        return String(item || '').trim()
      })
      .filter(Boolean)
  }

  if (typeof value === 'string') {
    const text = value.trim()
    return text ? [text] : []
  }

  if (value && typeof value === 'object') {
    return [JSON.stringify(value)]
  }

  return []
}

function InsightCard({ title, content }) {
  const lines = normalizeToList(content)

  return (
    <section
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 10,
        padding: 14,
        background: '#ffffff',
      }}
    >
      <h4 style={{ margin: '0 0 8px 0', color: '#0f172a' }}>{title}</h4>
      {lines.length > 0 ? (
        <ul style={{ margin: 0, paddingLeft: 18, color: '#334155', lineHeight: 1.55 }}>
          {lines.map((line, idx) => (
            <li key={`${title}-${idx}`}>{line}</li>
          ))}
        </ul>
      ) : (
        <p style={{ margin: 0, color: '#64748b' }}>No analysis available.</p>
      )}
    </section>
  )
}

export default function InsightsPanel({ insights, isLoading = false }) {
  const safeInsights = (insights && typeof insights === 'object') ? insights : {}
  const hasInsights = Boolean(insights && typeof insights === 'object')

  return (
    <section
      className="insights-panel"
      style={{
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        padding: 16,
        background: '#f8fafc',
      }}
    >
      <h3 style={{ marginTop: 0, marginBottom: 12, color: '#0f172a' }}>AI Insights</h3>

      {isLoading ? (
        <p style={{ margin: '0 0 12px 0', color: '#475569' }}>Loading AI insights...</p>
      ) : null}

      {!isLoading && !hasInsights ? (
        <p style={{ margin: '0 0 12px 0', color: '#64748b' }}>
          Insights are not available yet. Complete workflow generation to see AI reasoning.
        </p>
      ) : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 12,
          opacity: isLoading ? 0.65 : 1,
        }}
      >
        <InsightCard title="Critical Path Analysis" content={safeInsights.critical_path_analysis} />
        <InsightCard title="Bottleneck Analysis" content={safeInsights.bottleneck_analysis} />
        <InsightCard title="Parallel Execution" content={safeInsights.parallel_execution} />
        <InsightCard title="Execution Strategy" content={safeInsights.execution_strategy} />
        <InsightCard title="Optimization Suggestions" content={safeInsights.optimization_suggestions} />
      </div>
    </section>
  )
}
