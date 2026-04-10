function InputCard({ projectIdea, isLoading, onProjectIdeaChange, onGenerate }) {
  return (
    <section className="card input-card">
      <div className="input-card__header">
        <h2>Generate Workflow</h2>
        <p>Describe your project idea and PROMAP will structure the flow.</p>
      </div>

      <div className="input-card__controls">
        <input
          type="text"
          value={projectIdea}
          placeholder="Enter your project idea..."
          onChange={(event) => onProjectIdeaChange(event.target.value)}
          className="input-card__field"
        />

        <button
          type="button"
          onClick={onGenerate}
          disabled={isLoading}
          className="input-card__button"
        >
          {isLoading ? (
            <span className="input-card__loading">
              <span className="spinner" aria-hidden="true" />
              Generating workflow...
            </span>
          ) : (
            'Generate Workflow'
          )}
        </button>
      </div>
    </section>
  )
}

export default InputCard
