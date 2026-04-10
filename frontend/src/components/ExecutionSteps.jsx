function ExecutionSteps({ order = [], nodeLabelMap = {}, isLoading = false }) {
  return (
    <div className="steps-card">
      <p className="steps-title">Execution Order</p>
      <p className="steps-sub">Step-by-step sequence for completing the workflow.</p>

      {isLoading ? (
        <p className="steps-sub">Loading execution order...</p>
      ) : order.length > 0 ? (
        <ol className="steps-list">
          {order.map((nodeId, index) => {
            const id = String(nodeId)
            return (
              <li key={`${id}-${index}`} className="steps-item">
                <span className="steps-name">Step {index + 1} -&gt; {nodeLabelMap[id] || id}</span>
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="steps-sub">No execution order available.</p>
      )}
    </div>
  )
}

export default ExecutionSteps