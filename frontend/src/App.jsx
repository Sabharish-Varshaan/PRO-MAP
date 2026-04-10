import { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import 'react-flow-renderer/dist/style.css'
import './App.css'
import WorkflowGraph from './components/WorkflowGraph'
import { getLayoutedNodes } from './utils/layout'

/* ── API ─────────────────────────────────────────────── */
const API_BASE_URL = 'http://127.0.0.1:8001'
const API_TIMEOUT_MS = 90000
const DEBUG_LOGS = true

/* ── Normalize backend response ──────────────────────── */
function normalizeWorkflow(raw) {
  const payload = (raw && typeof raw === 'object') ? (raw.workflow && typeof raw.workflow === 'object' ? raw.workflow : raw) : {}
  const rawNodes = Array.isArray(payload?.nodes) ? payload.nodes : []
  const rawEdges = Array.isArray(payload?.edges) ? payload.edges : []
  const rawOrder = Array.isArray(payload?.order) ? payload.order : []

  const isPlaceholder = (label) => {
    const s = String(label || '').trim().toLowerCase()
    return s === '' || /^((task|step|node|n)\s*\d*)$/.test(s)
  }

  const nodes = rawNodes.map((node, i) => {
    if (!node || typeof node !== 'object') return null
    const id   = String(node.id || `n${i + 1}`)
    const data = (node.data && typeof node.data === 'object') ? node.data : {}
    const desc = data.description || node.description || ''
    const label = data.label || node.label || node.name || id
    const priority = ['High', 'Medium', 'Low'].includes(data.priority) ? data.priority : 'Medium'
    return {
      id, type: 'task',
      position: node.position || { x: 0, y: 0 },
      data: {
        label:       isPlaceholder(label) && desc ? desc : label,
        description: desc,
        features:    Array.isArray(data.features) ? data.features.filter(Boolean) : [],
        modules:     Array.isArray(data.modules)  ? data.modules.filter(Boolean)  : [],
        priority,
        parallel: Boolean(data.parallel),
      },
    }
  }).filter(Boolean)

  const nodeIds = new Set(nodes.map((n) => n.id))

  const edges = rawEdges.map((e, i) => {
    if (!e || typeof e !== 'object') return null
    const source = String(e.source || e.from || '')
    const target = String(e.target || e.to   || '')
    if (!source || !target || !nodeIds.has(source) || !nodeIds.has(target)) return null
    return { id: String(e.id || `e-${source}-${target}-${i}`), source, target }
  }).filter(Boolean)

  const order = rawOrder.map((id) => String(id)).filter((id) => nodeIds.has(id))

  if (nodes.length === 0) {
    throw new Error('No valid nodes in API response')
  }

  return {
    nodes, edges,
    order:       order.length > 0 ? order : nodes.map((n) => n.id),
    explanation: payload?.explanation?.trim?.() || '',
    insights:    (payload?.insights && typeof payload.insights === 'object') ? payload.insights : null,
  }
}

async function fetchWorkflow(desc) {
  try {
    const res = await axios.post(
      `${API_BASE_URL}/generate`,
      { project_description: desc },
      { timeout: API_TIMEOUT_MS }
    )

    if (DEBUG_LOGS) console.log('[fetchWorkflow] raw API response:', res.data)
    const normalized = normalizeWorkflow(res.data)
    if (DEBUG_LOGS) console.log('[fetchWorkflow] normalized workflow:', normalized)
    return normalized
  } catch (e) {
    if (e?.code === 'ECONNABORTED') {
      console.error('[fetchWorkflow] request timed out:', {
        timeoutMs: API_TIMEOUT_MS,
        message: e?.message,
      })
    }
    console.error('[fetchWorkflow] request failed:', {
      message: e?.message,
      code: e?.code,
      status: e?.response?.status,
      data: e?.response?.data,
    })
    throw e
  }
}

/* ── Priority helpers ────────────────────────────────── */
const PRIORITY_DOT = { High: '#dc2626', Medium: '#d97706', Low: '#059669' }

function PBadge({ p }) {
  return <span className={`pbadge pbadge--${p || 'Medium'}`}>{p || 'Medium'}</span>
}

/* ── Gantt row estimates (backend doesn't send hours, so we distribute) ── */
function buildTimeline(nodes, edges) {
  // topological sort for position
  const adj = {}
  const indeg = {}
  nodes.forEach((n) => { adj[n.id] = []; indeg[n.id] = 0 })
  edges.forEach((e) => { adj[e.source]?.push(e.target); indeg[e.target] = (indeg[e.target] || 0) + 1 })

  const queue = nodes.filter((n) => (indeg[n.id] || 0) === 0).map((n) => n.id)
  const topo = []
  const visited = new Set()

  while (queue.length) {
    const cur = queue.shift()
    if (visited.has(cur)) continue
    visited.add(cur)
    topo.push(cur)
    ;(adj[cur] || []).forEach((nxt) => {
      indeg[nxt]--
      if (indeg[nxt] === 0) queue.push(nxt)
    })
  }

  // assign hours proportional to features count
  const nodeMap = {}
  nodes.forEach((n) => { nodeMap[n.id] = n })

  const hrsMap = {}
  nodes.forEach((n) => {
    const feats = (n.data?.features?.length || 0)
    hrsMap[n.id] = Math.max(3, feats * 1.5 + 2)
  })

  // assign start based on longest predecessor path
  const startMap = {}
  topo.forEach((id) => {
    const preds = edges.filter((e) => e.target === id).map((e) => e.source)
    startMap[id] = preds.length === 0
      ? 0
      : Math.max(...preds.map((p) => (startMap[p] || 0) + (hrsMap[p] || 4)))
  })

  const totalHrs = Math.max(...nodes.map((n) => (startMap[n.id] || 0) + (hrsMap[n.id] || 4)))

  return nodes.map((n) => ({
    id:    n.id,
    label: n.data?.label,
    priority: n.data?.priority,
    parallel: n.data?.parallel,
    startPct: ((startMap[n.id] || 0) / totalHrs) * 100,
    widthPct: ((hrsMap[n.id] || 4) / totalHrs) * 100,
    hrs:      Math.round(hrsMap[n.id] || 4),
    totalHrs: Math.round(totalHrs),
  }))
}

/* ════════════════════════════════════════════════════════
   LANDING PAGE
   ════════════════════════════════════════════════════════ */
function Landing({ onGenerate }) {
  const [idea, setIdea] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const submitInFlightRef = useRef(false)

  const CHIPS = ['E-commerce platform', 'Mobile app', 'ML pipeline', 'SaaS onboarding']

  async function handle() {
    if (submitInFlightRef.current || loading) return
    const val = idea.trim()
    if (!val) { setErr('Please enter a project idea.'); return }
    submitInFlightRef.current = true
    setLoading(true); setErr('')
    try {
      await onGenerate(val)
    } catch (e) {
      if (e?.code === 'ECONNABORTED') {
        setErr('Request timed out. Backend is still processing. Try again in a few seconds.')
      } else {
        setErr('Could not reach backend. Make sure it is running.')
      }
    } finally {
      submitInFlightRef.current = false
      setLoading(false)
    }
  }

  return (
    <div className="landing">
      {/* Nav */}
      <nav className="landing-nav">
        <div className="brand">
          <div className="brand-logo">P</div>
          <span className="brand-name">PROMAP</span>
        </div>
        <span className="ai-badge">AI Workflow Engine</span>
      </nav>

      {/* Hero */}
      <div className="landing-hero">
        <p className="hero-eyebrow">Intelligent Workflow Structuring</p>
        <h1 className="hero-title">
          Turn ideas into<br />
          <span className="hero-title-accent">dependency maps</span>
        </h1>
        <p className="hero-sub">
          Describe your project in plain English. PROMAP generates a complete task graph,
          dependency map, and execution plan — instantly.
        </p>

        <div className="hero-input-wrap">
          <input
            className="hero-input"
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (!e.repeat && !submitInFlightRef.current && !loading) handle()
              }
            }}
            placeholder="Mobile app with auth, push notifications and offline sync"
          />
          <button className="hero-btn" onClick={handle} disabled={loading}>
            {loading
              ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><span className="spinner" />Generating…</span>
              : 'Generate →'}
          </button>
        </div>

        {err && <p style={{ margin: '0 0 12px', color: 'var(--red)', fontSize: 12, fontWeight: 600 }}>{err}</p>}

        <div className="hero-chips">
          {CHIPS.map((c) => (
            <span key={c} className="hero-chip" onClick={() => setIdea(c)}>{c}</span>
          ))}
        </div>

        <div className="hero-stats">
          <div className="hero-stat"><div className="hero-stat-val">DAG</div><div className="hero-stat-label">Graph View</div></div>
          <div className="hero-stat"><div className="hero-stat-val">CPM</div><div className="hero-stat-label">Critical Path</div></div>
          <div className="hero-stat"><div className="hero-stat-val">‖</div><div className="hero-stat-label">Parallel Tasks</div></div>
          <div className="hero-stat"><div className="hero-stat-val">AI</div><div className="hero-stat-label">Insights</div></div>
        </div>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════
   DASHBOARD
   ════════════════════════════════════════════════════════ */
