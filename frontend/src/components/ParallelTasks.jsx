function normalizeParallelGroups(value) {
  if (!Array.isArray(value)) return []

  return value
    .filter((group) => Array.isArray(group))
    .map((group) => group.map((id) => String(id)).filter(Boolean))
    .filter((group) => group.length > 0)
}

export default function ParallelTasks({ parallelGroups, nodeLabelMap = {}, isLoading = false }) {
  const groups = normalizeParallelGroups(parallelGroups)

  return (
    <section
      className="parallel-tasks-card"
      style={{
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        background: '#ffffff',
        padding: 16,
      }}
    >
      <h3 style={{ margin: '0 0 8px 0' }}>Parallel Execution Groups</h3>
      <p style={{ margin: '0 0 12px 0', color: '#64748b' }}>
        Tasks grouped by parallel execution level.
      </p>

      {isLoading ? (
        <p style={{ margin: 0, color: '#475569' }}>Loading parallel groups...</p>
      ) : groups.length > 0 ? (
        <ul style={{ margin: 0, paddingLeft: 18, color: '#0f172a', lineHeight: 1.6 }}>
          {groups.map((group, idx) => {
            const labels = group.map((id) => nodeLabelMap[id] || id)
            return (
              <li key={`parallel-level-${idx}`}>
                {`Level ${idx + 1} -> ${labels.join(', ')}`}
              </li>
            )
          })}
        </ul>
      ) : (
        <p style={{ margin: 0, color: '#64748b' }}>No parallel groups available.</p>
      )}
    </section>
  )
}
