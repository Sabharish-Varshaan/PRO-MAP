function ExecutionSteps({ order, nodeLabelMap }) {
  return (
    <section className="card steps-card">
      <div className="steps-card__header">
        <h2>Execution Plan</h2>
        <p>Suggested order to execute your workflow tasks.</p>
      </div>

      {order.length > 0 ? (
        <ol className="steps-list">
          {order.map((nodeId, index) => (
            <li key={`${nodeId}-${index}`} className="steps-list__item">
              <span className="steps-list__index">{index + 1}</span>
              <span className="steps-list__label">{nodeLabelMap[nodeId] || nodeId}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="steps-card__empty">Generate a workflow to view execution steps.</p>
      )}
    </section>
  )
}

export default ExecutionSteps
