import { useMemo } from 'react'

const PHASE_ORDER = [
  'Planning',
  'Architecture',
  'Backend Development',
  'Frontend Development',
  'Integration',
  'Testing',
  'Deployment',
]

const PHASE_DURATIONS = {
  Planning: 2,
  Architecture: 2,
  'Backend Development': 4,
  'Frontend Development': 4,
  Integration: 2,
  Testing: 3,
  Deployment: 1,
}

const PRIORITY_DAYS = {
  High: 3,
  Medium: 2,
  Low: 1,
}

function addDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function formatDate(date) {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function resolvePhase(task) {
  return task?.data?.phase || task?.phase || 'Planning'
}

function resolvePriority(task) {
  return task?.data?.priority || task?.priority || 'Medium'
}

function resolveLabel(task) {
  return task?.data?.label || task?.label || task?.name || task?.id || 'Task'
}

function resolveDependencies(edges, nodeId) {
  if (!Array.isArray(edges)) return []
  return edges
    .filter((edge) => edge && String(edge.target) === String(nodeId) && edge.source)
    .map((edge) => String(edge.source))
}

function buildSchedule(nodes, edges, order) {
  const safeNodes = Array.isArray(nodes) ? nodes.filter((node) => node && node.id) : []
  const nodeMap = new Map(safeNodes.map((node) => [String(node.id), node]))
  const orderedIds = (Array.isArray(order) ? order : []).map((id) => String(id)).filter((id) => nodeMap.has(id))
  const renderOrder = orderedIds.length > 0 ? orderedIds : safeNodes.map((node) => String(node.id))

  const nodesByPhase = new Map()
  renderOrder.forEach((id) => {
    const node = nodeMap.get(id)
    const phase = resolvePhase(node)
    if (!nodesByPhase.has(phase)) nodesByPhase.set(phase, [])
    nodesByPhase.get(phase).push(node)
  })

  const orderedPhases = [
    ...PHASE_ORDER.filter((phase) => nodesByPhase.has(phase)),
    ...Array.from(nodesByPhase.keys()).filter((phase) => !PHASE_ORDER.includes(phase)),
  ]

  const dependencyMap = new Map()
  renderOrder.forEach((id) => {
    dependencyMap.set(String(id), resolveDependencies(edges, id))
  })

  const scheduledTasks = []
  const phaseSummaries = []
  let cursor = new Date()
  cursor.setHours(9, 0, 0, 0)

  orderedPhases.forEach((phase) => {
    const phaseNodes = nodesByPhase.get(phase) || []
    const phaseStart = new Date(cursor)
    const phaseDuration = Math.max(PHASE_DURATIONS[phase] || 2, phaseNodes.length)
    let phaseCursor = new Date(phaseStart)
    const phaseTaskIds = []

    phaseNodes.forEach((node) => {
      const taskId = String(node.id)
      const priority = resolvePriority(node)
      const durationDays = PRIORITY_DAYS[priority] || 2
      const isParallel = Boolean(node?.data?.parallel || node?.data?.parallelizable)
      const start = isParallel ? new Date(phaseStart) : new Date(phaseCursor)
      const end = addDays(start, durationDays)
      const dependencyIds = dependencyMap.get(taskId) || []

      scheduledTasks.push({
        id: taskId,
        name: resolveLabel(node),
        phase,
        priority,
        start,
        end,
        dependencies: dependencyIds,
        isParallel,
        isCritical: Boolean(node?.data?.is_critical),
        isBottleneck: Boolean(node?.data?.is_bottleneck),
      })

      phaseTaskIds.push(taskId)
      if (!isParallel) {
        phaseCursor = addDays(end, 1)
      }
    })

    const phaseTasks = scheduledTasks.filter((task) => phaseTaskIds.includes(task.id))
    const phaseEnd = phaseTasks.length > 0
      ? phaseTasks.reduce((latest, task) => (task.end > latest ? task.end : latest), phaseStart)
      : addDays(phaseStart, phaseDuration)

    phaseSummaries.push({
      phase,
      start: phaseStart,
      end: phaseEnd,
      count: phaseNodes.length,
      tasks: phaseTasks,
    })

    cursor = addDays(phaseEnd, 1)
  })

  const allStarts = scheduledTasks.map((task) => task.start.getTime())
  const allEnds = scheduledTasks.map((task) => task.end.getTime())
  const chartStart = new Date(Math.min(...allStarts))
  chartStart.setHours(0, 0, 0, 0)
  const chartEnd = new Date(Math.max(...allEnds))
  chartEnd.setHours(0, 0, 0, 0)
  const totalDays = Math.max(Math.round((chartEnd - chartStart) / 86400000) + 1, 1)

  return { tasks: scheduledTasks, phaseSummaries, chartStart, totalDays }
}

function PhaseSummary({ phaseSummaries, criticalPathLabels = [] }) {
  if (!phaseSummaries.length) return null

  return (
    <div className="timeline-phase-summary-grid">
      {phaseSummaries.map((phase) => (
        <div key={phase.phase} className="timeline-phase-summary-card">
          <div className="timeline-phase-summary-card__head">
            <h4>{phase.phase}</h4>
            <span>{phase.count} tasks</span>
          </div>
          <p>
            {formatDate(phase.start)} to {formatDate(phase.end)}
          </p>
        </div>
      ))}
      <div className="timeline-phase-summary-card timeline-phase-summary-card--wide">
        <div className="timeline-phase-summary-card__head">
          <h4>Critical Path</h4>
          <span>{criticalPathLabels.length} steps</span>
        </div>
        <p>{criticalPathLabels.join(' → ') || '—'}</p>
      </div>
    </div>
  )
}

function TimelineChart({ tasks, chartStart, totalDays }) {
  const dayColumns = Array.from({ length: totalDays }, (_, index) => addDays(chartStart, index))

  return (
    <div className="gantt-shell">
      <div className="gantt-grid gantt-grid--header" style={{ gridTemplateColumns: `240px repeat(${totalDays}, minmax(42px, 1fr))` }}>
        <div className="gantt-axis-label">Task</div>
        {dayColumns.map((day, index) => (
          <div key={`${day.toISOString()}-${index}`} className="gantt-axis-day">
            {day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </div>
        ))}
      </div>

      {tasks.map((task) => {
        const leftDays = Math.max(0, Math.round((task.start - chartStart) / 86400000))
        const spanDays = Math.max(1, Math.round((task.end - task.start) / 86400000) + 1)
        const gridStyle = { gridTemplateColumns: `240px repeat(${totalDays}, minmax(42px, 1fr))` }

        return (
          <div key={task.id} className={`gantt-grid gantt-grid--row${task.isCritical ? ' gantt-grid--critical' : ''}`} style={gridStyle}>
            <div className="gantt-task-label">
              <div className="gantt-task-label__title">{task.name}</div>
              <div className="gantt-task-label__meta">
                {task.phase} · {task.priority}
                {task.isParallel ? ' · Parallel' : ''}
                {task.isBottleneck ? ' · Bottleneck' : ''}
              </div>
            </div>
            <div className="gantt-track" style={{ gridColumn: `2 / span ${totalDays}` }}>
              <div
                className={`gantt-bar${task.isCritical ? ' gantt-bar--critical' : ''}${task.isParallel ? ' gantt-bar--parallel' : ''}${task.isBottleneck ? ' gantt-bar--bottleneck' : ''}`}
                style={{
                  left: `calc(${leftDays} * var(--gantt-day-width))`,
                  width: `calc(${spanDays} * var(--gantt-day-width))`,
                }}
              >
                <span>{formatDate(task.start)} - {formatDate(task.end)}</span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function TimelinePhaseBlock({ phase, chartStart, totalDays }) {
  return (
    <div className="timeline-phase-block">
      <div className="timeline-phase-header">
        <div>
          <h4 className="timeline-phase-title">{phase.phase}</h4>
          <p className="timeline-phase-subtitle">
            {formatDate(phase.start)} to {formatDate(phase.end)}
          </p>
        </div>
        <span className="timeline-phase-count">{phase.count} tasks</span>
      </div>
      <TimelineChart tasks={phase.tasks} chartStart={chartStart} totalDays={totalDays} />
    </div>
  )
}

export default function Timeline({ nodes = [], order = [], edges = [], insights = {} }) {
  console.log('Rendering Timeline')
  const safeNodes = Array.isArray(nodes) ? nodes : []
  const safeEdges = Array.isArray(edges) ? edges : []
  const safeOrder = Array.isArray(order) ? order : []

  const { tasks, phaseSummaries, chartStart, totalDays } = useMemo(
    () => buildSchedule(safeNodes, safeEdges, safeOrder),
    [safeNodes, safeEdges, safeOrder],
  )

  const criticalPathLabels = useMemo(() => {
    const labelMap = new Map(safeNodes.map((node) => [String(node.id), resolveLabel(node)]))
    return (Array.isArray(insights?.critical_path) ? insights.critical_path : []).map((id) => labelMap.get(String(id)) || String(id))
  }, [safeNodes, insights])

  if (!tasks.length) {
    return <div>No timeline data</div>
  }

  return (
    <div className="timeline-shell">
      <h3 className="timeline-title">Execution Timeline</h3>
      <p className="timeline-intro">The Gantt chart groups work by engineering phase and shows approximate dates for a demo-friendly schedule.</p>
      <PhaseSummary phaseSummaries={phaseSummaries} criticalPathLabels={criticalPathLabels} />
      <div className="timeline-gantt-wrap" style={{ '--gantt-day-width': '52px' }}>
        {phaseSummaries.map((phase) => (
          <TimelinePhaseBlock key={phase.phase} phase={phase} chartStart={chartStart} totalDays={totalDays} />
        ))}
      </div>
    </div>
  )
}
