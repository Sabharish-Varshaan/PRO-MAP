import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import AppLayout from '../components/AppLayout'
import { buildGraph, generateTasks, submitRequirements } from '../utils/api'
import { useAppStore } from '../store/useAppStore'

const EMPTY_INSIGHTS = {
  critical_path: [],
  top_bottlenecks: [],
  parallel_groups: [],
  start_task: '',
  end_task: '',
  explanation: '',
}

function withDeterministicNodePositions(nodes) {
  if (!Array.isArray(nodes)) return []

  return nodes
    .filter((node) => node && typeof node === 'object')
    .map((node, index) => ({
      ...node,
      id: String(node.id || `n${index + 1}`),
      type: node.type || 'task',
      position: {
        x: index % 2 === 0 ? 0 : 300,
        y: index * 120,
      },
    }))
}

export default function Onboarding() {
  const navigate = useNavigate()
  const token = useAppStore((s) => s.token)
  const project_id = useAppStore((s) => s.project_id)
  const idea = useAppStore((s) => s.idea)
  const projectName = useAppStore((s) => s.projectName)
  const questions = useAppStore((s) => s.questions)
  const answers = useAppStore((s) => s.answers)
  const setAnswers = useAppStore((s) => s.setAnswers)
  const setWorkflow = useAppStore((s) => s.setWorkflow)
  const setLoadingMessage = useAppStore((s) => s.setLoadingMessage)

  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)

  const safeQuestions = (Array.isArray(questions) ? questions : [])
    .map((item, idx) => {
      if (typeof item === 'string') {
        const questionText = item.trim()
        return questionText
          ? { key: `q_${idx + 1}`, question: questionText }
          : null
      }
      if (item && typeof item === 'object') {
        const questionText = String(item.question || '').trim()
        const keyText = String(item.key || '').trim() || `q_${idx + 1}`
        return questionText ? { key: keyText, question: questionText } : null
      }
      return null
    })
    .filter(Boolean)

  const totalSteps = Math.max(safeQuestions.length, 1)
  const activeQuestion = safeQuestions[currentStep] || null
  const progressPct = Math.min(100, Math.round(((currentStep + 1) / totalSteps) * 100))

  useEffect(() => {
    if (!safeQuestions.length || !project_id) {
      navigate('/')
    }
  }, [safeQuestions, project_id, navigate])

  if (!safeQuestions.length || !project_id) return null

  function handleAnswerChange(key, value) {
    setAnswers({
      ...(answers || {}),
      [key]: value,
    })
  }

  function validateAnswers() {
    if (Object.keys(answers || {}).length < safeQuestions.length) {
      alert('Please answer all questions')
      return false
    }

    const hasMissing = safeQuestions.some((q) => !String((answers || {})[q.key] || '').trim())
    if (hasMissing) {
      alert('Please answer all questions')
      return false
    }
    return true
  }

  async function handleSubmit() {
    if (!validateAnswers()) {
      setError('Please answer all questions.')
      return
    }

    setLoading(true)
    setError('')
    try {
      const structuredAnswers = safeQuestions.reduce((acc, item) => {
        acc[item.key] = String((answers || {})[item.key] || '').trim()
        return acc
      }, {})

      setLoadingMessage('Understanding project...')
      const requirementsResponse = await submitRequirements({ project_id, answers: structuredAnswers, token })
      console.log('STEP DATA:', {
        step: 'submit-requirements',
        project_id,
        requirementsResponse,
        requirements: structuredAnswers,
      })
      setAnswers(structuredAnswers)

      setLoadingMessage('Generating tasks...')
      const tasksData = await generateTasks({
        description: idea,
        requirements: structuredAnswers,
        project_id,
        token,
      })
      console.log('STEP DATA:', {
        step: 'generate-tasks',
        project_id: tasksData?.project_id || project_id,
        tasksCount: Array.isArray(tasksData?.tasks) ? tasksData.tasks.length : 0,
        dependenciesCount: Array.isArray(tasksData?.dependencies) ? tasksData.dependencies.length : 0,
        tasks: tasksData?.tasks,
        dependencies: tasksData?.dependencies,
      })

      setLoadingMessage('Building workflow...')
      const graphData = await buildGraph({
        project_id: Number(tasksData.project_id || project_id),
        tasks: tasksData.tasks,
        dependencies: tasksData.dependencies,
        token,
      })
      console.log('STEP DATA:', {
        step: 'build-graph',
        project_id: graphData?.project_id || tasksData?.project_id || project_id,
        nodesCount: Array.isArray(graphData?.nodes) ? graphData.nodes.length : 0,
        edgesCount: Array.isArray(graphData?.edges) ? graphData.edges.length : 0,
        nodes: graphData?.nodes,
        edges: graphData?.edges,
        order: graphData?.order,
        insights: graphData?.insights,
      })

      const requirementsPayload = {
        answers: structuredAnswers,
      }

      const workflow = {
        nodes: withDeterministicNodePositions(graphData.nodes),
        edges: Array.isArray(graphData.edges) ? graphData.edges : [],
        order: Array.isArray(graphData.order) ? graphData.order : [],
        insights: {
          ...EMPTY_INSIGHTS,
          ...((graphData && typeof graphData === 'object' && graphData.insights) ? graphData.insights : {}),
        },
        requirements: requirementsPayload,
        workflow_quality: graphData?.workflow_quality,
        graph_structure: graphData?.graph_structure,
      }
      console.log('STEP DATA:', {
        step: 'combine-workflow',
        hasTasks: Array.isArray(tasksData?.tasks) && tasksData.tasks.length > 0,
        hasNodes: Array.isArray(workflow?.nodes) && workflow.nodes.length > 0,
        hasEdges: Array.isArray(workflow?.edges) && workflow.edges.length > 0,
        hasInsights: Boolean(workflow?.insights),
        hasRequirements: Boolean(workflow?.requirements),
        workflow,
      })
      console.log('FINAL WORKFLOW:', workflow)
      console.log('NODES:', workflow.nodes)
      console.log('EDGES:', workflow.edges)
      setWorkflow(workflow)
      navigate('/dashboard')
    } catch (err) {
      setError(err?.response?.data?.detail || 'Failed to build workflow.')
    } finally {
      setLoadingMessage('')
      setLoading(false)
    }
  }

  const sidebar = (
    <div className="shell-nav-list">
      <div className="shell-nav-item"><span>Dashboard</span><span>›</span></div>
      <div className="shell-nav-item active"><span>Projects</span><span>›</span></div>
      <div className="shell-nav-item"><span>Settings</span><span>›</span></div>
      <button className="shell-logout" onClick={() => { localStorage.removeItem('token'); navigate('/login') }}>
        Logout
      </button>
    </div>
  )

  const topbar = (
    <>
      <div className="brand brand--clickable" onClick={() => navigate('/')}>
        <div className="brand-logo">P</div>
        <span className="brand-name">PROMAP</span>
      </div>
      <div className="topbar-spacer" />
      <div className="breadcrumb">
        <span>{projectName || 'Untitled'}</span>
      </div>
      <button
        className="regen-btn"
        onClick={() => {
          localStorage.removeItem('token')
          navigate('/login')
        }}
      >
        Logout
      </button>
    </>
  )

  return (
    <AppLayout sidebar={sidebar} topbar={topbar}>
      <div className="page-wrap">
        <div className="card onboarding-card" style={{ maxWidth: 760, margin: '0 auto' }}>
          <p className="section-kicker">Onboarding</p>
          <h1 className="section-title">Answer a few AI questions</h1>
          <p className="section-subtitle">Project: {projectName || 'Untitled'} | Idea: {idea}</p>
          <div className="progress-pill">Step {Math.min(currentStep + 1, totalSteps)} of {totalSteps}</div>
          <div style={{ width: '100%', height: 8, borderRadius: 999, background: '#e5e7eb', marginBottom: 16 }}>
            <div
              style={{
                width: `${progressPct}%`,
                height: '100%',
                borderRadius: 999,
                background: '#3b82f6',
                transition: 'width .2s ease',
              }}
            />
          </div>

          <div className="form-stack">
            {activeQuestion ? (
              <div className="field-group" style={{ marginBottom: 16 }}>
                <label>{activeQuestion.question}</label>
                <input
                  className="auth-input"
                  placeholder="Enter your answer..."
                  value={(answers || {})[activeQuestion.key] || ''}
                  onChange={(e) => handleAnswerChange(activeQuestion.key, e.target.value)}
                />
              </div>
            ) : null}
          </div>

          {error ? <p className="auth-error">{error}</p> : null}
          <p className="section-subtitle">Next: we extract the answers as JSON, send them to GPT for task generation, then build the graph and analysis.</p>

          <div className="center-actions">
            <button className="secondary-button" onClick={() => (currentStep > 0 ? setCurrentStep((prev) => prev - 1) : navigate('/build'))}>
              Back
            </button>

            {currentStep < totalSteps - 1 ? (
              <button
                className="primary-button"
                disabled={loading}
                onClick={() => {
                  const currentKey = activeQuestion?.key
                  const currentValue = String((answers || {})[currentKey] || '').trim()
                  if (!currentValue) {
                    setError('Please answer this question before moving next.')
                    return
                  }
                  setError('')
                  setCurrentStep((prev) => Math.min(prev + 1, totalSteps - 1))
                }}
              >
                Next
              </button>
            ) : (
              <button className="primary-button" disabled={loading} onClick={handleSubmit}>
                {loading ? 'Generating workflow...' : 'Submit'}
              </button>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
