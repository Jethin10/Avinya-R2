.PHONY: forge serve test demo

forge:
	python -m scripts.forge.run_all

serve:
	python -m engine.cli serve

test:
	python -m pytest

demo: forge
	python -m engine.cli serve

