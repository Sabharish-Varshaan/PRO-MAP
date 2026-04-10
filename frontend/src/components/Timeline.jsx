import { useMemo } from 'react'

function TimelineBar({ row }) {
  const colors = {
    High: { bg: '#f59e0b', text: '#111827' },
    Medium: { bg: '#3b82f6', text: '#ffffff' },
    Low: { bg: '#64748b', text: '#ffffff' },
    Parallel: { bg: '#10b981', text: '#ffffff' },
    Critical: { bg: '#ef4444', text: '#ffffff' },
  }

  let color = colors[row.priority] || colors.Medium
  if (row.parallel) color = colors.Parallel
  if (row.isCritical) color = colors.Critical

  return (
    <div
      className="timeline-bar"
      style={{
        gridColumn: `${row.start + 2} / span ${Math.max(1, Number(row.duration) || 1)}`,
        background: color.bg,
        color: color.text,
      }}
    >
      {`${row.step}. ${row.label}`}
    </div>
  )
}

export default function Timeline({ timelineRows = [], timelineDayCount = 5, criticalPathLabels = [], nodes = [], order = [] }) {
  const safeRows = useMemo(() => {
    if (Array.isArray(timelineRows) && timelineRows.length > 0) {
      return timelineRows
    }

    const safeNodes = Array.isArray(nodes) ? nodes : []
    const nodeMap = new Map(safeNodes.map((node, index) => [String(node?.id || `n${index + 1}`), node]))
    const safeOrder = Array.isArray(order) ? order.map((id) => String(id)).filter((id) => nodeMap.has(id)) : []
    const renderOrder = safeOrder.length > 0 ? safeOrder : safeNodes.map((node, index) => String(node?.id || `n${index + 1}`))

    return renderOrder.map((id, index) => {
      const node = nodeMap.get(id)
      return {
        id,
        label: node?.data?.label || node?.label || id,
        priority: node?.data?.priority || 'Medium',
        parallel: Boolean(node?.data?.parallel),
        isCritical: Boolean(node?.data?.is_critical),
        isBottleneck: Boolean(node?.data?.is_bottleneck),
        start: index,
        duration: 1,
        step: index + 1,
      }
    })
  }, [timelineRows, nodes, order])

  const safeDayCount = Math.max(1, Number(timelineDayCount) || safeRows.length || 1)
  const timelineColumns = `220px repeat(${safeDayCount}, minmax(120px, 1fr))`

  console.log('STEP DATA:', {
    step: 'timeline-render',
    rowsCount: safeRows.length,
    dayCount: safeDayCount,
    timelineRows: safeRows,
    criticalPathLabels,
  })

  if (safeRows.length === 0) {
    return <div>No timeline data</div>
  }

  return (
    <div className="timeline-shell">
      <h3 className="timeline-title">Execution Timeline</h3>
      <div className="timeline-wrap">
        <div className="timeline-header-row" style={{ gridTemplateColumns: timelineColumns }}>
          <div className="timeline-day timeline-day--label">Task</div>
          {Array.from({ length: safeDayCount }, (_, i) => (
            <div key={`timeline-day-${i + 1}`} className="timeline-day">Day {i + 1}</div>
          ))}
        </div>

        {safeRows.map((row, index) => (
          <div
            key={row.id || `row-${index}`}
            className={`timeline-task-row${row.isCritical ? ' timeline-task-row--critical' : ''}`}
            style={{ gridTemplateColumns: timelineColumns }}
          >
            <div className="timeline-label">{row.label}</div>
            <TimelineBar row={{ ...row, start: index, step: index + 1 }} />
          </div>
        ))}

        <div className="timeline-legend">
          <span className="timeline-legend-item timeline-legend-item--critical">■ Critical</span>
          <span className="timeline-legend-item timeline-legend-item--high">■ High</span>
          <span className="timeline-legend-item timeline-legend-item--medium">■ Medium</span>
          <span className="timeline-legend-item timeline-legend-item--parallel">■ Parallel</span>
        </div>
        <p className="timeline-legend-path">Critical path: {criticalPathLabels.join(' -> ') || '—'}</p>
      </div>
    </div>
  )
}
