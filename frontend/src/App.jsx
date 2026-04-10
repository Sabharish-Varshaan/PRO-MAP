import { useMemo, useState } from 'react'
import axios from 'axios'
import fallbackWorkflow from './sample_workflow.json'
import 'react-flow-renderer/dist/style.css'
import './App.css'
import Header from './components/Header'
import InputCard from './components/InputCard'
import WorkflowGraph from './components/WorkflowGraph'
import ExecutionSteps from './components/ExecutionSteps'
import CustomNode from './components/CustomNode'
import { getLayoutedNodes } from './utils/layout'

const nodeTypes = { task: CustomNode }

function App() {
  const [projectIdea, setProjectIdea] = useState('')
  const [nodes, setNodes] = useState([])
  const [edges, setEdges] = useState([])
  const [order, setOrder] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const applyWorkflow = (workflowData) => {
    const workflowNodes = workflowData.nodes || []
    const workflowEdges = workflowData.edges || []
    const workflowOrder = workflowData.order || []

    setEdges(workflowEdges)
    setNodes(getLayoutedNodes(workflowNodes, workflowEdges))
    setOrder(workflowOrder)
  }

  const handleGenerate = async () => {
    setIsLoading(true)
    setError('')

    try {
      const response = await axios.post('http://localhost:8000/generate', {
        project_description: projectIdea,
      })

      applyWorkflow(response.data)
    } catch {
      setError('Failed to generate workflow')
      applyWorkflow(fallbackWorkflow)
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

        {error ? <p className="error-message">{error}</p> : null}

        <WorkflowGraph nodes={nodes} edges={edges} nodeTypes={nodeTypes} />

        <ExecutionSteps order={order} nodeLabelMap={nodeLabelMap} />
      </main>
    </div>
  )
}

export default App
