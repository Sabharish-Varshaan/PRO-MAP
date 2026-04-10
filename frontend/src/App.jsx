import { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import 'react-flow-renderer/dist/style.css'
import './App.css'
import WorkflowGraph from './components/WorkflowGraph'
import RightPanel from './components/RightPanel'
import RequirementsPanel from './components/RequirementsPanel'
import InsightsPanel from './components/InsightsPanel'
import ExecutionSteps from './components/ExecutionSteps'
import ParallelTasks from './components/ParallelTasks'
import Timeline from './components/Timeline'
import ErrorBoundary from './components/ErrorBoundary'
import AppLayout from './components/AppLayout'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Onboarding from './pages/Onboarding'
import { useAppStore } from './store/useAppStore'
import { gatherRequirements, getProject, listProjects } from './utils/api'
import { getLayoutedNodes } from './utils/layout'

/* ── API ─────────────────────────────────────────────── */
const API_BASE_URL = 'http://127.0.0.1:8000'
const API_TIMEOUT_MS = 90000
const DEBUG_LOGS = false
const AUTH_TOKEN_KEY = 'promap_auth_token'

const EMPTY_INSIGHTS = {
  critical_path: [],
  top_bottlenecks: [],
  parallel_groups: [],
  start_task: '',
  end_task: '',
  explanation: '',
}

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function saveAuthToken(token) {
  if (!token) return
  localStorage.setItem(AUTH_TOKEN_KEY, token)
}

function loadAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY) || ''
}

function clearAuthToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY)
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
    requirements: (payload?.requirements && typeof payload.requirements === 'object') ? payload.requirements : {},
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

async function fetchWorkflowProgressive(desc, requirements, projectId, token, setProgress, onPartialUpdate) {
  setProgress('Generating tasks...')
  const tasksRes = await axios.post(
    `${API_BASE_URL}/generate-tasks`,
    { description: desc, requirements, project_id: projectId },
    { timeout: API_TIMEOUT_MS, headers: authHeaders(token) }
  )
  console.log('STEP DATA:', {
    step: 'app-generate-tasks',
    projectId,
    resolvedProjectId: tasksRes.data?.project_id,
    tasks: tasksRes.data?.tasks,
  })
  const resolvedProjectId = Number(tasksRes.data?.project_id || projectId || 0)
  const tasksPayload = { tasks: tasksRes.data?.tasks || [] }
  const taskOnly = normalizeWorkflow(tasksPayload)
  if (typeof onPartialUpdate === 'function') {
    onPartialUpdate(taskOnly)
  }

  setProgress('Building workflow...')
  const graphRes = await axios.post(
    `${API_BASE_URL}/build-graph`,
    { project_id: resolvedProjectId, tasks: tasksPayload.tasks },
    { timeout: API_TIMEOUT_MS, headers: authHeaders(token) }
  )
  console.log('STEP DATA:', {
    step: 'app-build-graph',
    projectId: resolvedProjectId,
    nodes: graphRes.data?.nodes,
    edges: graphRes.data?.edges,
    order: graphRes.data?.order,
  })
  const graphPayload = {
    nodes: graphRes.data?.nodes || [],
    edges: graphRes.data?.edges || [],
    order: graphRes.data?.order || [],
  }
  const graphOnly = normalizeWorkflow(graphPayload)
  if (typeof onPartialUpdate === 'function') {
    onPartialUpdate(graphOnly)
  }

  setProgress('Analyzing...')
  const insightsRes = await axios.post(
    `${API_BASE_URL}/analyze-workflow`,
    { project_id: resolvedProjectId, nodes: graphPayload.nodes, edges: graphPayload.edges },
    { timeout: API_TIMEOUT_MS, headers: authHeaders(token) }
  )
  console.log('STEP DATA:', {
    step: 'app-analyze-workflow',
    projectId: resolvedProjectId,
    insights: insightsRes.data?.insights,
  })

  const finalPayload = {
    ...graphPayload,
    insights: insightsRes.data?.insights || EMPTY_INSIGHTS,
    explanation: insightsRes.data?.insights?.explanation || '',
  }

  console.log('STEP DATA:', {
    step: 'app-combine-workflow',
    hasNodes: Array.isArray(finalPayload.nodes) && finalPayload.nodes.length > 0,
    hasEdges: Array.isArray(finalPayload.edges) && finalPayload.edges.length > 0,
    hasInsights: Boolean(finalPayload.insights),
    finalPayload,
  })

  return {
    projectId: resolvedProjectId,
    workflow: normalizeWorkflow(finalPayload),
    raw: finalPayload,
  }
}

