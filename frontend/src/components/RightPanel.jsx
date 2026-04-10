import { useMemo } from 'react'

const PRIORITY_DOT = { High: '#f59e0b', Medium: '#3b82f6', Low: '#64748b' }

function PBadge({ p }) {
  return <span className={`pbadge pbadge--${p || 'Medium'}`}>{p || 'Medium'}</span>
}

export default function RightPanel({
  selectedNode,
  insights,
  nodes = [],
  activeTab = 'analysis',
  onTabChange = () => {},
}) {
  const nodeMap = useMemo(() => {
    const map = new Map()
    nodes.forEach((node) => {
      if (node && node.id) {
        map.set(String(node.id), node)
      }
    })
    return map
  }, [nodes])

  const selectedData = selectedNode?.data || {}
  const features = Array.isArray(selectedData.features) ? selectedData.features.filter(Boolean) : []
  const modules = Array.isArray(selectedData.modules) ? selectedData.modules.filter(Boolean) : []
  const criticalPath = useMemo(
    () => (Array.isArray(insights?.critical_path) ? insights.critical_path : []),
    [insights],
  )
  const bottlenecks = useMemo(
    () => (Array.isArray(insights?.top_bottlenecks) ? insights.top_bottlenecks : []),
    [insights],
  )
  const parallelGroups = useMemo(
    () => (Array.isArray(insights?.parallel_groups) ? insights.parallel_groups : []),
    [insights],
  )
  const criticalSet = useMemo(() => new Set(criticalPath.map((id) => String(id))), [criticalPath])
  const bottleneckSet = useMemo(() => new Set(bottlenecks.map((id) => String(id))), [bottlenecks])
  const parallelNodeIds = useMemo(
    () => new Set(parallelGroups.filter((group) => Array.isArray(group) && group.length > 1).flat().map((id) => String(id))),
    [parallelGroups],
  )
  const aiLayerMap = useMemo(() => {
    const map = new Map()
    parallelGroups.forEach((group, idx) => {
      if (!Array.isArray(group)) return
      group.forEach((id) => {
        map.set(String(id), idx + 1)
      })
    })
    return map
  }, [parallelGroups])

  const selectedId = String(selectedNode?.id || '')
  const selectedFlags = [
    criticalSet.has(selectedId) ? '🔥 Critical Path' : null,
    bottleneckSet.has(selectedId) ? '⚠ Bottleneck' : null,
    parallelNodeIds.has(selectedId) ? '⚡ Parallel' : null,
  ].filter(Boolean)

  const bottleneckTasks = bottlenecks
    .map((id) => nodeMap.get(String(id)))
    .filter(Boolean)

  const taskAnalysis = useMemo(() => {
    const priorityRank = { High: 0, Medium: 1, Low: 2 }

    return nodes
      .map((node) => {
        const id = String(node.id)
        const priority = node.data?.priority || 'Medium'
        return {
          id,
          label: node.data?.label || id,
          priority,
          isCritical: criticalSet.has(id),
          isBottleneck: bottleneckSet.has(id),
          parallel: parallelNodeIds.has(id),
          aiLayer: aiLayerMap.get(id) || Number.MAX_SAFE_INTEGER,
          features: Array.isArray(node.data?.features) ? node.data.features.filter(Boolean) : [],
          modules: Array.isArray(node.data?.modules) ? node.data.modules.filter(Boolean) : [],
          priorityScore: priorityRank[priority] ?? 3,
        }
      })
      .sort((a, b) => {
        if (a.isCritical !== b.isCritical) return a.isCritical ? -1 : 1
        if (a.aiLayer !== b.aiLayer) return a.aiLayer - b.aiLayer
        if (a.isBottleneck !== b.isBottleneck) return a.isBottleneck ? -1 : 1
        if (a.priorityScore !== b.priorityScore) return a.priorityScore - b.priorityScore
        return a.label.localeCompare(b.label)
      })
  }, [nodes, criticalSet, bottleneckSet, parallelNodeIds, aiLayerMap])

  if (!selectedNode) {
    return (
      <aside className="right-panel">
        <div className="right-panel-empty">
          <p className="right-panel-empty__title">
            Task Details
          </p>
          <p className="right-panel-empty__body">Select a node to see task details, AI analysis, and bottlenecks.</p>
        </div>
      </aside>
    )
  }

  return (
    <aside className="right-panel">
      <div className="panel-header">
        <p className="panel-title">{selectedData.label || 'Untitled task'}</p>
        <p className="panel-sub">Task details &amp; backend insights</p>
      </div>

      <div className="priority-row">
        <div className="priority-dot-lg" style={{ background: PRIORITY_DOT[selectedData.priority] || '#f59e0b' }} />
        <PBadge p={selectedData.priority} />
        <div style={{ flex: 1 }} />
      </div>

      <div className="panel-section">
        <p className="panel-section-label">Description</p>
        <p className="panel-desc">{selectedData.description || 'No description provided.'}</p>
      </div>

      <div className="panel-section">
        <p className="panel-section-label">Task Flags</p>
        <div className="dep-chips">
          {selectedFlags.length > 0 ? (
            selectedFlags.map((flag) => (
              <span key={flag} className="dep-chip">
                {flag}
              </span>
            ))
          ) : (
            <span className="dep-chip">No backend flags</span>
          )}
        </div>
      </div>

      {features.length > 0 && (
        <div className="panel-section">
          <p className="panel-section-label">Features</p>
          <div className="dep-chips">
            {features.map((feature) => (
              <span key={feature} className="dep-chip dep-chip--feature">
                {feature}
              </span>
            ))}
          </div>
        </div>
      )}

      {modules.length > 0 && (
        <div className="panel-section">
          <p className="panel-section-label">Modules</p>
          <div className="dep-chips">
            {modules.map((module) => (
              <span key={module} className="dep-chip dep-chip--module">
                {module}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="panel-section">
        <div className="view-tabs right-panel-tabs">
          {[
            { key: 'analysis', label: 'AI Analysis' },
            { key: 'bottlenecks', label: 'Bottlenecks' },
            { key: 'tasks', label: 'Batch Tasks' },
          ].map((tab) => (
            <button
              key={tab.key}
              className={`view-tab${activeTab === tab.key ? ' active' : ''}`}
              onClick={() => onTabChange(tab.key)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'analysis' && (
          <>
            <div className="insight-card-panel insight-card-panel--purple">
              <div className="insight-type-chip">EXPLANATION</div>
              <p className="insight-card-title">Why this workflow is structured this way</p>
              <p className="insight-card-body">{insights?.explanation || 'No AI explanation available.'}</p>
            </div>
            <div className="insight-card-panel insight-card-panel--amber">
              <div className="insight-type-chip">FLOW</div>
              <p className="insight-card-title">Start and finish</p>
              <p className="insight-card-body">
                Start: {insights?.start_task || '—'}
                <br />
                End: {insights?.end_task || '—'}
              </p>
            </div>
            <div className="insight-card-panel insight-card-panel--green">
              <div className="insight-type-chip">CRITICAL PATH</div>
              <p className="insight-card-title">Main execution chain</p>
              <p className="insight-card-body">{criticalPath.length > 0 ? criticalPath.map((id) => nodeMap.get(String(id))?.data?.label || String(id)).join(' → ') : 'No critical path available.'}</p>
            </div>
            <div className="insight-card-panel">
              <div className="insight-type-chip">PARALLEL GROUPS</div>
              <p className="insight-card-title">Tasks that can run together</p>
              <p className="insight-card-body">
                {parallelGroups.filter((group) => Array.isArray(group) && group.length > 1).length > 0
                  ? parallelGroups
                      .filter((group) => Array.isArray(group) && group.length > 1)
                      .map((group) => group.map((id) => nodeMap.get(String(id))?.data?.label || String(id)).join(', '))
                      .join(' | ')
                  : 'No parallel groups available.'}
              </p>
            </div>
          </>
        )}

        {activeTab === 'bottlenecks' && (
          <div className="insight-card-panel insight-card-panel--amber">
            <div className="insight-type-chip">BOTTLENECKS</div>
            <p className="insight-card-title">Real bottleneck tasks from the backend</p>
            <div className="dep-chips" style={{ marginTop: 10 }}>
              {bottleneckTasks.length > 0 ? (
                bottleneckTasks.map((task) => (
                  <span key={task.id} className="dep-chip">
                    {task.data?.label || task.id}
                  </span>
                ))
              ) : (
                <span className="dep-chip">No bottlenecks detected.</span>
              )}
            </div>
          </div>
        )}

        {activeTab === 'tasks' && (
          <div className="task-analysis-grid">
            {taskAnalysis.map((task) => (
              <div key={task.id} className="insight-card-panel task-analysis-card">
                <div className="task-analysis-header">
                  <p className="insight-card-title task-analysis-title">{task.label}</p>
                  <PBadge p={task.priority} />
                  {task.isCritical && <span className="dep-chip">🔴 Critical</span>}
                  {task.isBottleneck && <span className="dep-chip">⚠ Bottleneck</span>}
                  {task.parallel && <span className="dep-chip">⚡ Parallel</span>}
                  {Number.isFinite(task.aiLayer) && task.aiLayer !== Number.MAX_SAFE_INTEGER && (
                    <span className="dep-chip">Layer {task.aiLayer}</span>
                  )}
                </div>
                <div className="task-analysis-body">
                  <p className="panel-desc task-analysis-desc">{task.features.length > 0 ? task.features.join(', ') : 'No features provided.'}</p>
                  <p className="panel-desc task-analysis-desc">{task.modules.length > 0 ? task.modules.join(', ') : 'No modules provided.'}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}
