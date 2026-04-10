function InputCard({ projectIdea, isLoading, onProjectIdeaChange, onGenerate }) {
  const handleKey = (e) => {
    if (e.key === 'Enter' && !isLoading) onGenerate()
  }

  return (
    <section className="card input-card">
      <div className="input-card__header">
        <h2>Generate Workflow</h2>
        <p>Describe your project idea — PROMAP structures it into an AI-powered task graph.</p>
      </div>

      <div className="input-card__controls">
        <input
          type="text"
          value={projectIdea}
          placeholder="e.g. Build an e-commerce platform with payments and inventory..."
          onChange={(e) => onProjectIdeaChange(e.target.value)}
          onKeyDown={handleKey}
          className="input-card__field"
        />
        <button
          type="button"
          onClick={onGenerate}
          disabled={isLoading || !projectIdea.trim()}
          className="input-card__button"
        >
          {isLoading ? (
            <span className="input-card__loading">
              <span className="spinner" aria-hidden="true" />
              Generating…
            </span>
          ) : (
            'Generate Workflow'
          )}
        </button>
      </div>

      <p className="input-card__note">
        AI converts your idea into tasks, dependencies, priorities, and an execution plan.
      </p>
    </section>
  )
}

export default InputCard