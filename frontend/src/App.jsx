import { useMemo, useState } from 'react'
import axios from 'axios'
import fallbackWorkflow from './sample_workflow.json'
import 'react-flow-renderer/dist/style.css'
import './App.css'
import Header from './components/Header'
import InputCard from './components/InputCard'
import WorkflowGraph from './components/WorkflowGraph'
import ExecutionSteps from './components/ExecutionSteps'
import { getLayoutedNodes } from './utils/layout'

const envApiBaseUrl = import.meta.env.VITE_API_BASE_URL
const apiBaseUrls = [envApiBaseUrl, 'http://127.0.0.1:8000', 'http://127.0.0.1:8001'].filter(
  (url, index, arr) => Boolean(url) && arr.indexOf(url) === index,
)

function normalizeWorkflow(workflowData) {
  const rawNodes = Array.isArray(workflowData?.nodes) ? workflowData.nodes : []
  const rawEdges = Array.isArray(workflowData?.edges) ? workflowData.edges : []
  const rawOrder = Array.isArray(workflowData?.order) ? workflowData.order : []
  const explanation = workflowData?.explanation?.trim() || 'This workflow follows standard development steps.'

  const isPlaceholderLabel = (label) => {
    const normalized = String(label || '').trim().toLowerCase()
    return (
      normalized === '' ||
      normalized === 'task' ||
      normalized === 'task 1' ||
      normalized === 'step' ||
      normalized === 'step 1' ||
      normalized === 'node' ||
      normalized === 'node 1' ||
      /^((task|step|node|n)\s*\d+)$/.test(normalized)
    )
  }

  const nodes = rawNodes
    .map((node, index) => {
      if (!node || typeof node !== 'object') {
        return null
      }

      const id = String(node.id || `n${index + 1}`)
      const nodeData = node.data && typeof node.data === 'object' ? node.data : {}
      const description = nodeData.description || node.description || ''
      const label = nodeData.label || node.label || node.name || id
      const features = Array.isArray(nodeData.features) ? nodeData.features : Array.isArray(node.features) ? node.features : []
      const modules = Array.isArray(nodeData.modules) ? nodeData.modules : Array.isArray(node.modules) ? node.modules : []

      return {
        id,
        type: 'default',
        position: node.position || { x: 0, y: 0 },
        data: {
          label: isPlaceholderLabel(label) && description ? description : label,
          description,
          features,
          modules,
          priority: nodeData.priority || 'Medium',
          parallel: Boolean(nodeData.parallel),
        },
      }
    })
    .filter(Boolean)

  const nodeIds = new Set(nodes.map((node) => node.id))

  const edges = rawEdges
    .map((edge, index) => {
      if (!edge || typeof edge !== 'object') {
        return null
      }

      const source = String(edge.source || edge.from || '')
      const target = String(edge.target || edge.to || '')

      if (!source || !target || !nodeIds.has(source) || !nodeIds.has(target)) {
        return null
      }

      return {
        id: String(edge.id || `e-${source}-${target}-${index + 1}`),
        source,
        target,
      }
    })
    .filter(Boolean)

  const order = rawOrder.map((nodeId) => String(nodeId)).filter((nodeId) => nodeIds.has(nodeId))

  if (nodes.length === 0) {
    throw new Error('Invalid workflow response: nodes are required')
  }

  return {
    nodes,
    edges,
    order: order.length > 0 ? order : nodes.map((node) => node.id),
    explanation,
  }
}

async function fetchWorkflow(projectDescription) {
  let lastError

  for (const baseUrl of apiBaseUrls) {
    try {
      const response = await axios.post(
        `${baseUrl}/generate`,
        {
          project_description: projectDescription,
        },
        { timeout: 15000 },
      )

      return normalizeWorkflow(response.data)
    } catch (error) {
      lastError = error
    }
  }

  throw lastError || new Error('Unable to reach backend generate endpoint')
}

