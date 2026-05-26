FROM python:3.11-slim
WORKDIR /app
RUN pip install --no-cache-dir fastapi uvicorn pyyaml
COPY dashboard_web.py .
# state/ is volume-mounted at runtime; created if missing.
RUN mkdir -p /app/state
CMD ["python", "dashboard_web.py"]