async function fetchProjectWorkflow(desc, requirements, projectId, token, setProgress, onPartialUpdate) {
  try {
    const result = await fetchWorkflowProgressive(desc, requirements, projectId, token, setProgress, onPartialUpdate)
    if (DEBUG_LOGS) console.log('[fetchProjectWorkflow] normalized workflow:', result)
    return result
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

function AuthScreen({ onAuthenticated }) {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (loading) return
    if (!email.trim() || !password.trim()) {
      setError('Email and password are required.')
      return
    }

    setLoading(true)
    setError('')
    try {
      const endpoint = mode === 'login' ? '/login' : '/signup'
      const res = await axios.post(
        `${API_BASE_URL}${endpoint}`,
        { email: email.trim(), password },
        { timeout: API_TIMEOUT_MS }
      )
      const token = String(res.data?.token || '')
      const user = res.data?.user || null
      if (!token || !user) {
        throw new Error('Invalid auth response')
      }
      saveAuthToken(token)
      onAuthenticated({ token, user })
    } catch (e) {
      const msg = e?.response?.data?.detail || e?.message || 'Authentication failed'
      setError(String(msg))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="landing">
      <div className="landing-hero" style={{ maxWidth: 520 }}>
        <p className="hero-eyebrow">Secure Access</p>
        <h1 className="hero-title">{mode === 'login' ? 'Login to PROMAP' : 'Create your account'}</h1>
        <p className="hero-sub">Authenticate to save projects, cache workflow results, and continue where you left off.</p>
        <div className="hero-input-wrap" style={{ display: 'grid', gap: 12 }}>
          <input className="hero-input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
          <input className="hero-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
          <button className="hero-btn" onClick={submit} disabled={loading}>
            {loading ? 'Please wait...' : mode === 'login' ? 'Login' : 'Sign up'}
          </button>
          {error ? <p className="hero-error-text">{error}</p> : null}
          <button
            className="view-tab"
            onClick={() => setMode((prev) => (prev === 'login' ? 'signup' : 'login'))}
            disabled={loading}
          >
            {mode === 'login' ? 'Need an account? Sign up' : 'Already have an account? Login'}
          </button>
        </div>
      </div>
    </div>
  )
}

function QuestionsScreen({ description, questions, progressText, loading, onBack, onSubmit }) {
  const [answers, setAnswers] = useState({})

  function setAnswer(question, value) {
    setAnswers((prev) => ({ ...prev, [question]: value }))
  }

  async function handleSubmit() {
    const missing = questions.some((q) => !String(answers[q] || '').trim())
    if (missing) return
    await onSubmit(answers)
  }

  return (
    <div className="landing">
      <div className="landing-hero" style={{ maxWidth: 760 }}>
        <p className="hero-eyebrow">Personalized Onboarding</p>
        <h1 className="hero-title">Answer a few focused questions</h1>
        <p className="hero-sub">Project: {description}</p>

        <div style={{ display: 'grid', gap: 14, marginTop: 14 }}>
          {questions.map((q) => (
            <label key={q} style={{ display: 'grid', gap: 8, textAlign: 'left' }}>
              <span style={{ fontWeight: 700 }}>{q}</span>
              <textarea
                className="hero-input"
                rows={3}
                value={answers[q] || ''}
                onChange={(e) => setAnswer(q, e.target.value)}
                placeholder="Type your answer"
              />
            </label>
          ))}
        </div>

        {progressText ? <p className="hero-progress-text">{progressText}</p> : null}

        <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
          <button className="view-tab" onClick={onBack} disabled={loading}>Back</button>
          <button className="hero-btn" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Building workflow...' : 'Submit & Build Workflow'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Priority helpers ────────────────────────────────── */
const PRIORITY_DOT = { High: '#f59e0b', Medium: '#3b82f6', Low: '#64748b' }

function PBadge({ p }) {
  return <span className={`pbadge pbadge--${p || 'Medium'}`}>{p || 'Medium'}</span>
}

function TaskList({ nodes = [] }) {
  const safeNodes = Array.isArray(nodes) ? nodes : []

  return (
    <ul className="simple-task-list">
      {safeNodes.map((n, index) => {
        const id = String(n?.id || `n${index + 1}`)
        const label = n?.data?.label || n?.label || id
        return <li key={id}>{label}</li>
      })}
    </ul>
  )
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

/* ════════════════════════════════════════════════════════
   DASHBOARD
   ════════════════════════════════════════════════════════ */
function Dashboard({ workflow, requirementsData, isWorkflowLoading, workflowError, projectName, onBack, onRegenerate, loadingStage }) {
  const [view, setView] = useState('graph')
  const [selectedNode, setSelectedNode] = useState(null)
  const [activeTab, setActiveTab]     = useState('analysis')
  const [isLoading, setIsLoading]     = useState(false)

  useEffect(() => {
    console.log('WORKFLOW STATE:', workflow)
    console.log('STEP DATA:', {
      step: 'dashboard-received-workflow',
      workflow,
      nodes: workflow?.nodes,
      edges: workflow?.edges,
      insights: workflow?.insights,
      requirements: workflow?.requirements,
    })
  }, [workflow])

  const hasWorkflow = Boolean(workflow && Array.isArray(workflow.nodes))
  const { rawNodes, edges, order, explanation, insights } = useMemo(() => {
    if (!hasWorkflow) {
      return {
        rawNodes: [],
        edges: [],
        order: [],
        explanation: '',
        insights: EMPTY_INSIGHTS,
      }
    }

    const safeNodes = Array.isArray(workflow.nodes)
      ? workflow.nodes.map((node, index) => ({
          ...node,
          id: String(node?.id || `n${index + 1}`),
          position: node?.position || { x: 0, y: 0 },
        }))
      : []

    return {
      rawNodes: safeNodes,
      edges: Array.isArray(workflow.edges) ? workflow.edges : [],
      order: Array.isArray(workflow.order) ? workflow.order : [],
      explanation: workflow.explanation || '',
      insights: workflow.insights || EMPTY_INSIGHTS,
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

  const graphNodes = flowNodes
  const graphEdges = edges
  const executionOrder = order
  const parallelGroups = safeInsights.parallel_groups || []
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
  const workflowInsights = safeInsights
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
      setView('graph')
      await onRegenerate(projectName)
    } catch (e) {
      console.error('[Dashboard] regenerate failed:', e)
    } finally {
      setIsLoading(false)
    }
  }

  if (!hasWorkflow) return <div>No graph data</div>

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
            <button key={v} className={`view-tab${view === v ? ' active' : ''}`} onClick={() => setView(v)}>
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
                className={`sidebar-item${view === item.key ? ' active' : ''}`}
                onClick={() => setView(item.key)}
              >
                <div className="sidebar-item-left">
                  <div className="sidebar-dot" style={{ background: view === item.key ? '#3b82f6' : item.dot }} />
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

          {/* ── GRAPH VIEW ── */}
          {view === 'graph' && workflow?.nodes?.length > 0 && (
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
          {view === 'list' && workflow?.nodes?.length > 0 && (
            <div className="list-view-wrap">
              <div className="list-card">
                <div className="list-card-header">
                  <span className="list-card-title">List view</span>
                  <span className="count-badge">{nodes.length} tasks</span>
                  <div className="list-spacer" />
                  <span className="list-hint">Topological order</span>
                </div>
                {nodes.length > 0 ? nodes.map((node, i) => {
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
                }) : <TaskList nodes={graphNodes} />}
              </div>

              <div className="list-card list-card--timeline">
                <div className="list-card-header">
                  <span className="list-card-title">Timeline view</span>
                  <span className="count-badge count-badge--timeline">
                    {timelineRows.length} steps
                  </span>
                  <div className="list-spacer" />
                  <span className="list-hint">Critical path: {criticalPathLabels.join(' → ') || '—'}</span>
                </div>
                <Timeline
                  timelineRows={timelineRows}
                  timelineDayCount={timelineDayCount}
                  criticalPathLabels={criticalPathLabels}
                />
              </div>

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
          {view === 'timeline' && workflow?.nodes?.length > 0 && (
            <div className="dashboard-section-wrap list-view-wrap">
              <Timeline nodes={graphNodes} order={executionOrder} />
            </div>
          )}

          {!workflow?.nodes?.length && (
            <div className="dashboard-section-wrap">
              <div>No workflow data available</div>
            </div>
          )}

          {workflow?.nodes?.length > 0 && (
            <div className="dashboard-section-wrap">
              <details>
                <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Workflow Debug JSON</summary>
                <pre style={{ marginTop: 8, whiteSpace: 'pre-wrap', maxHeight: 260, overflow: 'auto' }}>{JSON.stringify(workflow, null, 2)}</pre>
              </details>
            </div>
          )}

          <div className="dashboard-section-wrap">
            <RequirementsPanel requirementsData={requirementsData} isLoading={!requirementsData && isWorkflowLoading} />
          </div>

          <div className="dashboard-section-wrap">
            <InsightsPanel insights={workflowInsights} nodes={nodes} isLoading={isWorkflowLoading} />
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

/* ════════════════════════════════════════════════════════
   ROOT APP
   ════════════════════════════════════════════════════════ */
function RequireAuth({ children }) {
  const token = useAppStore((s) => s.token)
  if (!token) return <Navigate to="/login" replace />
  return children
}

function ProtectedShell({ children, active = 'dashboard' }) {
  const navigate = useNavigate()
  const user = useAppStore((s) => s.user)
  const logout = useAppStore((s) => s.logout)

  const sidebar = (
    <div className="shell-nav-list">
      {[
        { key: 'dashboard', label: 'Dashboard', to: '/' },
        { key: 'projects', label: 'Projects', to: '/projects' },
        { key: 'settings', label: 'Settings', to: '/dashboard' },
      ].map((item) => (
        <div
          key={item.key}
          className={`shell-nav-item${active === item.key ? ' active' : ''}`}
          onClick={() => navigate(item.to)}
        >
          <span>{item.label}</span>
          <span>›</span>
        </div>
      ))}

      <button
        className="shell-logout"
        onClick={() => {
          logout()
          navigate('/login')
        }}
      >
        Logout
      </button>
    </div>
  )

  const topbar = (
    <>
      <div className="brand brand--clickable" onClick={() => navigate('/') }>
        <div className="brand-logo">P</div>
        <span className="brand-name">PROMAP</span>
      </div>
      <div className="topbar-spacer" />
      <div className="breadcrumb">
        <span>{user?.email || 'Signed in user'}</span>
      </div>
      <button
        className="regen-btn"
        onClick={() => {
          logout()
          navigate('/login')
        }}
      >
        Logout
      </button>
    </>
  )

  return (
    <AppLayout sidebar={sidebar} topbar={topbar} className="protected-shell">
      {children}
    </AppLayout>
  )
}

function ProjectsPage() {
  const navigate = useNavigate()
  const token = useAppStore((s) => s.token)
  const setProjectName = useAppStore((s) => s.setProjectName)
  const setProjectId = useAppStore((s) => s.setProjectId)
  const setIdea = useAppStore((s) => s.setIdea)
  const setQuestions = useAppStore((s) => s.setQuestions)
  const setAnswers = useAppStore((s) => s.setAnswers)
  const setWorkflow = useAppStore((s) => s.setWorkflow)
  const setLoadingMessage = useAppStore((s) => s.setLoadingMessage)

  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openingId, setOpeningId] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function loadProjects() {
      setLoading(true)
      setError('')
      try {
        const data = await listProjects({ token })
        if (!cancelled) {
          setProjects(Array.isArray(data) ? data : [])
        }
      } catch (err) {
        if (!cancelled) {
          setError(err?.response?.data?.detail || err?.message || 'Failed to load projects.')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadProjects()
    return () => {
      cancelled = true
    }
  }, [token])

  async function openProject(projectId) {
    setOpeningId(projectId)
    setLoadingMessage('Loading saved project...')
    setError('')
    try {
      const project = await getProject({ project_id: projectId, token })
      const requirements = project.requirements || {}
      const normalizedRequirements = { answers: requirements }
      const graph = project.graph || {}
      const nodes = Array.isArray(graph.nodes) ? graph.nodes : []
      const edges = Array.isArray(graph.edges) ? graph.edges : []
      const order = Array.isArray(graph.order) ? graph.order : []
      const insights = project.insights || graph.insights || EMPTY_INSIGHTS
      const storedQuestions = Array.isArray(requirements.follow_ups)
        ? requirements.follow_ups
            .map((item) => String(item?.question || '').trim())
            .filter(Boolean)
        : []

      setProjectId(project.id)
      setProjectName(requirements.project_name || project.description || `Project ${project.id}`)
      setIdea(project.description || requirements.description || '')
      setAnswers(requirements)
      setQuestions(storedQuestions)

      if (nodes.length > 0) {
        setWorkflow({ nodes, edges, order, insights, requirements: normalizedRequirements })
        navigate('/dashboard')
      } else {
        setWorkflow(null)
        navigate('/build')
      }
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Failed to open project.')
    } finally {
      setOpeningId(null)
      setLoadingMessage('')
    }
  }

  return (
    <ProtectedShell active="projects">
      <div className="page-wrap">
        <div className="card" style={{ maxWidth: 1080, margin: '0 auto' }}>
          <p className="section-kicker">Projects</p>
          <h1 className="section-title">Open a saved project</h1>
          <p className="section-subtitle">Click a project to refetch its exact stored graph, requirements, and insights from the database.</p>

          {loading ? <p className="section-subtitle">Loading projects...</p> : null}
          {error ? <p className="auth-error">{error}</p> : null}

          <div className="projects-grid">
            {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                className="project-card"
                onClick={() => openProject(project.id)}
                disabled={openingId === project.id}
              >
                <div className="project-card__header">
                  <div>
                    <p className="project-card__title">{project.project_name || project.description || `Project ${project.id}`}</p>
                    <p className="project-card__desc">{project.description}</p>
                  </div>
                  <span className={`project-pill ${project.has_graph ? 'project-pill--ready' : 'project-pill--draft'}`}>
                    {project.has_graph ? 'Graph saved' : 'Draft'}
                  </span>
                </div>
                <div className="project-card__meta">
                  <span>{project.node_count || 0} nodes</span>
                  <span>{project.has_insights ? 'Insights saved' : 'No insights yet'}</span>
                </div>
              </button>
            ))}
          </div>

          {!loading && projects.length === 0 ? (
            <div className="empty-state">
              No projects found. Create one from the dashboard.
            </div>
          ) : null}
        </div>
      </div>
    </ProtectedShell>
  )
}

function IdeaPage() {
  const navigate = useNavigate()
  const loadingMessage = useAppStore((s) => s.loadingMessage)
  const setProjectName = useAppStore((s) => s.setProjectName)
  const logout = useAppStore((s) => s.logout)

  const [projectNameInput, setProjectNameInput] = useState('')
  const [error, setError] = useState('')

  function handleCreateProject() {
    const projectName = String(projectNameInput || '').trim()
    if (!projectName) {
      setError('Project name is required.')
      return
    }

    setError('')
    setProjectName(projectName)
    navigate('/build')
  }

  return (
    <ProtectedShell active="dashboard">
      <div className="page-wrap">
      <div className="landing-hero card" style={{ maxWidth: 760, alignItems: 'stretch', textAlign: 'left', margin: 0 }}>
        <p className="hero-eyebrow">Project Setup</p>
        <h1 className="hero-title">Create a project</h1>
        <p className="hero-sub">Start by naming your project. Next, you will move to the Build page to describe it in natural language.</p>
        <div className="hero-input-wrap" style={{ display: 'grid', gap: 12 }}>
          <input
            className="hero-input"
            value={projectNameInput}
            onChange={(e) => setProjectNameInput(e.target.value)}
            placeholder="Project name"
          />
          <button className="hero-btn" onClick={handleCreateProject} disabled={Boolean(loadingMessage)}>
            Continue to Build Page
          </button>
        </div>
        {error ? <p className="hero-error-text">{error}</p> : null}
      </div>
      </div>
    </ProtectedShell>
  )
}

function BuildPage() {
  const navigate = useNavigate()
  const token = useAppStore((s) => s.token)
  const project_id = useAppStore((s) => s.project_id)
  const projectName = useAppStore((s) => s.projectName)
  const loadingMessage = useAppStore((s) => s.loadingMessage)
  const setIdea = useAppStore((s) => s.setIdea)
  const setProjectId = useAppStore((s) => s.setProjectId)
  const setQuestions = useAppStore((s) => s.setQuestions)
  const setWorkflow = useAppStore((s) => s.setWorkflow)
  const setLoadingMessage = useAppStore((s) => s.setLoadingMessage)
  const [ideaInput, setIdeaInput] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!projectName) {
      navigate('/')
    }
  }, [projectName, navigate])

  async function handleBuildFromNlp() {
    const idea = String(ideaInput || '').trim()
    if (!idea) {
      setError('Describe your project in natural language.')
      return
    }

    setError('')
    setLoadingMessage('Understanding project...')
    try {
      const data = await gatherRequirements({ description: idea, project_id, token })
      const nextQuestions = Array.isArray(data?.questions) ? data.questions : []
      if (nextQuestions.length === 0) {
        throw new Error('No follow-up questions returned.')
      }
      setIdea(idea)
      setProjectId(Number(data.project_id || 0) || null)
      setQuestions(nextQuestions)
      setWorkflow(null)
      navigate('/onboarding')
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Failed to generate follow-up questions.')
    } finally {
      setLoadingMessage('')
    }
  }

  if (!projectName) return null

  return (
    <ProtectedShell active="projects">
      <div className="page-wrap">
      <div className="landing-hero card" style={{ maxWidth: 760, alignItems: 'stretch', textAlign: 'left', margin: 0 }}>
        <p className="hero-eyebrow">Build Page</p>
        <h1 className="hero-title">Describe the project in NLP</h1>
        <p className="hero-sub">Project: {projectName}. Describe goals, users, features, constraints, and data so we can ask better follow-up questions.</p>
        <div className="hero-input-wrap" style={{ display: 'grid', gap: 12 }}>
          <textarea
            className="hero-input"
            rows={6}
            value={ideaInput}
            onChange={(e) => setIdeaInput(e.target.value)}
            placeholder="Example: Build a mobile marketplace app with buyer/seller accounts, secure checkout, chat, delivery tracking, and admin moderation."
          />
          <button className="hero-btn" onClick={handleBuildFromNlp} disabled={Boolean(loadingMessage)}>
            {loadingMessage || 'Generate Follow-up Questions'}
          </button>
        </div>
        {error ? <p className="hero-error-text">{error}</p> : null}
      </div>
      </div>
    </ProtectedShell>
  )
}

function DashboardPage() {
  const navigate = useNavigate()
  const [workflowError, setWorkflowError] = useState('')

  const token = useAppStore((s) => s.token)
  const idea = useAppStore((s) => s.idea)
  const projectName = useAppStore((s) => s.projectName)
  const project_id = useAppStore((s) => s.project_id)
  const workflow = useAppStore((s) => s.workflow)
  const answers = useAppStore((s) => s.answers)
  const questions = useAppStore((s) => s.questions)
  const loadingMessage = useAppStore((s) => s.loadingMessage)
  const setAnswers = useAppStore((s) => s.setAnswers)
  const updateWorkflow = useAppStore((s) => s.setWorkflow)
  const setQuestions = useAppStore((s) => s.setQuestions)
  const setProjectId = useAppStore((s) => s.setProjectId)
  const setLoadingMessage = useAppStore((s) => s.setLoadingMessage)
  const resetFlow = useAppStore((s) => s.resetFlow)
  const logout = useAppStore((s) => s.logout)

  const normalizedRequirements = useMemo(() => {
    const workflowRequirements = workflow?.requirements
    if (workflowRequirements && typeof workflowRequirements === 'object') {
      if (workflowRequirements.answers && typeof workflowRequirements.answers === 'object') {
        return workflowRequirements
      }
      return { answers: workflowRequirements }
    }

    if (answers && typeof answers === 'object' && Object.keys(answers).length > 0) {
      return { answers }
    }

    return null
  }, [workflow, answers])

  useEffect(() => {
    console.log('STEP DATA:', {
      step: 'dashboard-page-state',
      workflow,
      nodes: workflow?.nodes,
      edges: workflow?.edges,
      insights: workflow?.insights,
      requirements: normalizedRequirements,
      hasNodes: Array.isArray(workflow?.nodes) && workflow.nodes.length > 0,
      hasEdges: Array.isArray(workflow?.edges) && workflow.edges.length > 0,
      hasInsights: Boolean(workflow?.insights),
      hasRequirements: Boolean(normalizedRequirements),
    })
  }, [workflow])

  useEffect(() => {
    let cancelled = false

    async function hydrateRequirements() {
      const hasRequirements = workflow?.requirements && Object.keys(workflow.requirements || {}).length > 0
      const hasAnswers = answers && Object.keys(answers || {}).length > 0
      if (hasRequirements || hasAnswers || !project_id) return

      try {
        const project = await getProject({ project_id, token })
        if (cancelled) return

        const requirements = project.requirements || {}
        if (Object.keys(requirements).length > 0) {
          setAnswers(requirements)
          updateWorkflow({
            ...(workflow || {}),
            requirements: { answers: requirements },
          })
        }
      } catch (err) {
        console.error('[DashboardPage] failed to hydrate requirements:', err)
      }
    }

    hydrateRequirements()
    return () => {
      cancelled = true
    }
  }, [answers, project_id, token, workflow, setAnswers, updateWorkflow])

  if (!workflow) {
    return <Navigate to="/" replace />
  }

  async function onRegenerate() {
    try {
      setWorkflowError('')
      setLoadingMessage('Understanding project...')
      const data = await gatherRequirements({
        description: idea,
        project_id,
        previous_questions: questions,
        token,
      })
      const nextQuestions = Array.isArray(data?.questions) ? data.questions : []
      if (nextQuestions.length === 0) {
        throw new Error('No onboarding questions returned.')
      }
      setProjectId(Number(data.project_id || 0) || null)
      setQuestions(nextQuestions)
      navigate('/onboarding')
    } catch (err) {
      setWorkflowError(err?.response?.data?.detail || err?.message || 'Regeneration failed.')
    } finally {
      setLoadingMessage('')
    }
  }

  return (
    <ProtectedShell active="dashboard">
      <Dashboard
        workflow={workflow}
        requirementsData={normalizedRequirements}
        isWorkflowLoading={Boolean(loadingMessage)}
        workflowError={workflowError}
        projectName={projectName || idea || 'My Project'}
        onBack={() => {
          resetFlow()
          navigate('/')
        }}
        onRegenerate={onRegenerate}
        loadingStage={loadingMessage || ''}
      />
    </ProtectedShell>
  )
}

export default function App() {
  const token = useAppStore((s) => s.token)

  return (
    <Routes>
      <Route path="/login" element={token ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/signup" element={token ? <Navigate to="/" replace /> : <Signup />} />
      <Route path="/" element={<RequireAuth><IdeaPage /></RequireAuth>} />
      <Route path="/projects" element={<RequireAuth><ProjectsPage /></RequireAuth>} />
      <Route path="/build" element={<RequireAuth><BuildPage /></RequireAuth>} />
      <Route path="/onboarding" element={<RequireAuth><Onboarding /></RequireAuth>} />
      <Route
        path="/dashboard"
        element={
          <RequireAuth>
            <ErrorBoundary>
              <DashboardPage />
            </ErrorBoundary>
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to={token ? '/' : '/login'} replace />} />
    </Routes>
  )
}