function Dashboard({ workflow, projectName, onBack, onRegenerate }) {
  const [viewMode, setViewMode]       = useState('graph')   // 'graph' | 'list' | 'timeline'
  const [selectedId, setSelectedId]   = useState(null)
  const [isLoading, setIsLoading]     = useState(false)

  const { nodes: rawNodes, edges, order, explanation, insights } = workflow

  const nodes = useMemo(() => getLayoutedNodes(rawNodes, edges), [rawNodes, edges])

  const nodeById = useMemo(() => {
    const m = {}; nodes.forEach((n) => { m[n.id] = n }); return m
  }, [nodes])

  const nodeLabelMap = useMemo(() => {
    const m = {}; nodes.forEach((n) => { m[n.id] = n.data?.label || n.id }); return m
  }, [nodes])

  const selectedNode = selectedId ? nodeById[selectedId] : null

  const deps = useMemo(() =>
    edges.map((e) => {
      const s = nodeById[e.source]; const t = nodeById[e.target]
      if (!s || !t) return null
      return { id: e.id, src: s.data?.label || e.source, tgt: t.data?.label || e.target }
    }).filter(Boolean),
    [edges, nodeById]
  )

  const criticalCount  = nodes.filter((n) => n.data?.priority === 'High').length
  const parallelCount  = nodes.filter((n) => n.data?.parallel).length
  const blockedCount   = nodes.filter((n) => {
    return edges.filter((e) => e.target === n.id).length >= 2
  }).length

  const timelineRows = useMemo(() => buildTimeline(nodes, edges), [nodes, edges])
  const totalHrs     = timelineRows[0]?.totalHrs || 0

  /* Node click → select & update right panel */
  const flowNodes = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        selected: n.id === selectedId,
      })),
    [nodes, selectedId]
  )

  /* AI insight cards from backend insights + static reasoning */
  const insightCards = [
    {
      type: 'CRITICAL PATH', color: 'purple',
      title: 'On the critical path',
      body: 'Any delay here cascades to the entire delivery timeline. Prioritize unblocking this task above all others.',
    },
    {
      type: 'BOTTLENECK', color: 'amber',
      title: 'Convergence bottleneck',
      body: `${Math.max(2, edges.filter((e) => e.target === (selectedNode?.id)).length)} upstream tasks must complete first. Start notification templates in parallel to save time.`,
    },
    {
      type: 'SUGGESTION', color: 'green',
      title: 'Parallelizable subtask',
      body: 'Email template design can run with an upstream task concurrently — saving time on the critical path.',
    },
  ]

  /* Dep chips for selected node */
  const selectedDeps = selectedNode
    ? edges.filter((e) => e.target === selectedNode.id).map((e) => nodeLabelMap[e.source]).filter(Boolean)
    : []

  async function handleRegenerate() {
    if (isLoading) return
    setIsLoading(true)
    try {
      await onRegenerate()
    } catch (e) {
      console.error('[Dashboard] regenerate failed:', e)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="dashboard app">
      {/* ── Top Bar ── */}
      <header className="topbar">
        <div className="brand" style={{ cursor: 'pointer' }} onClick={onBack}>
          <div className="brand-logo">P</div>
          <span className="brand-name">PROMAP</span>
        </div>
        <div className="topbar-sep" />
        <div className="breadcrumb">
          <span style={{ cursor: 'pointer', color: 'var(--text-3)' }} onClick={onBack}>Workspace</span>
          <span>›</span>
          <span className="active">{projectName}</span>
        </div>
        <div className="topbar-spacer" />
        <div className="view-tabs">
          {['graph', 'list', 'timeline'].map((v) => (
            <button key={v} className={`view-tab${viewMode === v ? ' active' : ''}`} onClick={() => setViewMode(v)}>
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
        <button className="regen-btn" onClick={handleRegenerate} disabled={isLoading}>
          {isLoading ? 'Regenerating…' : '↺ Regenerate'}
        </button>
      </header>

      {/* ── Body ── */}
      <div className="dashboard-body">

        {/* ── Left Sidebar ── */}
        <aside className="sidebar">
          <div className="sidebar-section">
            <div className="sidebar-label">Views</div>
            {[
              { key: 'graph',    label: 'Graph View',  dot: '#2563eb' },
              { key: 'list',     label: 'List View',   dot: '#9b9aaa' },
              { key: 'timeline', label: 'Timeline',    dot: '#9b9aaa' },
            ].map((item) => (
              <div key={item.key}
                className={`sidebar-item${viewMode === item.key ? ' active' : ''}`}
                onClick={() => setViewMode(item.key)}
              >
                <div className="sidebar-item-left">
                  <div className="sidebar-dot" style={{ background: viewMode === item.key ? '#2563eb' : item.dot }} />
                  {item.label}
                </div>
              </div>
            ))}
          </div>

          <div className="sidebar-section">
            <div className="sidebar-label">Tasks</div>
            <div className="sidebar-item">
              <div className="sidebar-item-left"><div className="sidebar-dot" style={{ background: '#dc2626' }} />Critical</div>
              <span className="sidebar-count" style={{ background: '#fef2f2', color: '#dc2626' }}>{criticalCount}</span>
            </div>
            <div className="sidebar-item">
              <div className="sidebar-item-left"><div className="sidebar-dot" style={{ background: '#059669' }} />Parallel</div>
              <span className="sidebar-count" style={{ background: '#ecfdf5', color: '#059669' }}>{parallelCount}</span>
            </div>
            <div className="sidebar-item">
              <div className="sidebar-item-left"><div className="sidebar-dot" style={{ background: '#d97706' }} />Blocked</div>
              <span className="sidebar-count" style={{ background: '#fffbeb', color: '#d97706' }}>{blockedCount}</span>
            </div>
          </div>

          <div className="sidebar-section">
            <div className="sidebar-label">Insights</div>
            <div className="sidebar-item"><div className="sidebar-item-left"><div className="sidebar-dot" style={{ background: '#7c3aed' }} />AI Analysis</div></div>
            <div className="sidebar-item"><div className="sidebar-item-left"><div className="sidebar-dot" style={{ background: '#9b9aaa' }} />Bottlenecks</div></div>
          </div>
        </aside>

        {/* ── Center Content ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

          {/* Explanation banner */}
          {explanation && (
            <div style={{ padding: '12px 20px 0' }}>
              <div className="expl-banner">
                <div className="expl-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                </div>
                <div>
                  <p className="expl-label">AI Explanation</p>
                  <p className="expl-text">{explanation}</p>
                </div>
              </div>
            </div>
          )}

          {/* Insights strip (from backend .insights) */}
          {insights && (
            <div style={{ padding: '12px 20px 0' }}>
              <div className="insights-strip" style={{ padding: 0 }}>
                <div className="ins-card ins-card--start">
                  <p className="ins-label">Start with</p>
                  <p className="ins-value">{insights.start || '—'}</p>
                </div>
                <div className="ins-card ins-card--end">
                  <p className="ins-label">Finish with</p>
                  <p className="ins-value">{insights.end || '—'}</p>
                </div>
                <div className="ins-card ins-card--bottle">
                  <p className="ins-label">Bottleneck</p>
                  <p className="ins-value" style={{ color: '#d97706' }}>{insights.bottleneck || '—'}</p>
                </div>
              </div>
            </div>
          )}

          {/* ── GRAPH VIEW ── */}
          {viewMode === 'graph' && (
            <div className="canvas-area" style={{ flex: 1, marginTop: 12 }}>
              <div className="canvas-grid" />
              <WorkflowGraph nodes={flowNodes} edges={edges} onNodeClick={(_, n) => setSelectedId(n.id)} />
            </div>
          )}

          {/* ── LIST VIEW ── */}
          {viewMode === 'list' && (
            <div className="list-view-wrap" style={{ flex: 1 }}>
              <div className="list-card">
                <div className="list-card-header">
                  <span className="list-card-title">List view</span>
                  <span className="count-badge">{nodes.length} tasks</span>
                  <div className="list-spacer" />
                  <span className="list-hint">Topological order</span>
                </div>
                {nodes.map((node, i) => {
                  const incoming = edges.filter((e) => e.target === node.id)
                  return (
                    <div key={node.id} className="list-row" onClick={() => setSelectedId(node.id)}>
                      <span className="list-row-num">0{i + 1}</span>
                      <div className="list-row-dot" style={{ background: PRIORITY_DOT[node.data?.priority] || '#d97706' }} />
                      <span className="list-row-name">{node.data?.label}</span>
                      <div className="mini-chips">
                        {incoming.map((e) => (
                          <span key={e.id} className="mini-chip mini-chip--blue">{nodeLabelMap[e.source]}</span>
                        ))}
                      </div>
                      <PBadge p={node.data?.priority} />
                      {node.data?.parallel && <span className="mini-chip mini-chip--par">‖ Parallel</span>}
                    </div>
                  )
                })}
              </div>

              {/* Timeline in list view too */}
              <div className="list-card" style={{ marginTop: 16 }}>
                <div className="list-card-header">
                  <span className="list-card-title">Timeline view</span>
                  <span className="count-badge" style={{ background: '#fffbeb', color: '#d97706', borderColor: '#fde68a' }}>
                    {totalHrs}h total
                  </span>
                  <div className="list-spacer" />
                  <span className="list-hint">Critical path: {Math.round(totalHrs * .73)}h</span>
                </div>
                <div className="timeline-wrap">
                  <div className="timeline-header-row">
                    {['Day 1','Day 2','Day 3','Day 4','Day 5'].map((d) => (
                      <div key={d} className="timeline-day">{d}</div>
                    ))}
                  </div>

                  {/* Group parallel tasks visually */}
                  {(() => {
                    const rows = []
                    let i = 0
                    while (i < timelineRows.length) {
                      const row = timelineRows[i]
                      const nextRow = timelineRows[i + 1]
                      if (row.parallel || (nextRow && nextRow.parallel)) {
                        const group = [row]
                        while (timelineRows[i + 1]?.parallel) { i++; group.push(timelineRows[i]) }
                        rows.push({ type: 'parallel', items: group })
                      } else {
                        rows.push({ type: 'single', item: row })
                      }
                      i++
                    }
                    return rows.map((r, ri) => {
                      if (r.type === 'single') {
                        const row = r.item
                        const isLast = ri === rows.length - 1
                        return (
                          <div key={row.id} className="timeline-task-row">
                            <div className="timeline-label">{row.label}</div>
                            <div className="timeline-track">
                              {isLast && <div className="timeline-crit-line" style={{ left: `${row.startPct}%` }} />}
                              <TBar row={row} />
                            </div>
                          </div>
                        )
                      }
                      return (
                        <div key={ri} className="timeline-parallel-group">
                          <div className="timeline-par-label">‖ PARALLEL</div>
                          {r.items.map((row) => (
                            <div key={row.id} className="timeline-task-row">
                              <div className="timeline-label">{row.label}</div>
                              <div className="timeline-track"><TBar row={row} /></div>
                            </div>
                          ))}
                        </div>
                      )
                    })
                  })()}

                  <div className="timeline-legend">
                    {[
                      { color: '#fca5a5', border: '#ef4444', label: 'Critical' },
                      { color: '#fde68a', border: '#d97706', label: 'High' },
                      { color: '#bfdbfe', border: '#2563eb', label: 'Medium' },
                      { color: '#a7f3d0', border: '#059669', label: 'Parallel cluster' },
                    ].map((l) => (
                      <div key={l.label} className="legend-item">
                        <div className="legend-swatch" style={{ background: l.color, border: `1px solid ${l.border}` }} />
                        {l.label}
                      </div>
                    ))}
                    <div style={{ flex: 1 }} />
                    <span style={{ fontSize: 10, color: 'var(--text-3)' }}>Dashed = longest task → drives timeline</span>
                  </div>
                </div>
              </div>

              {/* Execution steps */}
              <div className="steps-wrap" style={{ padding: '16px 0 0' }}>
                <div className="steps-card">
                  <p className="steps-title">Execution Order</p>
                  <p className="steps-sub">Step-by-step sequence for completing the workflow.</p>
                  <ol className="steps-list">
                    {order.map((id, idx) => (
                      <li key={`${id}-${idx}`} className="steps-item">
                        <span className="steps-num">{idx + 1}</span>
                        <span className="steps-name">{nodeLabelMap[id] || id}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            </div>
          )}

          {/* ── TIMELINE VIEW ── */}
          {viewMode === 'timeline' && (
            <div className="list-view-wrap" style={{ flex: 1 }}>
              <div className="list-card">
                <div className="list-card-header">
                  <span className="list-card-title">Timeline view</span>
                  <span className="count-badge" style={{ background: '#fffbeb', color: '#d97706', borderColor: '#fde68a' }}>
                    {totalHrs}h total
                  </span>
                  <div className="list-spacer" />
                  <span className="list-hint">Critical path: {Math.round(totalHrs * .73)}h</span>
                </div>
                <div className="timeline-wrap">
                  <div className="timeline-header-row">
                    {['Day 1','Day 2','Day 3','Day 4','Day 5'].map((d) => (
                      <div key={d} className="timeline-day">{d}</div>
                    ))}
                  </div>
                  {timelineRows.map((row, ri) => (
                    <div key={row.id} className="timeline-task-row">
                      <div className="timeline-label">{row.label}</div>
                      <div className="timeline-track">
                        {ri === timelineRows.length - 1 && (
                          <div className="timeline-crit-line" style={{ left: `${row.startPct}%` }} />
                        )}
                        <TBar row={row} />
                      </div>
                    </div>
                  ))}
                  <div className="timeline-legend">
                    {[
                      { color: '#fca5a5', border: '#ef4444', label: 'Critical' },
                      { color: '#fde68a', border: '#d97706', label: 'High' },
                      { color: '#bfdbfe', border: '#2563eb', label: 'Medium' },
                      { color: '#a7f3d0', border: '#059669', label: 'Parallel cluster' },
                    ].map((l) => (
                      <div key={l.label} className="legend-item">
                        <div className="legend-swatch" style={{ background: l.color, border: `1px solid ${l.border}` }} />
                        {l.label}
                      </div>
                    ))}
                    <div style={{ flex: 1 }} />
                    <span style={{ fontSize: 10, color: 'var(--text-3)' }}>Dashed = longest task → drives timeline</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Right Panel ── */}
        <aside className="right-panel">
          {selectedNode ? (
            <>
              <div className="panel-header">
                <p className="panel-title">{selectedNode.data?.label}</p>
                <p className="panel-sub">Task details &amp; AI reasoning</p>
              </div>

              <div className="priority-row">
                <div className="priority-dot-lg" style={{ background: PRIORITY_DOT[selectedNode.data?.priority] || '#d97706' }} />
                <PBadge p={selectedNode.data?.priority} />
                <div style={{ flex: 1 }} />
              </div>

              <div className="panel-section">
                <p className="panel-section-label">Description</p>
                <p className="panel-desc">{selectedNode.data?.description || 'No description provided.'}</p>
              </div>

              {selectedDeps.length > 0 && (
                <div className="panel-section">
                  <p className="panel-section-label">Dependencies</p>
                  <div className="dep-chips">
                    {selectedDeps.map((d) => <span key={d} className="dep-chip">{d}</span>)}
                  </div>
                </div>
              )}

              {/* Features + Modules from backend */}
              {(selectedNode.data?.features?.length > 0 || selectedNode.data?.modules?.length > 0) && (
                <div className="panel-section">
                  {selectedNode.data?.features?.length > 0 && (
                    <>
                      <p className="panel-section-label">Features</p>
                      <div className="dep-chips" style={{ marginBottom: 10 }}>
                        {selectedNode.data.features.map((f) => (
                          <span key={f} className="dep-chip" style={{ background: 'var(--blue-bg)', borderColor: 'var(--blue-border)', color: '#1d4ed8' }}>{f}</span>
                        ))}
                      </div>
                    </>
                  )}
                  {selectedNode.data?.modules?.length > 0 && (
                    <>
                      <p className="panel-section-label">Modules</p>
                      <div className="dep-chips">
                        {selectedNode.data.modules.map((m) => (
                          <span key={m} className="dep-chip" style={{ background: '#ecfeff', borderColor: '#a5f3fc', color: '#155e75' }}>{m}</span>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              <div className="panel-section">
                <p className="panel-section-label">AI Reasoning</p>
                <div className="ai-reasoning-box">
                  <div className="ai-reasoning-header">
                    <span className="ai-chip-sm">AI</span>
                    <p className="ai-reasoning-title">Why this task exists</p>
                  </div>
                  <p className="ai-reasoning-body">
                    {selectedNode.data?.description
                      ? `${selectedNode.data.label} is a foundational step in this workflow — it enables downstream tasks to function correctly and cannot be deferred without blocking progress.`
                      : 'This task is part of the AI-generated execution plan.'}
                  </p>
                </div>
              </div>

              <div className="panel-section">
                <p className="panel-section-label">AI Insights</p>
                {insightCards.map((card) => (
                  <div key={card.type} className={`insight-card-panel insight-card-panel--${card.color}`}>
                    <div className="insight-type-chip">{card.type}</div>
                    <p className="insight-card-title">{card.title}</p>
                    <p className="insight-card-body">{card.body}</p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ padding: '24px 18px', color: 'var(--text-3)', fontSize: 12, lineHeight: 1.6 }}>
              <p style={{ margin: '0 0 8px', fontFamily: 'Sora, sans-serif', fontWeight: 700, fontSize: 13, color: 'var(--text-2)' }}>
                Task Details
              </p>
              <p style={{ margin: 0 }}>Click any node in the graph to see task details, dependencies, and AI reasoning here.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

/* Gantt bar helper */
function TBar({ row }) {
  const colors = {
    High:   { bg: '#fef2f2', border: '#fca5a5', text: '#b91c1c' },
    Medium: { bg: '#eff6ff', border: '#bfdbfe', text: '#1e40af' },
    Low:    { bg: '#ecfdf5', border: '#a7f3d0', text: '#065f46' },
  }
  const c = colors[row.priority] || colors.Medium
  return (
    <div
      className="timeline-bar"
      style={{
        left:        `${row.startPct}%`,
        width:       `${Math.max(row.widthPct, 8)}%`,
        background:  c.bg,
        borderWidth: '1px',
        borderColor: c.border,
        borderStyle: row.parallel ? 'dashed' : 'solid',
        color:       c.text,
      }}
    >
      {row.hrs > 4 ? `${row.label.split(' ')[0]} (${row.hrs}h)` : row.label.split(' ')[0]}
    </div>
  )
}

/* ════════════════════════════════════════════════════════
   ROOT APP
   ════════════════════════════════════════════════════════ */
export default function App() {
  const [workflow,    setWorkflow]    = useState(null)
  const [projectName, setProjectName] = useState('')
  const requestInFlightRef = useRef(false)
  const lastWorkflowLogRef = useRef('')

  useEffect(() => {
    if (!DEBUG_LOGS || !workflow) return
    const key = `${workflow.nodes?.length || 0}-${workflow.edges?.length || 0}-${workflow.order?.length || 0}-${projectName}`
    if (lastWorkflowLogRef.current === key) return
    lastWorkflowLogRef.current = key
    console.log('[App] workflow state update:', {
      nodes: workflow.nodes?.length || 0,
      edges: workflow.edges?.length || 0,
      order: workflow.order?.length || 0,
      projectName,
    })
  }, [workflow, projectName])

  async function handleGenerate(idea) {
    if (requestInFlightRef.current) return null
    requestInFlightRef.current = true
    try {
      const wf = await fetchWorkflow(idea)
      setWorkflow(wf)
      setProjectName(idea || 'My Project')
      return wf
    } finally {
      requestInFlightRef.current = false
    }
  }

  async function handleRegenerate() {
    if (requestInFlightRef.current) return null
    const idea = projectName?.trim()
    if (!idea) return null
    requestInFlightRef.current = true
    if (DEBUG_LOGS) console.log('[App] regenerate trigger:', { idea })
    try {
      const wf = await fetchWorkflow(idea)
      setWorkflow(wf)
      return wf
    } finally {
      requestInFlightRef.current = false
    }
  }

  if (!workflow) {
    return (
      <Landing
        onGenerate={async (idea) => {
          await handleGenerate(idea)
        }}
      />
    )
  }

  return (
    <Dashboard
      workflow={workflow}
      projectName={projectName}
      onBack={() => setWorkflow(null)}
      onRegenerate={handleRegenerate}
    />
  )
}