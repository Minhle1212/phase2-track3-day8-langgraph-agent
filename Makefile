.PHONY: install test lint typecheck run-scenarios grade-local demo-persistence run-ui run-api run-all clean

install:
	pip install -e '.[dev]'

test:
	pytest

lint:
	ruff check src tests

typecheck:
	mypy src

run-scenarios:
	python -m langgraph_agent_lab.cli run-scenarios --config configs/lab.yaml --output outputs/metrics.json

grade-local:
	python -m langgraph_agent_lab.cli validate-metrics --metrics outputs/metrics.json

demo-persistence:
	python -m langgraph_agent_lab.extensions.persistence_demo

run-ui:
	streamlit run src/langgraph_agent_lab/ui/app.py --server.port 8501 --server.headless true

run-api:
	uvicorn src.langgraph_agent_lab.api.server:app --reload --port 8000

run-all: run-api
	@echo "Backend running at http://localhost:8000"
	@echo "Frontend: cd frontend && npm install && npm run dev"

clean:
	rm -rf .pytest_cache .ruff_cache .mypy_cache htmlcov dist build *.egg-info outputs/*.json checkpoints.db