function App() {
  const [projectIdea, setProjectIdea] = useState('')
  const [nodes, setNodes] = useState([])
  const [edges, setEdges] = useState([])
  const [workflow, setWorkflow] = useState(null)
  const [order, setOrder] = useState([])
  const [explanation, setExplanation] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [viewMode, setViewMode] = useState('graph')

  const applyWorkflow = (workflowData) => {
    const workflowNodes = workflowData.nodes
    const workflowEdges = workflowData.edges
    const workflowOrder = workflowData.order

    console.log('NODES:', workflowNodes)
    console.log('EDGES:', workflowEdges)

    setWorkflow(workflowData)
    setEdges(workflowEdges)
    setNodes(getLayoutedNodes(workflowNodes, workflowEdges))
    setOrder(workflowOrder)
    setExplanation(workflowData.explanation || 'This workflow follows standard development steps.')
  }

  const generateWorkflow = async () => {
    const input = projectIdea.trim()

    try {
      const res = await axios.post('http://127.0.0.1:8000/generate', {
        project_description: input,
      })

      console.log('API RESPONSE:', res.data)

      const workflowData = normalizeWorkflow(res.data)
      setWorkflow(workflowData)
      setNodes(getLayoutedNodes(workflowData.nodes, workflowData.edges))
      setEdges(workflowData.edges)
      setOrder(workflowData.order)
      setExplanation(workflowData.explanation || 'This workflow follows standard development steps.')
    } catch (err) {
      console.error('API ERROR:', err)
      throw err
    }
  }

  const handleGenerate = async () => {
    const idea = projectIdea.trim()
    if (!idea) {
      setError('Please enter a project idea')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      await generateWorkflow()
    } catch (requestError) {
      console.error('Workflow generation failed, using fallback data.', requestError)
      setError('Failed to generate workflow')
      applyWorkflow(normalizeWorkflow(fallbackWorkflow))
    } finally {
      setIsLoading(false)
    }
  }

  const nodeLabelMap = useMemo(() => {
    const map = {}
    nodes.forEach((node) => {
      map[node.id] = node.data?.label || node.id
    })
    return map
  }, [nodes])

  const nodeById = useMemo(() => {
    const map = {}
    nodes.forEach((node) => {
      map[node.id] = node
    })
    return map
  }, [nodes])

  const getPriorityColor = (priority) => {
    if (priority === 'High') return '#dc2626'
    if (priority === 'Low') return '#16a34a'
    return '#f97316'
  }

  const highestPriorityTask = useMemo(() => {
    const priorityOrder = { High: 3, Medium: 2, Low: 1 }
    return nodes.reduce((max, node) => {
      const nodePriority = priorityOrder[node.data?.priority] || 2
      const maxPriority = priorityOrder[max.data?.priority] || 2
      return nodePriority > maxPriority ? node : max
    }, nodes[0] || null)
  }, [nodes])

  const bottleneck = nodes.find((node) => node.data?.priority === 'High') || nodes[0] || null

  const dependencies = useMemo(() => {
    return edges
      .map((edge) => {
        const source = nodeById[edge.source]
        const target = nodeById[edge.target]

        if (!source || !target) {
          return null
        }

        return `${source.data?.label || source.id} → ${target.data?.label || target.id}`
      })
      .filter(Boolean)
  }, [edges, nodeById])

  const firstTask = order.length > 0 ? nodes.find((n) => n.id === order[0]) : null
  const lastTask = order.length > 0 ? nodes.find((n) => n.id === order[order.length - 1]) : null

  return (
    <div className="app">
      <Header />

      <main className="app-main">
        <InputCard
          projectIdea={projectIdea}
          isLoading={isLoading}
          onProjectIdeaChange={setProjectIdea}
          onGenerate={handleGenerate}
        />

        {explanation ? (
          <section className="card" style={{ marginTop: '1rem', padding: '1.25rem 1.5rem' }}>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.05rem', fontWeight: 700 }}>💡 AI Explanation</h3>
            <p style={{ margin: 0, color: '#374151', lineHeight: 1.7 }}>{explanation}</p>
          </section>
        ) : null}

        {error ? <p className="error-message">{error}</p> : null}

        {nodes.length > 0 && (
          <div style={{ marginTop: '2rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '2px solid #e5e7eb' }}>
              <button
                onClick={() => setViewMode('graph')}
                style={{
                  padding: '0.875rem 1.5rem',
                  borderRadius: '12px 12px 0 0',
                  border: 'none',
                  fontSize: '0.95rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: viewMode === 'graph' ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 'transparent',
                  color: viewMode === 'graph' ? '#ffffff' : '#6b7280',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  if (viewMode !== 'graph') {
                    e.currentTarget.style.color = '#374151'
                    e.currentTarget.style.background = '#f3f4f6'
                  }
                }}
                onMouseLeave={(e) => {
                  if (viewMode !== 'graph') {
                    e.currentTarget.style.color = '#6b7280'
                    e.currentTarget.style.background = 'transparent'
                  }
                }}
              >
                📊 Graph View
              </button>
              <button
                onClick={() => setViewMode('list')}
                style={{
                  padding: '0.875rem 1.5rem',
                  borderRadius: '12px 12px 0 0',
                  border: 'none',
                  fontSize: '0.95rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: viewMode === 'list' ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 'transparent',
                  color: viewMode === 'list' ? '#ffffff' : '#6b7280',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  if (viewMode !== 'list') {
                    e.currentTarget.style.color = '#374151'
                    e.currentTarget.style.background = '#f3f4f6'
                  }
                }}
                onMouseLeave={(e) => {
                  if (viewMode !== 'list') {
                    e.currentTarget.style.color = '#6b7280'
                    e.currentTarget.style.background = 'transparent'
                  }
                }}
              >
                📋 List View
              </button>
            </div>
          </div>
        )}

        {viewMode === 'graph' && nodes.length > 0 && (
          <div style={{ minHeight: nodes.length > 8 ? '700px' : '500px', marginBottom: '2rem' }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '1.15rem', fontWeight: 700 }}>📊 Workflow Graph</h3>
            <WorkflowGraph nodes={nodes} edges={edges} />
          </div>
        )}

        {viewMode === 'list' && nodes.length > 0 && (
          <section className="card" style={{ padding: '2rem', marginBottom: '2rem' }}>
            <h2 style={{ marginTop: 0, marginBottom: '1.5rem', fontSize: '1.2rem', fontWeight: 700 }}>📋 Workflow Tasks</h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e5e7eb', backgroundColor: '#f9fafb' }}>
                    <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 700, fontSize: '0.95rem', color: '#374151' }}>Task</th>
                    <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 700, fontSize: '0.95rem', color: '#374151' }}>Description</th>
                    <th style={{ padding: '1rem', textAlign: 'center', fontWeight: 700, fontSize: '0.95rem', color: '#374151' }}>Priority</th>
                    <th style={{ padding: '1rem', textAlign: 'center', fontWeight: 700, fontSize: '0.95rem', color: '#374151' }}>Dependencies</th>
                  </tr>
                </thead>
                <tbody>
                  {nodes.map((node, index) => {
                    const incomingEdges = edges.filter((e) => e.target === node.id)
                    return (
                      <tr key={node.id} style={{ borderBottom: '1px solid #e5e7eb', background: index % 2 === 0 ? 'transparent' : '#f9fafb', transition: 'background 0.2s ease' }} onMouseEnter={(e) => { e.currentTarget.style.background = '#f3f4f6' }} onMouseLeave={(e) => { e.currentTarget.style.background = index % 2 === 0 ? 'transparent' : '#f9fafb' }}>
                        <td style={{ padding: '1rem', fontWeight: 600, color: '#111827' }}>{node.data?.label}</td>
                        <td style={{ padding: '1rem', color: '#6b7280', fontSize: '0.94rem' }}>{node.data?.description || '—'}</td>
                        <td style={{ padding: '1rem', textAlign: 'center' }}>
                          <span style={{ display: 'inline-block', padding: '4px 10px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', ...(node.data?.priority === 'High' ? { backgroundColor: '#fee2e2', color: '#991b1b' } : node.data?.priority === 'Low' ? { backgroundColor: '#dcfce7', color: '#166534' } : { backgroundColor: '#fed7aa', color: '#92400e' }) }}>
                            {node.data?.priority || 'Medium'}
                          </span>
                        </td>
                        <td style={{ padding: '1rem', textAlign: 'center', color: '#6b7280', fontSize: '0.94rem' }}>
                          {incomingEdges.length > 0 ? (
                            <span>{incomingEdges.map((e) => nodeLabelMap[e.source]).join(', ')}</span>
                          ) : (
                            <span style={{ color: '#16a34a', fontWeight: 600 }}>Start</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {nodes.length > 0 && viewMode === 'graph' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginTop: '2rem' }}>
            <section className="card" style={{ padding: '1.5rem', background: 'linear-gradient(135deg, #ffffff 0%, #f9fafb 100%)' }}>
              <h3 style={{ marginBottom: '1rem', fontSize: '1.15rem', fontWeight: 700, margin: 0 }}>🧩 Tasks</h3>
              <ol style={{ listStyleType: 'decimal', paddingLeft: '1.5rem', lineHeight: 2, margin: 0 }}>
                {nodes.map((node) => (
                  <li key={node.id} style={{ marginBottom: '0.5rem', fontWeight: 500, color: '#374151', cursor: 'pointer', transition: 'color 0.2s ease' }} onMouseEnter={(e) => { e.currentTarget.style.color = '#667eea' }} onMouseLeave={(e) => { e.currentTarget.style.color = '#374151' }}>
                    <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: getPriorityColor(node.data?.priority), marginRight: '0.5rem', verticalAlign: 'middle' }} />
                    {node.data?.label}
                  </li>
                ))}
              </ol>
            </section>

            <section className="card" style={{ padding: '1.5rem' }}>
              <h3 style={{ marginBottom: '1rem', fontSize: '1.1rem', fontWeight: 600 }}>🔗 Dependencies</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {dependencies.length > 0 ? (
                  dependencies.map((dependency, index) => (
                    <div key={`${dependency}-${index}`} style={{ padding: '0.875rem 1rem', borderRadius: '10px', backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', fontWeight: 500, color: '#374151' }}>
                      {dependency}
                    </div>
                  ))
                ) : (
                  <p style={{ margin: 0, color: '#6b7280' }}>No dependencies available.</p>
                )}
              </div>
            </section>

            <section className="card" style={{ padding: '1.5rem', gridColumn: '1 / -1', background: 'linear-gradient(135deg, #ffffff 0%, #f9fafb 100%)' }}>
              <h3 style={{ marginBottom: '1rem', fontSize: '1.15rem', fontWeight: 700, margin: 0 }}>🤖 AI Insights</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                <div style={{ padding: '1rem', borderRadius: '12px', background: '#f8fafc', border: '1px solid #e5e7eb' }}>
                  <p style={{ margin: '0 0 0.35rem', fontSize: '0.85rem', color: '#6b7280' }}>Start with</p>
                  <p style={{ margin: 0, fontWeight: 700 }}>{firstTask?.data?.label || '—'}</p>
                </div>
                <div style={{ padding: '1rem', borderRadius: '12px', background: '#f8fafc', border: '1px solid #e5e7eb' }}>
                  <p style={{ margin: '0 0 0.35rem', fontSize: '0.85rem', color: '#6b7280' }}>Finish with</p>
                  <p style={{ margin: 0, fontWeight: 700 }}>{lastTask?.data?.label || '—'}</p>
                </div>
                <div style={{ padding: '1rem', borderRadius: '12px', background: '#f8fafc', border: '1px solid #e5e7eb' }}>
                  <p style={{ margin: '0 0 0.35rem', fontSize: '0.85rem', color: '#6b7280' }}>Bottleneck</p>
                  <p style={{ margin: 0, fontWeight: 700, color: getPriorityColor(bottleneck?.data?.priority) }}>{bottleneck?.data?.label || '—'}</p>
                </div>
              </div>
            </section>

            <section className="card" style={{ padding: '1.5rem', gridColumn: '1 / -1' }}>
              <h3 style={{ margin: '0 0 1rem', fontSize: '1.15rem', fontWeight: 700 }}>Feature & Module Breakdown</h3>
              <div style={{ display: 'grid', gap: '1rem' }}>
                {nodes.map((node) => (
                  <div key={node.id} style={{ padding: '1rem', borderRadius: '12px', border: '1px solid #e5e7eb', background: '#fff' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                      <strong style={{ color: '#111827' }}>{node.data?.label}</strong>
                      <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>{node.data?.priority || 'Medium'}</span>
                    </div>
                    <div style={{ display: 'grid', gap: '0.75rem' }}>
                      <div>
                        <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#6b7280', marginBottom: '0.35rem' }}>Features</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                          {(node.data?.features || []).length > 0 ? (
                            node.data.features.map((feature) => (
                              <span key={feature} style={{ padding: '0.35rem 0.7rem', borderRadius: '999px', background: '#eef2ff', color: '#3730a3', fontSize: '0.85rem' }}>
                                {feature}
                              </span>
                            ))
                          ) : (
                            <span style={{ color: '#9ca3af' }}>No features listed</span>
                          )}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#6b7280', marginBottom: '0.35rem' }}>Modules</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                          {(node.data?.modules || []).length > 0 ? (
                            node.data.modules.map((module) => (
                              <span key={module} style={{ padding: '0.35rem 0.7rem', borderRadius: '999px', background: '#ecfeff', color: '#155e75', fontSize: '0.85rem' }}>
                                {module}
                              </span>
                            ))
                          ) : (
                            <span style={{ color: '#9ca3af' }}>No modules listed</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

          </div>
        )}

        {nodes.length > 0 && <ExecutionSteps order={order} nodeLabelMap={nodeLabelMap} />}
      </main>
    </div>
  )
}

export default App
