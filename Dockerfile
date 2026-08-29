FROM python:3.11-slim
WORKDIR /app
COPY . .
RUN pip install --no-cache-dir .
RUN python -m scripts.forge.run_all
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz')"
CMD ["python", "-m", "engine.cli", "serve", "--host", "0.0.0.0", "--port", "8000"]

