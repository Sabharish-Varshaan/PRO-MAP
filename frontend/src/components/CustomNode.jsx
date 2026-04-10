import { Handle, Position } from 'react-flow-renderer'

function CustomNode({ data }) {
  return (
    <div className="task-node">
      <Handle type="target" position={Position.Top} className="task-node__handle" />

      <p className="task-node__title">{data?.label}</p>
      <p className="task-node__description">{data?.description}</p>

      {data?.parallel ? <span className="task-node__badge">Parallel</span> : null}

      <Handle type="source" position={Position.Bottom} className="task-node__handle" />
    </div>
  )
}

export default CustomNode
