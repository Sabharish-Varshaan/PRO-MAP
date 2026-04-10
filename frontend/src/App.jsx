import { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import 'react-flow-renderer/dist/style.css'
import './App.css'
import WorkflowGraph from './components/WorkflowGraph'
import RightPanel from './components/RightPanel'
import RequirementsPanel from './components/RequirementsPanel'
import InsightsPanel from './components/InsightsPanel'
import ExecutionSteps from './components/ExecutionSteps'
import ParallelTasks from './components/ParallelTasks'
import { getLayoutedNodes } from './utils/layout'

/* ── API ─────────────────────────────────────────────── */
const API_BASE_URL = 'http://127.0.0.1:8000'
const API_TIMEOUT_MS = 90000
const DEBUG_LOGS = false

const EMPTY_INSIGHTS = {
  critical_path: [],
  top_bottlenecks: [],
  parallel_groups: [],
  start_task: '',
  end_task: '',
  explanation: '',
}

/* ── Normalize backend response ──────────────────────── */
function normalizeWorkflow(raw) {
  const payload = (raw && typeof raw === 'object') ? (raw.workflow && typeof raw.workflow === 'object' ? raw.workflow : raw) : {}
  const rawTasks = Array.isArray(payload?.tasks) ? payload.tasks : []
  const rawNodes = Array.isArray(payload?.nodes) ? payload.nodes : []
  const rawEdges = Array.isArray(payload?.edges) ? payload.edges : []
  const rawOrder = Array.isArray(payload?.order) ? payload.order : []

  const isPlaceholder = (label) => {
    const s = String(label || '').trim().toLowerCase()
    return s === '' || /^((task|step|node|n)\s*\d*)$/.test(s)
  }

  const nodeSource = rawNodes.length > 0 ? rawNodes : rawTasks.map((task, i) => ({
    id: String(task?.id || `n${i + 1}`),
    type: 'task',
    position: { x: 0, y: 0 },
    data: {
      label: task?.label,
      description: task?.description,
      features: task?.features,
      modules: task?.modules,
      priority: task?.priority,
    },
  }))

  const nodes = nodeSource.map((node, i) => {
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
        ...data,
        label:       isPlaceholder(label) && desc ? desc : label,
        description: desc,
        features:    Array.isArray(data.features) ? data.features.filter(Boolean) : [],
        modules:     Array.isArray(data.modules)  ? data.modules.filter(Boolean)  : [],
        priority,
        parallel: Boolean(data.parallel || node.parallel),
        is_critical: Boolean(data.is_critical || node.is_critical),
        is_bottleneck: Boolean(data.is_bottleneck || node.is_bottleneck),
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
    explanation: payload?.explanation?.trim?.() || payload?.insights?.explanation?.trim?.() || '',
    insights: (payload?.insights && typeof payload.insights === 'object')
      ? {
          critical_path: Array.isArray(payload.insights.critical_path)
            ? payload.insights.critical_path.map((id) => String(id))
            : [],
          top_bottlenecks: Array.isArray(payload.insights.top_bottlenecks)
            ? payload.insights.top_bottlenecks.map((id) => String(id))
            : [],
          parallel_groups: Array.isArray(payload.insights.parallel_groups)
            ? payload.insights.parallel_groups
                .filter((group) => Array.isArray(group))
                .map((group) => group.map((id) => String(id)))
            : [],
          start_task: String(payload.insights.start_task || '').trim(),
          end_task: String(payload.insights.end_task || '').trim(),
          explanation: String(payload.insights.explanation || payload.explanation || '').trim(),
        }
      : EMPTY_INSIGHTS,
  }
}

async function fetchWorkflowProgressive(desc, setProgress, onPartialUpdate) {
  setProgress('Generating tasks...')
  const tasksRes = await axios.post(
    `${API_BASE_URL}/generate-tasks`,
    { project_description: desc },
    { timeout: API_TIMEOUT_MS }
  )
  const tasksPayload = { tasks: tasksRes.data?.tasks || [] }
  const taskOnly = normalizeWorkflow(tasksPayload)
  if (typeof onPartialUpdate === 'function') {
    onPartialUpdate(taskOnly)
  }

  setProgress('Building workflow...')
  const graphRes = await axios.post(
    `${API_BASE_URL}/build-graph`,
    { tasks: tasksPayload.tasks },
    { timeout: API_TIMEOUT_MS }
  )
  const graphPayload = {
    nodes: graphRes.data?.nodes || [],
    edges: graphRes.data?.edges || [],
    order: graphRes.data?.order || [],
  }
  const graphOnly = normalizeWorkflow(graphPayload)
  if (typeof onPartialUpdate === 'function') {
    onPartialUpdate(graphOnly)
  }

  setProgress('Analyzing dependencies...')
  const insightsRes = await axios.post(
    `${API_BASE_URL}/analyze-workflow`,
    { nodes: graphPayload.nodes, edges: graphPayload.edges },
    { timeout: API_TIMEOUT_MS }
  )

  const finalPayload = {
    ...graphPayload,
    insights: insightsRes.data?.insights || EMPTY_INSIGHTS,
    explanation: insightsRes.data?.insights?.explanation || '',
  }

  return normalizeWorkflow(finalPayload)
}

async function fetchProjectWorkflow(desc, setProgress, onPartialUpdate) {
  try {
    const normalized = await fetchWorkflowProgressive(desc, setProgress, onPartialUpdate)
    if (DEBUG_LOGS) console.log('[fetchProjectWorkflow] normalized workflow:', normalized)
    return normalized
  } catch (e) {
    if (e?.code === 'ECONNABORTED') {
      console.error('[fetchProjectWorkflow] request timed out:', {
        timeoutMs: API_TIMEOUT_MS,
        message: e?.message,
      })
    }
    console.error('[fetchProjectWorkflow] request failed:', {
      message: e?.message,
      code: e?.code,
      status: e?.response?.status,
      data: e?.response?.data,
    })
    throw e
  }
}

async function fetchWorkflow(requirementsData) {
  try {
    if (DEBUG_LOGS) {
      console.log('[fetchWorkflow] generating workflow from requirements:', requirementsData)
    }

    const response = await axios.post(
      `${API_BASE_URL}/generate-workflow`,
      { requirements_data: requirementsData },
      { timeout: API_TIMEOUT_MS }
    )

    if (DEBUG_LOGS) {
      console.log('[fetchWorkflow] /generate-workflow response:', response.data)
    }

    return response.data
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
const PRIORITY_DOT = { High: '#f59e0b', Medium: '#3b82f6', Low: '#64748b' }

function PBadge({ p }) {
  return <span className={`pbadge pbadge--${p || 'Medium'}`}>{p || 'Medium'}</span>
}

/* ── Gantt row estimates (backend doesn't send hours, so we distribute) ── */
function buildTimeline(nodes, order, insights) {
  const byId = {}
  nodes.forEach((n) => { byId[n.id] = n })

  const orderedIds = (Array.isArray(order) ? order : [])
    .map((id) => String(id))
    .filter((id) => byId[id])

  const timelineIds = orderedIds.length > 0 ? orderedIds : nodes.map((n) => n.id)
  const totalSteps = Math.max(timelineIds.length, 1)
  const totalDays = Math.max(totalSteps, 5)
  const criticalSet = new Set(insights?.critical_path || [])
  const bottleneckSet = new Set(insights?.top_bottlenecks || [])
  const parallelSet = new Set(
    (insights?.parallel_groups || [])
      .filter((group) => group.length > 1)
      .flat()
      .map((id) => String(id)),
  )

  return timelineIds.map((id, index) => {
    const start = index
    const duration = 1
    return {
      id,
      label: byId[id]?.data?.label || id,
      priority: byId[id]?.data?.priority,
      parallel: parallelSet.has(id),
      isCritical: criticalSet.has(id),
      isBottleneck: bottleneckSet.has(id),
      start,
      duration,
      step: index + 1,
      totalDays,
    }
  })
}

/* ════════════════════════════════════════════════════════
   LANDING PAGE
   ════════════════════════════════════════════════════════ */
function Landing({ onGenerate, progressText }) {
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
              ? <span className="hero-btn-loading"><span className="spinner" />Generating…</span>
              : 'Generate →'}
          </button>
        </div>

        {loading && progressText && (
          <p className="hero-progress-text">
            {progressText}
          </p>
        )}

        {err && <p className="hero-error-text">{err}</p>}

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

function TimelinePanel({ timelineRows, timelineDayCount, criticalPathLabels }) {
  const timelineColumns = `220px repeat(${timelineDayCount}, minmax(120px, 1fr))`

  return (
    <div className="timeline-shell">
      <h3 className="timeline-title">Execution Timeline</h3>
      <div className="timeline-wrap">
        <div className="timeline-header-row" style={{ gridTemplateColumns: timelineColumns }}>
          <div className="timeline-day timeline-day--label">Task</div>
          {Array.from({ length: timelineDayCount }, (_, i) => (
            <div key={`timeline-day-${i + 1}`} className="timeline-day">Day {i + 1}</div>
          ))}
        </div>

        {timelineRows.map((row) => (
          <div
            key={row.id}
            className={`timeline-task-row${row.isCritical ? ' timeline-task-row--critical' : ''}`}
            style={{ gridTemplateColumns: timelineColumns }}
          >
            <div className="timeline-label">{row.label}</div>
            <TBar row={row} />
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

/* ════════════════════════════════════════════════════════
   DASHBOARD
   ════════════════════════════════════════════════════════ */
function Dashboard({ workflow, requirementsData, workflowData, isWorkflowLoading, workflowError, projectName, onBack, onRegenerate, loadingStage }) {
  const [viewMode, setViewMode]       = useState('graph')   // 'graph' | 'list' | 'timeline'
  const [selectedNode, setSelectedNode] = useState(null)
  const [activeTab, setActiveTab]     = useState('analysis')
  const [isLoading, setIsLoading]     = useState(false)

  const hasWorkflow = Boolean(workflow && Array.isArray(workflow.nodes))
  const { rawNodes, edges, order, explanation, insights } = useMemo(() => {
    if (!hasWorkflow) {
      return {
        rawNodes: [],
        edges: [],
        order: [],
        explanation: '',
        insights: null,
      }
    }

    return {
      rawNodes: workflow.nodes,
      edges: Array.isArray(workflow.edges) ? workflow.edges : [],
      order: Array.isArray(workflow.order) ? workflow.order : [],
      explanation: workflow.explanation || '',
      insights: workflow.insights || null,
    }
  }, [hasWorkflow, workflow])

  const safeInsights = useMemo(() => insights || EMPTY_INSIGHTS, [insights])

  const nodes = useMemo(() => getLayoutedNodes(rawNodes, edges), [rawNodes, edges])

  const nodeLabelMap = useMemo(() => {
    const m = {}; nodes.forEach((n) => { m[n.id] = n.data?.label || n.id }); return m
  }, [nodes])

  const criticalSet = useMemo(() => new Set(safeInsights.critical_path || []), [safeInsights])
  const bottleneckSet = useMemo(() => new Set(safeInsights.top_bottlenecks || []), [safeInsights])
  const parallelNodeSet = useMemo(
    () => new Set((safeInsights.parallel_groups || []).filter((group) => group.length > 1).flat()),
    [safeInsights],
  )

  const criticalCount = criticalSet.size
  const parallelCount = parallelNodeSet.size
  const blockedCount = bottleneckSet.size

  const timelineRows = useMemo(() => buildTimeline(nodes, order, safeInsights), [nodes, order, safeInsights])
  const timelineDayCount = Math.max(timelineRows[0]?.totalDays || 0, 5)
  const criticalPathLabels = (safeInsights.critical_path || []).map((id) => nodeLabelMap[id] || id)
  const selectedNodeId = selectedNode?.id || null

  const flowNodes = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        selected: n.id === selectedNodeId,
        data: {
          ...n.data,
          is_critical: criticalSet.has(n.id),
          is_bottleneck: bottleneckSet.has(n.id),
          parallel: parallelNodeSet.has(n.id),
        },
        style: {
          ...(n.style || {}),
          border: criticalSet.has(n.id) ? '2px solid #ef4444' : (n.style?.border || '1px solid #e5e7eb'),
          backgroundColor: bottleneckSet.has(n.id) ? '#fff7ed' : (n.style?.backgroundColor || '#ffffff'),
        },
      })),
    [nodes, selectedNodeId, criticalSet, bottleneckSet, parallelNodeSet]
  )

  const apiWorkflowGraph = useMemo(() => {
    const payload =
      (workflowData && typeof workflowData === 'object' && workflowData.workflow && typeof workflowData.workflow === 'object')
        ? workflowData.workflow
        : workflowData

    const rawNodes = Array.isArray(payload?.nodes) ? payload.nodes : []
    const rawEdges = Array.isArray(payload?.edges) ? payload.edges : []
    const rawOrder = Array.isArray(payload?.order) ? payload.order : []
    const rawParallelGroups = Array.isArray(payload?.parallel_groups) ? payload.parallel_groups : []
    const criticalPathIds = Array.isArray(payload?.critical_path)
      ? payload.critical_path.map((id) => String(id))
      : []
    const bottleneckIds = Array.isArray(payload?.bottlenecks)
      ? payload.bottlenecks
          .map((item) => {
            if (typeof item === 'string' || typeof item === 'number') {
              return String(item)
            }
            if (item && typeof item === 'object') {
              return String(item.id || item.node_id || '')
            }
            return ''
          })
          .filter(Boolean)
      : []
    const criticalPathSet = new Set(criticalPathIds)
    const bottleneckSet = new Set(bottleneckIds)

    const sanitizedNodes = rawNodes
      .filter((n) => n && typeof n === 'object' && n.id !== undefined && n.id !== null)
      .map((n, i) => {
        const id = String(n.id || `n${i + 1}`)
        const isCritical = criticalPathSet.has(id)
        const isBottleneck = bottleneckSet.has(id)

        return {
          ...n,
          id,
          data: {
            ...(n.data || {}),
            is_bottleneck: Boolean((n.data && n.data.is_bottleneck) || isBottleneck),
            warning_icon: isBottleneck,
          },
          style: {
            ...(n.style || {}),
            ...(isCritical
              ? {
                  backgroundColor: '#facc15',
                  border: '3px solid #ca8a04',
                }
              : {}),
            ...(isBottleneck && !isCritical
              ? {
                  border: '3px solid #dc2626',
                }
              : {}),
            ...(isBottleneck && isCritical
              ? {
                  boxShadow: '0 0 0 2px #dc2626',
                }
              : {}),
          },
        }
      })

    const nodeIds = new Set(sanitizedNodes.map((n) => n.id))

    const sanitizedEdges = rawEdges
      .filter((e) => e && typeof e === 'object')
      .map((e, i) => {
        const source = String(e.source || e.from || '')
        const target = String(e.target || e.to || '')
        const isCriticalEdge = criticalPathSet.has(source) && criticalPathSet.has(target)

        return {
          ...e,
          id: String(e.id || `e-${source}-${target}-${i}`),
          source,
          target,
          style: {
            ...(e.style || {}),
            ...(isCriticalEdge
              ? {
                  stroke: '#f59e0b',
                  strokeWidth: 4,
                }
              : {}),
          },
          markerEnd: isCriticalEdge
            ? { type: 'arrowclosed', color: '#f59e0b' }
            : e.markerEnd,
        }
      })
      .filter((e) => e.source && e.target && nodeIds.has(e.source) && nodeIds.has(e.target))

    const sanitizedOrder = rawOrder
      .map((id) => String(id))
      .filter((id) => nodeIds.has(id))

    const sanitizedParallelGroups = rawParallelGroups
      .filter((group) => Array.isArray(group))
      .map((group) => group.map((id) => String(id)).filter((id) => nodeIds.has(id)))
      .filter((group) => group.length > 0)

    return {
      nodes: sanitizedNodes,
      edges: sanitizedEdges,
      order: sanitizedOrder,
      parallelGroups: sanitizedParallelGroups,
    }
  }, [workflowData])

  const graphNodes = apiWorkflowGraph.nodes.length > 0 ? apiWorkflowGraph.nodes : flowNodes
  const graphEdges = apiWorkflowGraph.edges.length > 0 ? apiWorkflowGraph.edges : edges
  const executionOrder = apiWorkflowGraph.order.length > 0 ? apiWorkflowGraph.order : order
  const parallelGroups = apiWorkflowGraph.parallelGroups || []
  const executionNodeLabelMap = useMemo(() => {
    const map = {}
    graphNodes.forEach((node) => {
      if (!node || node.id === undefined || node.id === null) return
      const id = String(node.id)
      const dataLabel = node.data?.label
      map[id] = dataLabel || node.label || node.name || id
    })
    return map
  }, [graphNodes])
  const workflowInsights = useMemo(() => {
    const payload =
      (workflowData && typeof workflowData === 'object' && workflowData.workflow && typeof workflowData.workflow === 'object')
        ? workflowData.workflow
        : workflowData

    return (payload?.insights && typeof payload.insights === 'object') ? payload.insights : null
  }, [workflowData])
  const flowStages = useMemo(() => {
    const hasRequirements = Boolean(requirementsData)
    const hasWorkflowOutput = graphNodes.length > 0
    const hasInsights = Boolean(workflowInsights)

    return [
      { key: 'input', label: 'Input', done: Boolean(projectName), loading: false },
      { key: 'requirements', label: 'Requirements', done: hasRequirements, loading: !hasRequirements && isWorkflowLoading },
      { key: 'workflow', label: 'Workflow', done: hasWorkflowOutput, loading: isWorkflowLoading },
      { key: 'insights', label: 'Insights', done: hasInsights, loading: !hasInsights && isWorkflowLoading },
    ]
  }, [projectName, requirementsData, graphNodes, workflowInsights, isWorkflowLoading])

  async function handleRegenerate() {
    if (isLoading) return
    setIsLoading(true)
    try {
      setSelectedNode(null)
      setActiveTab('analysis')
      setViewMode('graph')
      await onRegenerate(projectName)
    } catch (e) {
      console.error('[Dashboard] regenerate failed:', e)
    } finally {
      setIsLoading(false)
    }
  }

  if (!hasWorkflow) return null

  return (
    <div className="dashboard app">
      {/* ── Top Bar ── */}
      <header className="topbar">
        <div className="brand brand--clickable" onClick={onBack}>
          <div className="brand-logo">P</div>
          <span className="brand-name">PROMAP</span>
        </div>
        <div className="topbar-sep" />
        <div className="breadcrumb">
          <span className="breadcrumb-link" onClick={onBack}>Workspace</span>
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

      {isLoading && loadingStage && (
        <div className="loading-stage">
          {loadingStage}
        </div>
      )}

      {/* ── Body ── */}
      <div className="dashboard-body">

        {/* ── Left Sidebar ── */}
        <aside className="sidebar">
          <div className="sidebar-section">
            <div className="sidebar-label">Views</div>
            {[
              { key: 'graph',    label: 'Graph View',  dot: '#3b82f6' },
              { key: 'list',     label: 'List View',   dot: '#9b9aaa' },
              { key: 'timeline', label: 'Timeline',    dot: '#9b9aaa' },
            ].map((item) => (
              <div key={item.key}
                className={`sidebar-item${viewMode === item.key ? ' active' : ''}`}
                onClick={() => setViewMode(item.key)}
              >
                <div className="sidebar-item-left">
                  <div className="sidebar-dot" style={{ background: viewMode === item.key ? '#3b82f6' : item.dot }} />
                  {item.label}
                </div>
              </div>
            ))}
          </div>

          <div className="sidebar-section">
            <div className="sidebar-label">Tasks</div>
            <div className="sidebar-item">
              <div className="sidebar-item-left"><div className="sidebar-dot" style={{ background: '#ef4444' }} />Critical</div>
              <span className="sidebar-count" style={{ background: '#fee2e2', color: '#ef4444' }}>{criticalCount}</span>
            </div>
            <div className="sidebar-item">
              <div className="sidebar-item-left"><div className="sidebar-dot" style={{ background: '#10b981' }} />Parallel</div>
              <span className="sidebar-count" style={{ background: '#ecfdf5', color: '#10b981' }}>{parallelCount}</span>
            </div>
            <div className="sidebar-item">
              <div className="sidebar-item-left"><div className="sidebar-dot" style={{ background: '#f59e0b' }} />Blocked</div>
              <span className="sidebar-count" style={{ background: '#fffbeb', color: '#f59e0b' }}>{blockedCount}</span>
            </div>
          </div>

          <div className="sidebar-section">
            <div className="sidebar-label">Insights</div>
            <div className={`sidebar-item${activeTab === 'analysis' ? ' active' : ''}`} onClick={() => setActiveTab('analysis')}>
              <div className="sidebar-item-left"><div className="sidebar-dot" style={{ background: '#3b82f6' }} />AI Analysis</div>
            </div>
            <div className={`sidebar-item${activeTab === 'bottlenecks' ? ' active' : ''}`} onClick={() => setActiveTab('bottlenecks')}>
              <div className="sidebar-item-left"><div className="sidebar-dot" style={{ background: '#ef4444' }} />Bottlenecks</div>
            </div>
          </div>
        </aside>

        {/* ── Center Content ── */}
        <div className="dashboard-main">

          <div className="dashboard-section-wrap">
            <div className="expl-banner">
              <p className="expl-label">Pipeline Status</p>
              <p className="expl-text">
                {flowStages.map((stage) => {
                  if (stage.done) return `${stage.label}: done`
                  if (stage.loading) return `${stage.label}: loading`
                  return `${stage.label}: waiting`
                }).join(' | ')}
              </p>
            </div>
          </div>

          <div className="dashboard-section-wrap">
            <RequirementsPanel requirementsData={requirementsData} isLoading={!requirementsData && isWorkflowLoading} />
          </div>

          <div className="dashboard-section-wrap">
            <InsightsPanel insights={workflowInsights} isLoading={isWorkflowLoading} />
          </div>

          {isWorkflowLoading && (
            <div className="dashboard-section-wrap">
              <div className="expl-banner">
                <p className="expl-label">Workflow Generation</p>
                <p className="expl-text">Generating graph from requirements...</p>
              </div>
            </div>
          )}

          {workflowError && (
            <div className="dashboard-section-wrap">
              <div className="expl-banner" style={{ borderColor: '#fecaca', background: '#fef2f2' }}>
                <p className="expl-label" style={{ color: '#b91c1c' }}>Workflow Generation Error</p>
                <p className="expl-text" style={{ color: '#7f1d1d' }}>{workflowError}</p>
              </div>
            </div>
          )}

          {/* Explanation banner */}
          {explanation && (
            <div className="dashboard-section-wrap">
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
            <div className="dashboard-section-wrap">
              <div className="insights-strip insights-strip--compact">
                <div className="ins-card ins-card--start">
                  <p className="ins-label">Start with</p>
                  <p className="ins-value">{safeInsights.start_task || '—'}</p>
                </div>
                <div className="ins-card ins-card--end">
                  <p className="ins-label">Finish with</p>
                  <p className="ins-value">{safeInsights.end_task || '—'}</p>
                </div>
                <div className="ins-card ins-card--bottle">
                  <p className="ins-label">Critical Path</p>
                  <p className="ins-value ins-value--critical-path">
                    {criticalPathLabels.length > 0 ? criticalPathLabels.join(' → ') : '—'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ── GRAPH VIEW ── */}
          {viewMode === 'graph' && (
            <div className="canvas-area canvas-area--spaced">
              <div className="canvas-grid" />
              <WorkflowGraph
                nodes={graphNodes}
                edges={graphEdges}
                insights={safeInsights}
                isLoading={isWorkflowLoading}
                onNodeClick={(_, n) => {
                  setSelectedNode(n)
                }}
              />
            </div>
          )}

          {/* ── LIST VIEW ── */}
          {viewMode === 'list' && (
            <div className="list-view-wrap">
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
                    <div key={node.id} className="list-row" onClick={() => setSelectedNode(node)}>
                      <span className="list-row-num">0{i + 1}</span>
                      <div className="list-row-dot" style={{ background: PRIORITY_DOT[node.data?.priority] || '#f59e0b' }} />
                      <span className="list-row-name">{node.data?.label}</span>
                      <div className="mini-chips">
                        {incoming.map((e) => (
                          <span key={e.id} className="mini-chip mini-chip--blue">{nodeLabelMap[e.source]}</span>
                        ))}
                      </div>
                      <PBadge p={node.data?.priority} />
                      {node.data?.is_critical && <span className="mini-chip mini-chip--red">🔴 Critical</span>}
                      {node.data?.is_bottleneck && <span className="mini-chip mini-chip--amber">⚠ Bottleneck</span>}
                      {parallelNodeSet.has(node.id) && <span className="mini-chip mini-chip--par">‖ Parallel</span>}
                    </div>
                  )
                })}
              </div>

              {/* Timeline in list view too */}
              <div className="list-card list-card--timeline">
                <div className="list-card-header">
                  <span className="list-card-title">Timeline view</span>
                  <span className="count-badge count-badge--timeline">
                    {timelineRows.length} steps
                  </span>
                  <div className="list-spacer" />
                  <span className="list-hint">Critical path: {criticalPathLabels.join(' → ') || '—'}</span>
                </div>
                <TimelinePanel
                  timelineRows={timelineRows}
                  timelineDayCount={timelineDayCount}
                  criticalPathLabels={criticalPathLabels}
                />
              </div>

              {/* Execution steps */}
              <div className="steps-wrap steps-wrap--tight">
                <ExecutionSteps
                  order={executionOrder}
                  nodeLabelMap={executionNodeLabelMap}
                  isLoading={isWorkflowLoading}
                />
              </div>

              <div className="steps-wrap steps-wrap--tight">
                <ParallelTasks
                  parallelGroups={parallelGroups}
                  nodeLabelMap={executionNodeLabelMap}
                  isLoading={isWorkflowLoading}
                />
              </div>
            </div>
          )}

          {/* ── TIMELINE VIEW ── */}
          {viewMode === 'timeline' && (
            <div className="list-view-wrap">
              <div className="list-card">
                <div className="list-card-header">
                  <span className="list-card-title">Timeline view</span>
                  <span className="count-badge count-badge--timeline">
                    {timelineRows.length} steps
                  </span>
                  <div className="list-spacer" />
                  <span className="list-hint">Critical path: {criticalPathLabels.join(' → ') || '—'}</span>
                </div>
                <TimelinePanel
                  timelineRows={timelineRows}
                  timelineDayCount={timelineDayCount}
                  criticalPathLabels={criticalPathLabels}
                />
              </div>
            </div>
          )}
        </div>

        <RightPanel
          selectedNode={selectedNode}
          insights={safeInsights}
          nodes={nodes}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
      </div>
    </div>
  )
}

/* Gantt bar helper */
function TBar({ row }) {
  const colors = {
    High: { bg: '#f59e0b', text: '#111827' },
    Medium: { bg: '#3b82f6', text: '#ffffff' },
    Low: { bg: '#64748b', text: '#ffffff' },
    Parallel: { bg: '#10b981', text: '#ffffff' },
    Critical: { bg: '#ef4444', text: '#ffffff' },
  }

  let c = colors[row.priority] || colors.Medium
  if (row.parallel) c = colors.Parallel
  if (row.isCritical) c = colors.Critical

  return (
    <div
      className="timeline-bar"
      style={{
        gridColumn: `${row.start + 2} / span ${row.duration}`,
        background: c.bg,
        color: c.text,
      }}
    >
      {`${row.step}. ${row.label}`}
    </div>
  )
}

/* ════════════════════════════════════════════════════════
   ROOT APP
   ════════════════════════════════════════════════════════ */
export default function App() {
  const [workflow,    setWorkflow]    = useState(null)
  const [requirementsData, setRequirementsData] = useState(null)
  const [workflowData, setWorkflowData] = useState(null)
  const [isWorkflowLoading, setIsWorkflowLoading] = useState(false)
  const [workflowError, setWorkflowError] = useState('')
  const [projectName, setProjectName] = useState('')
  const [loadingStage, setLoadingStage] = useState('')
  const requestInFlightRef = useRef(false)
  const lastRequirementsKeyRef = useRef('')

  async function handleGenerate(idea) {
    if (requestInFlightRef.current) return null
    requestInFlightRef.current = true
    setWorkflowError('')
    setWorkflowData(null)
    try {
      const wf = await fetchProjectWorkflow(
        idea,
        setLoadingStage,
        (partial) => {
          setWorkflow((prev) => {
            if (!prev) return partial
            return {
              ...prev,
              ...partial,
              insights: partial.insights || prev.insights || EMPTY_INSIGHTS,
              explanation: partial.explanation || prev.explanation || '',
            }
          })
        }
      )
      setWorkflow(wf)
      setProjectName(idea || 'My Project')
      return wf
    } finally {
      setLoadingStage('')
      requestInFlightRef.current = false
    }
  }

  async function handleRegenerate(ideaOverride) {
    if (requestInFlightRef.current) return null
    const idea = String(ideaOverride || projectName || '').trim()
    if (!idea) return null
    requestInFlightRef.current = true
    setWorkflowError('')
    setWorkflowData(null)
    try {
      const wf = await fetchProjectWorkflow(
        idea,
        setLoadingStage,
        (partial) => {
          setWorkflow((prev) => {
            if (!prev) return partial
            return {
              ...prev,
              ...partial,
              insights: partial.insights || prev.insights || EMPTY_INSIGHTS,
              explanation: partial.explanation || prev.explanation || '',
            }
          })
        }
      )
      setWorkflow(wf)
      return wf
    } finally {
      setLoadingStage('')
      requestInFlightRef.current = false
    }
  }

  useEffect(() => {
    const extractedRequirements =
      workflow?.requirements_data ||
      workflow?.requirementsData ||
      workflow?.requirements_bundle ||
      workflow?.requirements ||
      null

    if (!extractedRequirements) {
      setRequirementsData(null)
      return
    }

    const key = JSON.stringify(extractedRequirements)
    if (lastRequirementsKeyRef.current === key) return
    lastRequirementsKeyRef.current = key
    setRequirementsData(extractedRequirements)
  }, [workflow])

  useEffect(() => {
    if (!requirementsData) return

    let cancelled = false

    async function generateWorkflowFromRequirements() {
      setIsWorkflowLoading(true)
      setWorkflowError('')

      try {
        const generatedWorkflow = await fetchWorkflow(requirementsData)
        if (!cancelled) {
          setWorkflowData(generatedWorkflow)
        }
      } catch (e) {
        if (!cancelled) {
          const message =
            e?.code === 'ECONNABORTED'
              ? 'Workflow generation timed out. Please try again.'
              : 'Failed to generate workflow from requirements.'
          setWorkflowError(message)
          console.error('[App] workflow generation from requirements failed:', e)
        }
      } finally {
        if (!cancelled) {
          setIsWorkflowLoading(false)
        }
      }
    }

    generateWorkflowFromRequirements()

    return () => {
      cancelled = true
    }
  }, [requirementsData])

  function handleBackToLanding() {
    setWorkflow(null)
    setWorkflowData(null)
    setRequirementsData(null)
    setWorkflowError('')
    setLoadingStage('')
    setProjectName('')
  }

  if (!workflow) {
    return (
      <Landing
        progressText={loadingStage}
        onGenerate={async (idea) => {
          await handleGenerate(idea)
        }}
      />
    )
  }

  return (
    <Dashboard
      workflow={workflow}
      requirementsData={requirementsData}
      workflowData={workflowData}
      isWorkflowLoading={isWorkflowLoading}
      workflowError={workflowError}
      projectName={projectName}
      onBack={handleBackToLanding}
      onRegenerate={handleRegenerate}
      loadingStage={loadingStage}
    />
  )
}